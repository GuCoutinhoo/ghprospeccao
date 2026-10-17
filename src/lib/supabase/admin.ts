/** Server-only transport for the GH Prospecção Supabase document store. */
export type StoredRecord<T> = {
  collection: string;
  id: string;
  workspace_id: string;
  document: T;
  revision: number;
};

export type ReadVersion = { collection: string; id: string; revision: number };
export type WriteOperation = {
  collection: string;
  id: string;
  op: 'create' | 'set' | 'merge' | 'update' | 'delete';
  document?: Record<string, unknown>;
};

const allowedCollections = new Set([
  'leads', 'deleted_leads', 'places', 'freelancers', 'search_jobs',
  'search_areas', 'search_queries', 'search_results', 'lead_notes',
  'activities', 'settings', 'sessions', 'revoked_sessions',
  'access_codes', 'freelancer_codes', 'auth_attempts',
]);

export class SupabaseStorageError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function configuration() {
  const url = process.env.GH_SUPABASE_URL;
  const secret = process.env.GH_SUPABASE_SECRET_KEY;
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !secret) {
    throw new Error('GH Supabase backend connection is not configured.');
  }
  return { url: url.replace(/\/$/, ''), secret };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, secret } = configuration();
  const method = (init.method || 'GET').toUpperCase();
  const retryable = method === 'GET' || (method === 'POST' && path === 'rpc/gh_read_epoch');
  const attempts = retryable ? 3 : 1;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${url}/rest/v1/${path}`, {
        ...init,
        headers: {
          apikey: secret,
          ...(!secret.startsWith('sb_secret_') ? { Authorization: `Bearer ${secret}` } : {}),
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: init.signal || AbortSignal.timeout(15_000),
        cache: 'no-store',
      });
    } catch (error) {
      if (!retryable || attempt === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }

    if (!response.ok) {
      const message = (await response.text().catch(() => '')).slice(0, 400);
      if (retryable && [429, 502, 503, 504].includes(response.status) && attempt < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      throw new SupabaseStorageError(response.status, `Supabase storage failure (HTTP ${response.status}): ${message}`);
    }

    const raw = await response.text();
    return raw ? JSON.parse(raw) as T : ([] as T);
  }
  throw new Error('Supabase read retry exhausted.');
}

function validateCollection(collection: string) {
  if (!allowedCollections.has(collection)) throw new Error('Unsupported collection.');
}

export async function getRecords<T>(collection: string, filters?: { field: string; value: string }): Promise<StoredRecord<T>[]> {
  validateCollection(collection);
  const search = new URLSearchParams({
    select: 'collection,id,workspace_id,document,revision',
    collection: `eq.${collection}`,
    order: 'id.asc',
  });
  if (filters?.field === 'workspace_id') search.set('workspace_id', `eq.${filters.value}`);

  const records: StoredRecord<T>[] = [];
  for (let offset = 0; offset < 1_000_000; offset += 500) {
    const page = await request<StoredRecord<T>[]>(`app_records?${search}`, {
      headers: { Range: `${offset}-${offset + 499}`, 'Range-Unit': 'items' },
    });
    records.push(...page);
    if (page.length < 500) break;
    if (offset >= 999_500) throw new Error('Storage query exceeded safe pagination limit.');
  }
  if (!filters || filters.field === 'workspace_id') return records;
  return records.filter(record => (record.document as Record<string, unknown>)?.[filters.field] === filters.value);
}

export async function getRecord<T>(collection: string, id: string): Promise<StoredRecord<T> | undefined> {
  validateCollection(collection);
  const search = new URLSearchParams({
    select: 'collection,id,workspace_id,document,revision',
    collection: `eq.${collection}`,
    id: `eq.${id}`,
    limit: '1',
  });
  return (await request<StoredRecord<T>[]>(`app_records?${search}`))[0];
}

export async function commitChanges(reads: ReadVersion[], operations: WriteOperation[]): Promise<void> {
  reads.forEach(read => validateCollection(read.collection));
  operations.forEach(operation => validateCollection(operation.collection));
  await request<boolean>('rpc/gh_commit_changes', {
    method: 'POST',
    body: JSON.stringify({ p_reads: reads, p_operations: operations, p_epoch: null }),
  });
}

export async function checkSupabaseStorage(): Promise<void> {
  await getRecord('settings', 'config');
}
