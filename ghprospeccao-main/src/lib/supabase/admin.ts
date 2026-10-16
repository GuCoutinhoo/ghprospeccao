/**
 * Private Supabase transport for GH Prospecção.
 * All access occurs on the backend; never import this module from the browser.
 * The database uses RLS with no anon/authenticated policies.
 */
type StoredRecord<T> = { collection: string; id: string; workspace_id: string; document: T; revision: number };
type ReadVersion = { collection: string; id: string; revision: number };
type WriteOperation = { collection: string; id: string; op: 'create'|'set'|'merge'|'update'|'delete'; document?: Record<string, unknown> };
const allowedCollections = new Set(['leads','deleted_leads','places','freelancers','search_jobs','search_areas','search_queries','search_results','lead_notes','activities','settings','sessions','revoked_sessions','access_codes','freelancer_codes']);

export class SupabaseStorageError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
function configuration() {
  const url = process.env.GH_SUPABASE_URL;
  const secret = process.env.GH_SUPABASE_SECRET_KEY;
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !secret) {
    throw new Error('GH Supabase backend connection is not configured.');
  }
  return {url,secret};
}
async function request<T>(path:string,init:RequestInit = {}):Promise<T> {
  const {url,secret}=configuration();
  const result=await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers:{
      apikey:secret,Authorization:`Bearer ${secret}`,
      Accept:'application/json',
      ...(init.body ? {'Content-Type':'application/json'} : {}),
      ...init.headers
    },
    signal:init.signal || AbortSignal.timeout(15000),
    cache:'no-store',
  });
  if (!result.ok) {
    const message = (await result.text().catch(()=>'')).slice(0,240);
    throw new SupabaseStorageError(result.status,`Supabase storage failure (HTTP ${result.status}): ${message}`);
  }
  const raw=await result.text();
  return raw ? JSON.parse(raw) as T : ([] as T);
}
function validateCollection(name:string) {
  if(!allowedCollections.has(name))throw new Error('Unsupported collection');
}
const escaped=(value:string)=>encodeURIComponent(value);
export async function getRecords<T>(collection:string,filters?:{field:string;value:string}):Promise<StoredRecord<T>[]> {
  validateCollection(collection);
  const search = new URLSearchParams({select:'collection,id,workspace_id,document,revision',collection:`eq.${collection}`});
  // Narrow SQL-indexed workspace when possible; filter remaining document fields on server.
  if(filters?.field==='workspace_id')search.set('workspace_id',`eq.${filters.value}`);
  // Supabase/PostgREST may cap responses at 1,000 rows. Page until exhausted.
  const records:StoredRecord<T>[]=[];
  for(let offset=0;offset<1000000;offset+=500) {
    const page=await request<StoredRecord<T>[]>(`app_records?${search}`,{
      headers:{Range:`${offset}-${offset+499}`, 'Range-Unit':'items'}
    });
    records.push(...page);
    if(page.length<500)break;
    if(offset>=999500)throw new Error('Storage query exceeded safe pagination limit');
  }
  if(!filters || filters.field==='workspace_id')return records;
  return records.filter(r=>(r.document as Record<string,unknown>)?.[filters.field]===filters.value);
}
export async function getRecord<T>(collection:string,id:string):Promise<StoredRecord<T>|undefined> {
  validateCollection(collection);
  const search=new URLSearchParams({select:'collection,id,workspace_id,document,revision',collection:`eq.${collection}`,id:`eq.${id}`,limit:'1'});
  return (await request<StoredRecord<T>[]>(`app_records?${search}`))[0];
}
export async function commitChanges(reads:ReadVersion[], operations:WriteOperation[]):Promise<void> {
  for(const read of reads) validateCollection(read.collection);
  for(const op of operations)validateCollection(op.collection);
  await request<boolean>('rpc/gh_commit_changes',{method:'POST',body:JSON.stringify({p_reads:reads,p_operations:operations})});
}
export async function checkSupabaseStorage():Promise<void> {
  await getRecord('settings','config');
}

export async function readEpoch():Promise<number> {
  const result=await request<number>('rpc/gh_read_epoch',{method:'POST',body:'{}'});
  if(typeof result!=='number')throw new Error('Invalid Supabase storage epoch.');
  return result;
}
