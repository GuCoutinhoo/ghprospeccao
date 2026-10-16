import crypto from 'node:crypto';
/** Server-only Firestore-shaped adapter over Supabase transactional JSON documents.
 * Use only with GH_SUPABASE_SECRET_KEY; no browser-side access.
 * Optimistic document revision checks protect transactions without global contention.
 */
import type { Firestore } from 'firebase-admin/firestore';
import {commitChanges,getRecord,getRecords} from './admin';

type Data = Record<string,any>;
type Read = {collection:string;id:string;revision:number};
type Write = {collection:string;id:string;op:'create'|'set'|'merge'|'update'|'delete';document?:Data};
type Criterion = {field:string;operator:string;value:unknown};
type FilterExpr = Criterion | {kind:'or';filters:FilterExpr[]};
const clone = <T>(value:T):T => JSON.parse(JSON.stringify(value));
const matches=(value:Data,expr:FilterExpr):boolean=>{
  if('kind' in expr) return expr.filters.some(f=>matches(value,f));
  const actual=value[expr.field];
  if(expr.operator==='==')return actual===expr.value;
  if(expr.operator==='in')return Array.isArray(expr.value)&&expr.value.includes(actual);
  throw new Error('Unsupported Supabase query operator');
};
class DocumentSnapshot {
  readonly exists:boolean;
  constructor(public readonly id:string,private readonly payload:Data|undefined,readonly revision:number,readonly ref:DocumentRef){this.exists=payload!==undefined;}
  data(){return this.payload===undefined?undefined:clone(this.payload);}
  get(field:string){return this.payload?.[field];}
}
class QuerySnapshot {
  readonly docs:DocumentSnapshot[];
  readonly empty:boolean;
  readonly size:number;
  constructor(docs:DocumentSnapshot[]){this.docs=docs;this.empty=docs.length===0;this.size=docs.length;}
  forEach(cb:(doc:DocumentSnapshot)=>void){this.docs.forEach(cb);}
}
class Query {
  constructor(readonly collectionName:string,readonly predicates:FilterExpr[]=[],readonly max?:number){}
  where(field:string|{__supabaseFilter:FilterExpr},operator?:string,value?:unknown) {
    const p=typeof field==='string'?{field,operator:operator||'==',value}:field.__supabaseFilter;
    return new Query(this.collectionName,[...this.predicates,p],this.max);
  }
  limit(count:number){return new Query(this.collectionName,this.predicates,count);}
  orderBy(_field:string){throw new Error('orderBy is not implemented for Supabase adapter');}
  async get():Promise<QuerySnapshot> {
    const all=await getRecords<Data>(this.collectionName);
    const docs=all.filter(r=>this.predicates.every(p=>matches(r.document,p)))
      .slice(0,this.max===undefined?undefined:Math.max(0,this.max))
      .map(r=>new DocumentSnapshot(r.id,r.document,r.revision,new DocumentRef(r.collection,r.id)));
    return new QuerySnapshot(docs);
  }
}
class DocumentRef {
  constructor(readonly collectionName:string,readonly id:string){}
  async get(){const r=await getRecord<Data>(this.collectionName,this.id);return new DocumentSnapshot(this.id,r?.document,r?.revision||0,this);}
  async create(data:Data){await commitChanges([],[{collection:this.collectionName,id:this.id,op:'create',document:clone(data)}]);}
  async set(data:Data,options?:{merge?:boolean}){await commitChanges([],[{collection:this.collectionName,id:this.id,op:options?.merge?'merge':'set',document:clone(data)}]);}
  async update(data:Data){await commitChanges([],[{collection:this.collectionName,id:this.id,op:'update',document:clone(data)}]);}
  async delete(){await commitChanges([],[{collection:this.collectionName,id:this.id,op:'delete'}]);}
}
class CollectionRef extends Query {
  constructor(name:string){super(name);}
  doc(id?:string){return new DocumentRef(this.collectionName,id||crypto.randomUUID());}
}
class Transaction {
  readonly reads:Read[]=[];
  readonly operations:Write[]=[];
  private wrote=false;
  private cache=new Map<string,DocumentSnapshot>();

  async get(source:DocumentRef|Query) {
    // Reads and writes are staged, then atomically committed.
    if(source instanceof DocumentRef){
      const key=`${source.collectionName}/${source.id}`;
      let snapshot=this.cache.get(key);
      if(!snapshot){snapshot=await source.get();this.cache.set(key,snapshot);}
      if(!this.reads.some(r=>r.collection===source.collectionName&&r.id===source.id))this.reads.push({collection:source.collectionName,id:source.id,revision:snapshot.revision});
      return snapshot;
    }
    if(source instanceof Query)return source.get();
    throw new Error('Unsupported transaction read');
  }
  async getAll(...refs:DocumentRef[]){return Promise.all(refs.map(ref=>this.get(ref)));}
  set(ref:DocumentRef,data:Data,options?:{merge?:boolean}){this.wrote=true;this.operations.push({collection:ref.collectionName,id:ref.id,op:options?.merge?'merge':'set',document:clone(data)});return this;}
  create(ref:DocumentRef,data:Data){this.wrote=true;this.operations.push({collection:ref.collectionName,id:ref.id,op:'create',document:clone(data)});return this;}
  update(ref:DocumentRef,data:Data){this.wrote=true;this.operations.push({collection:ref.collectionName,id:ref.id,op:'update',document:clone(data)});return this;}
  delete(ref:DocumentRef){this.wrote=true;this.operations.push({collection:ref.collectionName,id:ref.id,op:'delete'});return this;}
  async commit(){if(this.operations.length)await commitChanges(this.reads,this.operations);}
}
class Database {
  collection(name:string){return new CollectionRef(name);}
  async getAll(...refs:DocumentRef[]){return Promise.all(refs.map(x=>x.get()));}
  async runTransaction<T>(fn:(tx:Transaction)=>Promise<T>,options?:{maxAttempts?:number;readOnly?:boolean}):Promise<T>{
    const attempts=options?.maxAttempts||5;
    for(let index=0;index<attempts;index++){
      const tx=new Transaction();
      const result=await fn(tx);
      if(options?.readOnly)return result;
      try {await tx.commit();return result;}
      catch(err){if(index===attempts-1||!/GH_TX_CONFLICT|40001|serialization/i.test(String(err)))throw err;}
    }
    throw new Error('Transaction retry exhausted');
  }
}
const singleton=new Database();
export const SupabaseFilter={
  where(field:string,operator:string,value:unknown){return {__supabaseFilter:{field,operator,value}};},
  or(...filters:{__supabaseFilter:FilterExpr}[]){return {__supabaseFilter:{kind:'or' as const,filters:filters.map(f=>f.__supabaseFilter)}};}
};
export function getSupabaseFirestoreAdapter():Firestore{return singleton as unknown as Firestore;}
