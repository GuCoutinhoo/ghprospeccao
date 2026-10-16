import {test, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Exercise real Vercel behavior: credentials alone must enable the Supabase backend.
delete process.env.GH_STORAGE_BACKEND;
process.env.GH_SUPABASE_URL='https://demo-supabase-adapter.supabase.co';
process.env.GH_SUPABASE_SECRET_KEY='sb_secret_local_test_only';
process.env.ADMIN_EMAIL='admin@example.test';
process.env.ADMIN_PASSWORD='test-password-strong-enough';
process.env.SESSION_SECRET='test-secret-not-for-production-xxxxxxxxxxxx';
process.env.GOOGLE_MAPS_API_KEY='mock-places-only';
process.env.GH_LIVE_GOOGLE_SMOKE_TEST='enabled';

type Document = Record<string,unknown>;
type Row={collection:string;id:string;workspace_id:string;document:Document;revision:number};
let records=new Map<string,Row>(),epoch=0;
let googleCalls=0;
const key=(c:string,id:string)=>c+'|'+id;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const u=new URL(String(input));
  if(u.hostname==='places.googleapis.com') {
    googleCalls++;
    assert.equal(new Headers(init?.headers).get('X-Goog-Api-Key'),process.env.GOOGLE_MAPS_API_KEY);
    return new Response(JSON.stringify({places:[{id:'places_test_1',displayName:{text:'Barbearia Teste'},formattedAddress:'São Paulo - SP'}]}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  assert.equal(u.origin,process.env.GH_SUPABASE_URL);
  const headers=new Headers(init?.headers);
  assert.equal(headers.get('apikey'),process.env.GH_SUPABASE_SECRET_KEY);
  assert.equal(headers.get('authorization'),null,'New sb_secret must never be sent as Bearer JWT');
  const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(u.pathname==='/rest/v1/rpc/gh_read_epoch')return respond(epoch);
  if(u.pathname==='/rest/v1/rpc/gh_commit_changes'){
    const body=JSON.parse(String(init?.body||'{}'));
    const conflict=()=>respond({code:'40001',message:'GH_TX_CONFLICT'},409);
    if(body.p_epoch!==null&&body.p_epoch!==epoch)return conflict();
    for(const read of body.p_reads||[])if((records.get(key(read.collection,read.id))?.revision||0)!==read.revision)return conflict();
    const staged=new Map(records);
    for(const op of body.p_operations||[]){
      const k=key(op.collection,op.id),existing=staged.get(k);
      if(op.op==='create'&&existing)return respond({code:'23505',message:'duplicate key'},409);
      if(op.op==='update'&&!existing)return respond({code:'P0002',message:'not found'},404);
      if(op.op==='delete'){staged.delete(k);continue;}
      const document=op.op==='merge'||op.op==='update'?{...(existing?.document||{}),...op.document}:op.document;
      staged.set(k,{collection:op.collection,id:op.id,workspace_id:String(document.workspace_id||document.freelancer_id||'admin'),document,revision:existing?existing.revision+1:1});
    }
    records=staged;
    if((body.p_operations||[]).length)epoch++;
    return respond(true);
  }
  if(u.pathname==='/rest/v1/app_records'){
    let result=[...records.values()];
    for(const f of ['collection','id','workspace_id']){
      const expression=u.searchParams.get(f);
      if(expression?.startsWith('eq.'))result=result.filter(r=>String(r[f as 'collection'|'id'|'workspace_id'])===expression.slice(3));
    }
    result.sort((a,b)=>a.id.localeCompare(b.id));
    const range=headers.get('range');
    if(range){const [a,b]=range.split('-').map(Number);result=result.slice(a,b+1);}
    const limit=u.searchParams.get('limit');if(limit)result=result.slice(0,Number(limit));
    return respond(result);
  }
  throw new Error('Unexpected Supabase transport: '+u.pathname);
};

const {shouldUseSupabase}=await import('../src/lib/supabase/admin');
assert.equal(shouldUseSupabase(),true,'Production credentials should select Supabase automatically');
assert.equal(shouldUseSupabase({GH_STORAGE_BACKEND:'firestore',GH_SUPABASE_URL:process.env.GH_SUPABASE_URL,GH_SUPABASE_SECRET_KEY:process.env.GH_SUPABASE_SECRET_KEY} as NodeJS.ProcessEnv),false);
assert.equal(shouldUseSupabase({} as NodeJS.ProcessEnv),false);
const {Repository,actorContext}=await import('../src/lib/store/repository');
const {leadIdentity}=await import('../src/lib/store/repository');
const repo=new Repository();
const timestamp=()=>new Date().toISOString();
const lead=(workspace_id:string,place_id:string,niche='dentistas'):any=>({
  id:'legacy_'+place_id,workspace_id,freelancer_id:workspace_id==='admin'?undefined:workspace_id,
  place_id,name:'Consultório '+place_id,niche,state:'SP',city:'São Paulo',
  phone:'11999999999',website_status:'no_website',pipeline_status:'NOVO',
  created_at:timestamp(),updated_at:timestamp()
});
beforeEach(()=>{records=new Map();epoch=0;googleCalls=0;});

test('Supabase: create, read, update and tombstone survive successive requests',async()=>{
  const original=lead('admin','dentist_1');
  const saved=await repo.createLead(original);
  assert.equal(saved.created,true);
  assert.equal(saved.lead.id,leadIdentity('admin','dentist_1','dentistas'));
  assert.equal((await repo.getLeadById(saved.lead.id))?.name,original.name);
  const updated=await repo.updateLead(saved.lead.id,{pipeline_status:'CONTATADO'});
  assert.equal(updated?.pipeline_status,'CONTATADO');
  assert.equal((await repo.getLeadById(saved.lead.id))?.pipeline_status,'CONTATADO');
  assert.equal(await repo.deleteLead(saved.lead.id),true);
  assert.equal(await repo.getLeadById(saved.lead.id),undefined);
  assert.equal((await repo.createLead(original)).isDeleted,true);
  assert.equal((await repo.getLeads({freelancer_id:'ALL',limit:0})).total,0);
});

test('Supabase: freelancer scope denies other workspaces and preserves own leads',async()=>{
  const own='free_'+crypto.randomUUID(),other='free_'+crypto.randomUUID();
  const x=(await repo.createLead(lead(own,'p_own'))).lead;
  const y=(await repo.createLead(lead(other,'p_other'))).lead;
  assert.equal((await repo.getLeads({freelancer_id:'ALL',limit:0})).total,2);
  await actorContext.run({role:'freelancer',freelancerId:own},async()=>{
    const result=await repo.getLeads({freelancer_id:'ALL',limit:0});
    assert.equal(result.total,1);
    assert.equal(result.leads[0].id,x.id);
    await assert.rejects(()=>repo.getLeadById(y.id),/Acesso negado/);
    await assert.rejects(()=>repo.updateLead(y.id,{pipeline_status:'CONTATADO'}),/Acesso negado/);
    await assert.rejects(()=>repo.deleteLead(y.id),/Acesso negado/);
    assert.equal((await repo.getLeadById(x.id))?.id,x.id);
  });
});

test('Supabase: duplicate simultaneous inserts remain idempotent',async()=>{
  const raw=lead('admin','one_shared_business');
  const result=await Promise.all([repo.createLead(raw),repo.createLead(raw)]);
  assert.equal(result.filter(x=>x.created).length,1);
  assert.equal((await repo.getLeads({freelancer_id:'ALL',limit:0})).total,1);
});

test('Supabase: freelancer creation persists and access code is unique',async()=>{
  const a=await repo.createFreelancer({name:'Freelancer A',email:'a@example.test'});
  const b=await repo.createFreelancer({name:'Freelancer B',email:'b@example.test'});
  assert.notEqual(a.access_code,b.access_code);
  assert.equal((await repo.getFreelancerByAccessCode(a.access_code))?.id,a.id);
  assert.equal((await repo.getFreelancers()).length,2);
  await repo.setFreelancerStatus(a.id,'blocked');
  assert.equal((await repo.getFreelancerById(a.id))?.status,'blocked');
});

test('Supabase: custom freelancer slugs are unique, PIN-protected, and editable',async()=>{
  const f=await repo.createFreelancer({name:'Teste',email:'teste@example.test',access_code:'Téste'});
  assert.equal(f.access_code,'teste');
  assert.match(f.temporaryPin || '',/^\d{6}$/);
  const persisted=await repo.getFreelancerById(f.id);
  assert.equal(persisted?.access_code,'teste');
  assert.ok(persisted?.pin_hash?.includes(':'));
  assert.equal(persisted?.pin,undefined);
  assert.equal((persisted as any)?.temporaryPin,undefined,'Never persist one-time PIN');
  await assert.rejects(()=>repo.createFreelancer({name:'Outra',email:'outra@example.test',access_code:'TESTE'}),{status:409});
  const b=await repo.createFreelancer({name:'Ana',email:'ana@example.test',access_code:'ana'});
  await assert.rejects(()=>repo.updateFreelancer(b.id,{access_code:'teste'}),{status:409});
  const changed=await repo.updateFreelancer(f.id,{name:'Teste Novo',pin:''});
  assert.equal(changed?.pin_hash,persisted?.pin_hash,'Blank PIN must not clear the existing hash');
  const renamed=await repo.updateFreelancer(f.id,{access_code:'teste-novo'});
  assert.equal(renamed?.access_code,'teste-novo');
  assert.equal(renamed?.pin_hash,persisted?.pin_hash);
  assert.equal((await repo.getFreelancerByAccessCode('teste'))?.id,undefined);
  assert.equal((await repo.getFreelancerByAccessCode('teste-novo'))?.id,f.id);
  const regenerated=await repo.regenerateFreelancerAccessCode(f.id);
  assert.equal(regenerated?.accessCode,'teste');
  assert.equal((await repo.getFreelancerById(f.id))?.id,f.id);
  const repeated=await repo.regenerateFreelancerAccessCode(f.id);
  assert.equal(repeated?.accessCode,'teste-2','Regeneration must invalidate previous URL');
});

test('Supabase: human-readable links require PIN and keep legacy workspaces isolated',async()=>{
  const request=(await import('supertest')).default;
  const app=(await import('../src/server/app')).default;
  const f=await repo.createFreelancer({name:'Segura',email:'segura@example.test',access_code:'segura',pin:'123456'});
  const missing=await request(app).post('/api/freelancer/auth/verify').send({accessCode:'segura'});
  assert.equal(missing.status,401);
  const correct=await request(app).post('/api/freelancer/auth/verify').send({accessCode:'segura',pin:'123456'});
  assert.equal(correct.status,200);
  assert.ok(correct.body.token);
  await repo.setFreelancerStatus(f.id,'blocked');
  assert.equal((await request(app).post('/api/freelancer/auth/verify').send({accessCode:'segura',pin:'123456'})).status,403);
  const legacyId='free_'+crypto.randomUUID();
  await repo.firestore.collection('freelancers').doc(legacyId).create({
    id:legacyId,name:'Legado',email:'legacy@example.test',access_code:'old-random_TOKEN',
    status:'blocked',created_at:timestamp(),updated_at:timestamp()
  });
  const updated=await repo.updateFreelancer(legacyId,{access_code:'legado'});
  assert.match(updated?.temporaryPin || '',/^\d{6}$/,'PIN must be assigned to old link converted to slug');
  assert.equal((await repo.getFreelancerById(legacyId))?.status,'blocked','Changing link must not unblock');
});

test('Supabase: API authorization and admin login work across requests',async()=>{
  const request=(await import('supertest')).default;
  const app=(await import('../src/server/app')).default;
  assert.equal((await request(app).get('/api/leads')).status,401);
  assert.equal((await request(app).post('/api/admin/login').send({email:'admin@example.test',password:'wrong'})).status,401);
  const login=await request(app).post('/api/admin/login').send({email:'admin@example.test',password:'test-password-strong-enough'});
  assert.equal(login.status,200);
  const token=login.body.token;
  assert.equal((await request(app).get('/api/admin/me').set('Authorization','Bearer '+token)).status,200);
  const newFreelancer=await request(app).post('/api/admin/freelancers')
    .set('Authorization','Bearer '+token).send({name:'Test Agent',email:'agent@example.test'});
  assert.equal(newFreelancer.status,201);
  assert.equal((await request(app).get('/api/admin/freelancers').set('Authorization','Bearer '+token)).status,200);
  assert.equal((await request(app).get('/api/admin/freelancers')).status,401);
});

test('Supabase: search worker saves approved candidates exactly once',async()=>{
  const {runSearchJob}=await import('../src/lib/search/searchWorker');
  const jid='job_'+crypto.randomUUID();
  const area:any={id:'area_'+crypto.randomUUID(),search_job_id:jid,city:'São Paulo',state:'SP',lat:-23.55,lng:-46.63,radius:5000,status:'pending',attempts:0,places_found:0};
  const job:any={id:jid,version:2,user_id:'admin_1',workspace_id:'admin',state:'SP',city:'São Paulo',
    niche:'dentistas',filters:{onlyWithoutWebsite:true,onlyWithPhone:false,minRating:0,minReviews:0,targetLeads:1},
    status:'pending',target_leads:1,total_cities:1,processed_cities:0,total_search_areas:1,processed_search_areas:0,
    places_found:0,places_without_website:0,leads_created:0,created_at:timestamp(),updated_at:timestamp()};
  await repo.createSearchJob(job,[area]);
  const candidate:any={id:'place_'+crypto.randomUUID(),displayName:{text:'Clínica Odontológica Teste'},
    formattedAddress:'São Paulo, SP',rating:4.8,userRatingCount:20,types:['dentist','health'],
    businessStatus:'OPERATIONAL',nationalPhoneNumber:'11999999999'};
  const fetcher=async()=>({places:[candidate],nextPageToken:undefined});
  await runSearchJob(jid,repo,fetcher as any,8000);
  const persisted=await repo.getSearchJob(jid);
  assert.equal(persisted?.leads_created,1);
  assert.equal((await repo.getLeads({freelancer_id:'ALL',limit:0})).total,1);
  await runSearchJob(jid,repo,fetcher as any,8000);
  assert.equal((await repo.getLeads({freelancer_id:'ALL',limit:0})).total,1);
});


test('Production readiness checks actual storage; live Google probe is paid at most once',async()=>{
  const request=(await import('supertest')).default;
  const app=(await import('../src/server/app')).default;
  const check=await request(app).get('/api/health');
  assert.equal(check.status,200);
  assert.equal(check.body.storage,'connected');
  assert.equal(check.body.googlePlacesConfigured,true);
  const first=await request(app).get('/api/health/google-once');
  assert.equal(first.status,200);
  assert.equal(first.body.placesFound,1);
  const second=await request(app).get('/api/health/google-once');
  assert.equal(second.status,200);
  assert.equal(second.body.alreadyRun,true);
  assert.equal(googleCalls,1);
});

process.on('exit',()=>{globalThis.fetch=originalFetch;});


test('Search filters: maximum, minimum, exact and rating boundary values',async()=>{
  const {checkLeadFilters}=await import('../src/lib/search/searchWorker');
  const base={website_status:'no_website' as const,website:'',phone:'11999999999',rating:4.5,reviews_count:10};
  const filters={onlyWithoutWebsite:false,onlyWithPhone:false,minRating:4,minReviews:0,maxReviews:10};
  assert.equal(checkLeadFilters({...base,reviews_count:0},filters),true);
  assert.equal(checkLeadFilters({...base,reviews_count:10},filters),true);
  assert.equal(checkLeadFilters({...base,reviews_count:11},filters),false);
  assert.equal(checkLeadFilters({...base,reviews_count:200},filters),false);
  assert.equal(checkLeadFilters({...base,reviews_count:9},{...filters,minReviews:10}),false);
  assert.equal(checkLeadFilters({...base,reviews_count:10},{...filters,minReviews:10}),true);
  assert.equal(checkLeadFilters({...base,reviews_count:4},{...filters,minReviews:4,maxReviews:4}),true);
  assert.equal(checkLeadFilters({...base,reviews_count:5},{...filters,minReviews:4,maxReviews:4}),false);
  assert.equal(checkLeadFilters({...base,rating:3.9},filters),false);
  assert.equal(checkLeadFilters({...base,rating:4},filters),true);
  assert.equal(checkLeadFilters({...base,website:'https://example.test'},{...filters,onlyWithoutWebsite:true}),false);
  assert.equal(checkLeadFilters({...base,phone:''},{...filters,onlyWithPhone:true}),false);
});

test('Search results respect per-job snapshots without altering pre-existing leads',async()=>{
  const w='free_'+crypto.randomUUID(), placeId='place_'+crypto.randomUUID();
  const saved=(await repo.createLead({...lead(w,placeId,'dentistas'),rating:4.8,reviews_count:200})).lead;
  const jobId='job_'+crypto.randomUUID();
  await repo.createSearchJob({id:jobId,workspace_id:w,freelancer_id:w,user_id:w,
    niche:'dentistas',state:'SP',city:'São Paulo',filters:{
      onlyWithoutWebsite:true,onlyWithPhone:true,minRating:4,minReviews:0,maxReviews:10,targetLeads:0
    },status:'completed',total_cities:1,processed_cities:1,total_search_areas:0,processed_search_areas:0,
    places_found:1,places_without_website:1,leads_created:0,created_at:timestamp(),updated_at:timestamp()} as any);
  const receipt=repo.firestore.collection('search_results').doc('receipt_'+crypto.randomUUID());
  await receipt.set({job_id:jobId,workspace_id:w,place_id:placeId,lead_id:saved.id,
    result:'duplicate',rating:4.8,reviews_count:8,website:'',website_status:'no_website',phone:'11999999999'});
  let rows=await repo.getLeads({freelancer_id:w,search_job_id:jobId,limit:0});
  assert.equal(rows.total,1);
  assert.equal(rows.leads[0].reviews_count,8);
  assert.equal((await repo.getLeadById(saved.id))?.reviews_count,200,'Historical lead must remain unchanged');
  await receipt.set({job_id:jobId,workspace_id:w,place_id:placeId,lead_id:saved.id,
    result:'duplicate',rating:4.8,reviews_count:200,website:'',website_status:'no_website',phone:'11999999999'});
  rows=await repo.getLeads({freelancer_id:w,search_job_id:jobId,limit:0});
  assert.equal(rows.total,0,'A 200-review company cannot pass a max-10 job');
  assert.equal((await repo.getLeads({freelancer_id:w,limit:0})).total,1,'General lead base must not be modified');
});
