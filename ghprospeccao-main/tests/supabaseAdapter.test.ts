import {test, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.GH_STORAGE_BACKEND='supabase';
process.env.GH_SUPABASE_URL='https://demo-supabase-adapter.supabase.co';
process.env.GH_SUPABASE_SECRET_KEY='sb_secret_local_test_only';
process.env.ADMIN_EMAIL='admin@example.test';
process.env.ADMIN_PASSWORD='test-password-strong-enough';
process.env.SESSION_SECRET='test-secret-not-for-production-xxxxxxxxxxxx';

type Document = Record<string,unknown>;
type Row={collection:string;id:string;workspace_id:string;document:Document;revision:number};
let records=new Map<string,Row>(),epoch=0;
const key=(c:string,id:string)=>c+'|'+id;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const u=new URL(String(input)); assert.equal(u.origin,process.env.GH_SUPABASE_URL);
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
beforeEach(()=>{records=new Map();epoch=0;});

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
  assert.equal(newFreelancer.status,200);
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

process.on('exit',()=>{globalThis.fetch=originalFetch;});
