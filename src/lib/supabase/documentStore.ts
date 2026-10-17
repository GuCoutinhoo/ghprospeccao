import crypto from 'node:crypto';
import { commitChanges, getRecord, getRecords, getRecordsByIds, type ReadVersion, type WriteOperation } from './admin';

type Data = Record<string, any>;
type Criterion = { field: string; operator: string; value: unknown };
type FilterExpression = Criterion | { kind: 'or'; filters: FilterExpression[] };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const matches = (value: Data, expression: FilterExpression): boolean => {
  if ('kind' in expression) return expression.filters.some(filter => matches(value, filter));
  const actual = expression.field === 'workspace_id'
    ? (value.workspace_id ?? value.freelancer_id ?? value.user_id ?? 'admin')
    : value[expression.field];
  if (expression.operator === '==') return actual === expression.value;
  if (expression.operator === 'in') return Array.isArray(expression.value) && expression.value.includes(actual);
  throw new Error('Unsupported document query operator.');
};

export class DocumentSnapshot {
  readonly exists: boolean;
  constructor(
    public readonly id: string,
    private readonly payload: Data | undefined,
    public readonly revision: number,
    public readonly ref: DocumentReference,
  ) {
    this.exists = payload !== undefined;
  }
  data() { return this.payload === undefined ? undefined : clone(this.payload); }
  get(field: string) { return this.payload?.[field]; }
}

export class QuerySnapshot {
  readonly empty: boolean;
  readonly size: number;
  constructor(public readonly docs: DocumentSnapshot[]) {
    this.empty = docs.length === 0;
    this.size = docs.length;
  }
  forEach(callback: (document: DocumentSnapshot) => void) { this.docs.forEach(callback); }
}

export class Query {
  constructor(
    public readonly collectionName: string,
    public readonly predicates: FilterExpression[] = [],
    public readonly maximum?: number,
  ) {}
  where(field: string | { __documentFilter: FilterExpression }, operator?: string, value?: unknown) {
    const predicate = typeof field === 'string'
      ? { field, operator: operator || '==', value } as Criterion
      : field.__documentFilter;
    return new Query(this.collectionName, [...this.predicates, predicate], this.maximum);
  }
  limit(count: number) { return new Query(this.collectionName, this.predicates, count); }
  async get(): Promise<QuerySnapshot> {
    const workspace = this.predicates.find(
      predicate => !('kind' in predicate) && predicate.field === 'workspace_id' && predicate.operator === '==',
    ) as Criterion | undefined;
    const searchable = new Set(['search_job_id','job_id','place_id','lead_id']);
    const exact = this.predicates.find(predicate => !('kind' in predicate) &&
      predicate.operator === '==' && searchable.has(predicate.field)) as Criterion | undefined;
    const pushdown = workspace
      ? { field: 'workspace_id', value: String(workspace.value) }
      : exact ? { field: exact.field, value: String(exact.value) } : undefined;
    const all = await getRecords<Data>(this.collectionName, pushdown);
    const docs = all
      .filter(record => this.predicates.every(predicate => matches(record.document, predicate)))
      .slice(0, this.maximum === undefined ? undefined : Math.max(0, this.maximum))
      .map(record => new DocumentSnapshot(record.id, record.document, record.revision, new DocumentReference(record.collection, record.id)));
    return new QuerySnapshot(docs);
  }
}

export class DocumentReference {
  constructor(public readonly collectionName: string, public readonly id: string) {}
  async get() {
    const record = await getRecord<Data>(this.collectionName, this.id);
    return new DocumentSnapshot(this.id, record?.document, record?.revision || 0, this);
  }
  async create(data: Data) { await commitChanges([], [{ collection: this.collectionName, id: this.id, op: 'create', document: clone(data) }]); }
  async set(data: Data, options?: { merge?: boolean }) { await commitChanges([], [{ collection: this.collectionName, id: this.id, op: options?.merge ? 'merge' : 'set', document: clone(data) }]); }
  async update(data: Data) { await commitChanges([], [{ collection: this.collectionName, id: this.id, op: 'update', document: clone(data) }]); }
  async delete() { await commitChanges([], [{ collection: this.collectionName, id: this.id, op: 'delete' }]); }
}

export class CollectionReference extends Query {
  constructor(name: string) { super(name); }
  doc(id?: string) { return new DocumentReference(this.collectionName, id || crypto.randomUUID()); }
}

export class Transaction {
  readonly reads: ReadVersion[] = [];
  readonly operations: WriteOperation[] = [];
  private cache = new Map<string, DocumentSnapshot>();

  async get(source: DocumentReference): Promise<DocumentSnapshot>;
  async get(source: Query): Promise<QuerySnapshot>;
  async get(source: DocumentReference | Query): Promise<DocumentSnapshot | QuerySnapshot> {
    if (source instanceof DocumentReference) {
      const key = `${source.collectionName}/${source.id}`;
      let snapshot = this.cache.get(key);
      if (!snapshot) {
        snapshot = await source.get();
        this.cache.set(key, snapshot);
      }
      if (!this.reads.some(read => read.collection === source.collectionName && read.id === source.id)) {
        this.reads.push({ collection: source.collectionName, id: source.id, revision: snapshot.revision });
      }
      return snapshot;
    }
    const snapshot = await source.get();
    for (const document of snapshot.docs) {
      if (!this.reads.some(read => read.collection === source.collectionName && read.id === document.id)) {
        this.reads.push({ collection: source.collectionName, id: document.id, revision: document.revision });
      }
    }
    return snapshot;
  }
  /** Bulk read, including missing documents, with optimistic revision tracking. */
  async getMany(collectionName: string, ids: string[]): Promise<DocumentSnapshot[]> {
    const unique = [...new Set(ids)];
    const records = await getRecordsByIds<Data>(collectionName, unique);
    const byId = new Map(records.map(record => [record.id, record]));
    return unique.map(id => {
      const record = byId.get(id);
      const ref = new DocumentReference(collectionName, id);
      const snapshot = new DocumentSnapshot(id, record?.document, record?.revision || 0, ref);
      const key = `${collectionName}/${id}`;
      this.cache.set(key, snapshot);
      if (!this.reads.some(read => read.collection === collectionName && read.id === id)) {
        this.reads.push({ collection: collectionName, id, revision: snapshot.revision });
      }
      return snapshot;
    });
  }
  async getAll(...references: DocumentReference[]) { return Promise.all(references.map(reference => this.get(reference))); }
  set(reference: DocumentReference, data: Data, options?: { merge?: boolean }) {
    this.operations.push({ collection: reference.collectionName, id: reference.id, op: options?.merge ? 'merge' : 'set', document: clone(data) });
    return this;
  }
  create(reference: DocumentReference, data: Data) {
    this.operations.push({ collection: reference.collectionName, id: reference.id, op: 'create', document: clone(data) });
    return this;
  }
  update(reference: DocumentReference, data: Data) {
    this.operations.push({ collection: reference.collectionName, id: reference.id, op: 'update', document: clone(data) });
    return this;
  }
  delete(reference: DocumentReference) {
    this.operations.push({ collection: reference.collectionName, id: reference.id, op: 'delete' });
    return this;
  }
  async commit() { if (this.operations.length) await commitChanges(this.reads, this.operations); }
}

export class DocumentStore {
  collection(name: string) { return new CollectionReference(name); }
  async getAll(...references: DocumentReference[]) { return Promise.all(references.map(reference => reference.get())); }
  async runTransaction<T>(callback: (transaction: Transaction) => Promise<T>, options?: { maxAttempts?: number; readOnly?: boolean }): Promise<T> {
    const attempts = options?.maxAttempts || 5;
    for (let index = 0; index < attempts; index++) {
      const transaction = new Transaction();
      const result = await callback(transaction);
      if (options?.readOnly) return result;
      try {
        await transaction.commit();
        return result;
      } catch (error) {
        if (index === attempts - 1 || !/GH_TX_CONFLICT|40001|serialization|23505|duplicate key/i.test(String(error))) throw error;
        // Backoff before a fresh read/commit. Immediate retries cause another
        // revision race and overload PostgREST under simultaneous requests.
        const delayMs = Math.min(400, 25 * 2 ** index) + Math.floor(Math.random() * 25);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    throw new Error('Transaction retry exhausted.');
  }
}

export const DocumentFilter = {
  where(field: string, operator: string, value: unknown) {
    return { __documentFilter: { field, operator, value } as FilterExpression };
  },
  or(...filters: { __documentFilter: FilterExpression }[]) {
    return { __documentFilter: { kind: 'or' as const, filters: filters.map(filter => filter.__documentFilter) } as FilterExpression };
  },
};

const singleton = new DocumentStore();
export function getDocumentStore() { return singleton; }
