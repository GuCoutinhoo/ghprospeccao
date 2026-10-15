import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Firestore } from 'firebase-admin/firestore';
import request from 'supertest';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc} from 'firebase/firestore';
import {Repository,actorContext} from '../src/lib/store/db';
import {getServerFirestore} from '../src/lib/firebase/admin';
import {runSearchJob,pauseSearchJob,cancelSearchJob,resumeSearchJob,checkLeadFilters,createAndPrepareSearchJob} from '../src/lib/search/searchWorker';
import {isPlaceRelevantToNiche} from '../src/lib/search/relevance';
import {normalizePlace,type GooglePlaceRaw} from '../src/lib/google/places';
import {searchPage} from '../src/lib/google/searchPage';
import {now} from '../src/lib/store/repository';
import app,{signSession} from '../src/server/app';
import type {Lead,SearchJob,SearchArea} from '../src/types';

const firestore=getServerFirestore();const repo=new Repository(firestore);
const unique=()=>crypto.randomUUID();
const filters={onlyWithoutWebsite:true,onlyWithPhone:false,minRating:4,minReviews:0,targetLeads:10};
function candidate(id:string,patch:Partial<GooglePlaceRaw>={}):GooglePlaceRaw{return {id,displayName:{text:`Clínica Odontológica ${id}`},formattedAddress:'Rua Teste, São Paulo - SP',rating:4.6,userRatingCount:60,types:['dentist','health'],businessStatus:'OPERATIONAL',nationalPhoneNumber:'11999999999',...patch};}
async function fixture(count=10){
  const workspace=`free_${unique()}`,id=`job_${unique()}`;
  const area:SearchArea={id:unique(),search_job_id:id,city:'São Paulo',state:'SP',lat:0,lng:0,radius:0,status:'pending',attempts:0,places_found:0};
  const job:SearchJob={id,version:2,user_id:workspace,freelancer_id:workspace,workspace_id:workspace,state:'SP',city:'all',niche:'clínicas odontológicas',filters,target_leads:10,status:'pending',total_cities:1,processed_cities:0,total_search_areas:1,processed_search_areas:0,places_found:0,places_without_website:0,leads_created:0,created_at:now(),updated_at:now()};
  await repo.createSearchJob(job,[area]);
  const places=Array.from({length:count},()=>candidate(unique()));
  const fetch=async()=>({places});
  return {workspace,id,job,area,places,fetch};
}
async function finish(id:string,fetch:any,store=repo){for(let i=0;i<8;i++){const job=await store.getSearchJob(id);if(['completed','failed','paused','cancelled'].includes(job!.status))return job!;await runSearchJob(id,store,fetch);}throw new Error('Job did not finish');}
async function seedLead(workspace:string,place=unique(),niche='odontologia'){
  const lead:Lead={id:`legacy_${unique()}`,workspace_id:workspace,freelancer_id:workspace,user_id:workspace,place_id:place,name:'Clínica Teste',niche,state:'SP',city:'São Paulo',website_status:'no_website',rating:4.5,reviews_count:50,lead_score:90,pipeline_status:'NOVO',created_at:now(),updated_at:now()};
  return (await repo.createLead(lead)).lead;
}
const admin=()=>signSession({role:'admin',id:'admin_1',email:'admin@example.test',exp:Date.now()+60000});
async function freelancer(workspace:string){const code=unique();await firestore.collection('freelancers').doc(workspace).set({id:workspace,name:'Test',email:'test@example.test',access_code:code,status:'active',created_at:now(),updated_at:now()});return signSession({role:'freelancer',freelancerId:workspace,accessCode:code,exp:Date.now()+60000});}

test('10 dental candidates produce exactly 10 new durable leads and exact job results',async()=>{
  const f=await fixture();const job=await finish(f.id,f.fetch);assert.equal(job.status,'completed');assert.equal(job.completion_reason,'target_reached');assert.equal(job.leads_created,10);
  const rows=await repo.getLeads({freelancer_id:f.workspace,search_job_id:f.id,limit:0});assert.equal(rows.total,10);assert.equal(new Set(rows.leads.map(l=>l.place_id)).size,10);
  assert.ok(rows.leads.every(l=>l.rating>=4 && !l.website && l.niche==='clínicas odontológicas'));
});
test('full creation flow: SP, all cities, dentistry, no website, rating >=4, target 10',async()=>{
  const saved=globalThis.fetch;let prepared:Awaited<ReturnType<typeof createAndPrepareSearchJob>>;
  try{globalThis.fetch=async()=>new Response(JSON.stringify([{id:1,nome:'São Paulo'},{id:2,nome:'Cidade Teste'}]),{status:200});prepared=await createAndPrepareSearchJob({userId:'test',freelancerId:`free_${unique()}`,state:'SP',city:'all',niche:'clínicas odontológicas',filters},repo);}finally{globalThis.fetch=saved;}
  assert.ok(prepared!.totalCities>=2);assert.ok(prepared!.totalAreas>prepared!.totalCities);
  const job=await finish(prepared!.job.id,async()=>({places:Array.from({length:10},()=>candidate(unique()))}));assert.equal(job.leads_created,10);
  assert.ok((await repo.getSearchQueries(job.id)).length>0);assert.equal((await repo.getLeads({freelancer_id:job.workspace_id,search_job_id:job.id,limit:0})).total,10);
});
test('insufficient candidates finish exhausted with actual count, never a fabricated target',async()=>{
  const f=await fixture(3);const job=await finish(f.id,f.fetch);assert.equal(job.leads_created,3);assert.equal(job.completion_reason,'exhausted');assert.equal(job.processed_search_areas,1);
});
test('repeated parallel reads from independent instances return stable persisted IDs',async()=>{
  const f=await fixture();await finish(f.id,f.fetch);const other=new Repository(new Firestore({projectId:'demo-ghprospeccao'}));
  const results=await Promise.all(Array.from({length:12},(_,i)=>(i%2?other:repo).getLeads({freelancer_id:f.workspace,limit:0})));
  assert.ok(results.every(r=>r.total===10));for(const r of results)assert.deepEqual(r.leads.map(l=>l.id),results[0].leads.map(l=>l.id));await other.firestore.terminate();
});
test('concurrent workers claim a job only once and do not overshoot the goal',async()=>{
  const f=await fixture(20);await Promise.all([runSearchJob(f.id,repo,f.fetch),runSearchJob(f.id,new Repository(firestore),f.fetch)]);const job=await finish(f.id,f.fetch);assert.equal(job.leads_created,10);assert.equal((await repo.getLeads({freelancer_id:f.workspace,limit:0})).total,10);
});
test('retry and a second search associate duplicates without overwriting commercial history',async()=>{
  const f=await fixture(2);await finish(f.id,f.fetch);const leads=(await repo.getLeads({freelancer_id:f.workspace,limit:0})).leads;
  await repo.updateLead(leads[0].id,{pipeline_status:'FECHADO',is_favorite:true,is_hidden:true,sale_value:350,contact_attempts_count:4});await repo.addLeadNote(leads[0].id,f.workspace,'Keep this history');
  const second={...f.job,id:`job_${unique()}`};await repo.createSearchJob(second,[{...f.area,search_job_id:second.id}]);const job=await finish(second.id,f.fetch);
  assert.equal(job.leads_created,0);assert.equal(job.duplicates_count,2);assert.equal(job.results_count,2);
  const updated=await repo.getLeadById(leads[0].id);assert.equal(updated!.pipeline_status,'FECHADO');assert.equal(updated!.contact_attempts_count,4);assert.equal(updated!.sale_value,350);assert.equal(updated!.is_hidden,true);
  assert.equal((await repo.getLeadNotes(leads[0].id)).length,1);assert.equal((await repo.getLeads({freelancer_id:f.workspace,search_job_id:second.id,limit:0})).total,2);
});
test('different niches and workspaces have stable distinct IDs',async()=>{
  const w=`free_${unique()}`,p=unique();const a=await seedLead(w,p,'odontologia');const b=await seedLead(w,p,'barbearia');const c=await seedLead(`free_${unique()}`,p,'odontologia');assert.equal(new Set([a.id,b.id,c.id]).size,3);
});
test('legacy lead IDs are preserved on deduplication',async()=>{
  const w=`free_${unique()}`,lead=await seedLead(w);await firestore.collection('leads').doc(lead.id).delete();const legacy={...lead,id:`old_${unique()}`,pipeline_status:'FECHADO' as const};await firestore.collection('leads').doc(legacy.id).set(legacy);
  const saved=await repo.createLead({...lead,pipeline_status:'NOVO'});assert.equal(saved.created,false);assert.equal(saved.lead.id,legacy.id);assert.equal(saved.lead.pipeline_status,'FECHADO');
});
test('niche and commercial filters reject barbers, low ratings, websites and closed businesses',async()=>{
  assert.equal(isPlaceRelevantToNiche({name:'Barbearia Sorriso',raw_types:['barber_shop']},'clínicas odontológicas'),false);
  assert.equal(isPlaceRelevantToNiche({name:'Clínica Odontológica',raw_types:['barber_shop']},'odontologia'),false);
  assert.equal(isPlaceRelevantToNiche({name:'Oficina de violinos',raw_types:['point_of_interest']},'oficina de violinos'),true);
  assert.equal(isPlaceRelevantToNiche({name:'Outra Empresa',raw_types:['point_of_interest']},'especialista em violinos'),false);
  const f=await fixture(0);f.places.push(candidate(unique(),{types:['barber_shop'],displayName:{text:'Barbearia'}}),candidate(unique(),{rating:3.9}),candidate(unique(),{websiteUri:'https://example.test'}),candidate(unique(),{businessStatus:'CLOSED_PERMANENTLY'}),candidate(unique()));
  const job=await finish(f.id,f.fetch);assert.equal(job.leads_created,1);assert.equal(job.rejected_count,4);
});
test('write failure does not increment counters or create phantom results',async()=>{
  const f=await fixture();class Failing extends Repository{override async createLeadInTransaction():Promise<any>{throw Object.assign(new Error('Injected quota failure'),{code:8});}}
  await assert.rejects(runSearchJob(f.id,new Failing(firestore),f.fetch));const job=await repo.getSearchJob(f.id);assert.equal(job!.leads_created,0);assert.notEqual(job!.status,'completed');assert.equal((await repo.getLeads({freelancer_id:f.workspace,limit:0})).total,0);
  await repo.updateSearchJob(f.id,{retry_at:0});assert.equal((await finish(f.id,f.fetch)).leads_created,10);
});
test('Firestore permission, quota, network and deadline failures propagate without replacement data',async()=>{
  const f=await fixture(2);await finish(f.id,f.fetch);
  for(const code of [7,8,14,4]){const failing=new Repository({runTransaction:async()=>{throw Object.assign(new Error('Injected failure'),{code});}} as any);await assert.rejects(failing.getLeads({freelancer_id:f.workspace}),e=>(e as any).code===code);}
  assert.equal((await repo.getLeads({freelancer_id:f.workspace,limit:0})).total,2);
});
test('expired lease after interruption resumes a persisted page without another Google call',async()=>{
  const f=await fixture();await repo.updateSearchJob(f.id,{status:'running',lease_token:'dead-process',lease_until:Date.now()-1,candidates:f.places,candidate_cursor:0});
  const job=await finish(f.id,async()=>{throw new Error('Should use checkpoint');},new Repository(firestore));assert.equal(job.leads_created,10);
});
test('bounded worker budget leaves recoverable state rather than false success',async()=>{
  const f=await fixture();await runSearchJob(f.id,repo,f.fetch,0);assert.equal((await repo.getSearchJob(f.id))!.status,'running');assert.equal((await finish(f.id,f.fetch)).leads_created,10);
});
test('pause/cancel fence an in-flight Google response; resume and repeated deliveries are safe',async()=>{
  const f=await fixture();let entered!:()=>void;let release!:(value:any)=>void;const ready=new Promise<void>(r=>entered=r);const blocked=new Promise<any>(r=>release=r);
  const running=runSearchJob(f.id,repo,async()=>{entered();return blocked;});await ready;await pauseSearchJob(f.id,repo);release({places:f.places});await running;assert.equal((await repo.getSearchJob(f.id))!.leads_created,0);
  await resumeSearchJob(f.id,repo);assert.equal((await finish(f.id,f.fetch)).leads_created,10);await runSearchJob(f.id,repo,f.fetch);assert.equal((await repo.getSearchJob(f.id))!.leads_created,10);
  const cancelled=await fixture();await cancelSearchJob(cancelled.id,repo);await runSearchJob(cancelled.id,repo,cancelled.fetch);assert.equal((await repo.getSearchJob(cancelled.id))!.leads_created,0);assert.equal(await resumeSearchJob(cancelled.id,repo),false);
});
test('Google timeout is visible and retryable, never exhaustion',async()=>{
  const f=await fixture();await assert.rejects(runSearchJob(f.id,repo,async()=>{throw new DOMException('Timeout','TimeoutError');}));const job=await repo.getSearchJob(f.id);assert.notEqual(job!.status,'completed');assert.equal(job!.leads_created,0);assert.ok(job!.retry_at!>Date.now());
});
test('pagination and duplicates across pages do not inflate counters',async()=>{
  const f=await fixture(10);let calls=0;const fetch=async()=>{calls++;return calls===1?{places:f.places.slice(0,5),nextPageToken:'second'}:{places:f.places};};const job=await finish(f.id,fetch);assert.equal(job.leads_created,10);assert.equal(job.places_found,10);assert.equal(calls,2);
});
test('legacy jobs are preserved and paused instead of being marked completed',async()=>{
  const f=await fixture();await repo.updateSearchJob(f.id,{version:1});await runSearchJob(f.id,repo,f.fetch);assert.equal((await repo.getSearchJob(f.id))!.status,'paused');
});
test('concurrent contacts and updates preserve all commercial fields',async()=>{
  const lead=await seedLead(`free_${unique()}`);await Promise.all(Array.from({length:6},()=>repo.contactLead(lead.id)));await Promise.all([repo.updateLead(lead.id,{is_favorite:true}),repo.updateLead(lead.id,{is_hidden:true})]);const saved=await repo.getLeadById(lead.id);assert.equal(saved!.contact_attempts_count,6);assert.ok(saved!.is_favorite&&saved!.is_hidden);
});
test('deletion preserves snapshot and notes, blocks resurrection and appears in fresh reads',async()=>{
  const w=`free_${unique()}`,lead=await seedLead(w);await repo.addLeadNote(lead.id,w,'Preserved');await repo.deleteLead(lead.id);assert.equal(await repo.getLeadById(lead.id),undefined);assert.equal((await repo.createLead(lead)).isDeleted,true);assert.equal((await repo.getLeads({freelancer_id:w,limit:0})).total,0);assert.equal((await repo.get<any>('deleted_leads',lead.id)).lead.name,lead.name);assert.equal((await repo.getLeadNotes(lead.id)).length,1);
});
test('API freelancer cannot read/update/delete another workspace or change ownership',async()=>{
  const a=`free_${unique()}`,b=`free_${unique()}`,lead=await seedLead(b),own=await seedLead(a),token=await freelancer(a);
  for(const method of ['get','patch','delete'] as const){const res=await request(app)[method](`/api/leads/${lead.id}`).set('Authorization',`Bearer ${token}`).send({name:'Attack'});assert.equal(res.status,403);}
  assert.equal((await request(app).get('/api/leads?freelancer_id=ALL').set('Authorization',`Bearer ${token}`)).status,403);
  const res=await request(app).patch(`/api/leads/${own.id}`).set('Authorization',`Bearer ${token}`).send({workspace_id:b,freelancer_id:b,id:lead.id,place_id:'overwrite',name:'Allowed'});assert.equal(res.status,200);assert.equal((await repo.getLeadById(own.id))!.workspace_id,a);assert.equal((await repo.getLeadById(lead.id))!.name,'Clínica Teste');
});
test('API protects jobs, notes, favorites, pipeline, reset and admin routes',async()=>{
  const f=await fixture(1),a=`free_${unique()}`,token=await freelancer(a);await finish(f.id,f.fetch);const lead=(await repo.getLeads({freelancer_id:f.workspace,limit:0})).leads[0];
  for(const suffix of ['favorite','hide','notes','contact-attempt','register-sale'])assert.equal((await request(app).post(`/api/leads/${lead.id}/${suffix}`).set('Authorization',`Bearer ${token}`).send({content:'attack'})).status,403);
  for(const suffix of ['pause','resume','cancel','process'])assert.equal((await request(app).post(`/api/search-jobs/${f.id}/${suffix}`).set('Authorization',`Bearer ${token}`)).status,403);
  assert.equal((await request(app).post('/api/pipeline/move').set('Authorization',`Bearer ${token}`).send({leadId:lead.id,toStatus:'FECHADO'})).status,403);
  for(const path of ['/api/admin/freelancers','/api/admin/dashboard/stats','/api/settings']){assert.equal((await request(app).get(path)).status,401);assert.equal((await request(app).get(path).set('Authorization',`Bearer ${token}`)).status,403);}
});
test('legacy credentials denied; configured admin login, logout and link revocation persist',async()=>{
  assert.equal((await request(app).post('/api/auth/login').send({email:'admin',password:'admin'})).status,410);
  assert.equal((await request(app).post('/api/admin/login').send({email:'admin@example.test',password:'admin'})).status,401);
  const login=await request(app).post('/api/admin/login').send({email:'admin@example.test',password:'isolated-test-password'});assert.equal(login.status,200);
  await request(app).post('/api/admin/logout').set('Authorization',`Bearer ${login.body.token}`);assert.equal((await request(app).get('/api/admin/me').set('Authorization',`Bearer ${login.body.token}`)).status,401);
  const w=`free_${unique()}`,token=await freelancer(w);await repo.regenerateFreelancerAccessCode(w);assert.equal((await request(app).get('/api/leads').set('Authorization',`Bearer ${token}`)).status,403);
});
test('signed public preview contains only public fields and cannot expose commercial history',async()=>{
  const w=`free_${unique()}`,lead=await seedLead(w),token=await freelancer(w);
  await repo.updateLead(lead.id,{notes:'private',sale_value:500,contact_attempts_count:3});
  const link=await request(app).post(`/api/leads/${lead.id}/preview-link`).set('Authorization',`Bearer ${token}`);assert.equal(link.status,200);
  const query=link.body.path.split('?')[1];const result=await request(app).get(`/api/public-preview/${lead.id}?${query}`);assert.equal(result.status,200);assert.equal(result.body.lead.name,lead.name);for(const key of ['notes','sale_value','contact_attempts_count','freelancer_id'])assert.equal(result.body.lead[key],undefined);
  assert.equal((await request(app).get(`/api/public-preview/${lead.id}?expires=9999999999999&signature=wrong`)).status,403);
});
test('freelancer reset preserves other workspaces; own favorites/notes/pipeline remain usable',async()=>{
  const a=`free_${unique()}`,b=`free_${unique()}`,own=await seedLead(a),other=await seedLead(b),token=await freelancer(a);
  assert.equal((await request(app).post(`/api/leads/${own.id}/favorite`).set('Authorization',`Bearer ${token}`)).status,200);
  assert.equal((await request(app).post(`/api/leads/${own.id}/notes`).set('Authorization',`Bearer ${token}`).send({content:'Note'})).status,200);
  assert.equal((await request(app).post('/api/pipeline/move').set('Authorization',`Bearer ${token}`).send({leadId:own.id,toStatus:'INTERESSADO'})).status,200);
  assert.equal((await request(app).post('/api/freelancer/workspace/reset').set('Authorization',`Bearer ${token}`).send({freelancerId:b})).status,403);
  assert.equal((await request(app).delete('/api/leads/all').set('Authorization',`Bearer ${token}`)).status,200);assert.ok(await repo.getLeadById(other.id));assert.equal(await repo.getLeadById(own.id),undefined);
});
test('Firestore rules deny browser clients including fake Firebase admins',async()=>{
  const env=await initializeTestEnvironment({projectId:'demo-ghprospeccao',firestore:{host:'127.0.0.1',port:8088,rules:fs.readFileSync('firestore.rules','utf8')}});
  for(const ctx of [env.unauthenticatedContext(),env.authenticatedContext('other'),env.authenticatedContext('admin',{admin:true})]){await assertFails(getDoc(doc(ctx.firestore(),'leads','private')));await assertFails(setDoc(doc(ctx.firestore(),'leads','attack'),{name:'Attack'}));}await env.cleanup();
});
test('actual Places adapter sends pagination, rejects HTTP errors, uses mock network only',async()=>{
  const saved=globalThis.fetch;try{globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init!.body as string);assert.equal(body.pageToken,'page2');assert.ok(init!.signal);return new Response(JSON.stringify({places:[candidate('mock')]}),{status:200});};assert.equal((await searchPage('odontologia','mock',{pageToken:'page2'})).places.length,1);globalThis.fetch=async()=>new Response('{}',{status:429});await assert.rejects(searchPage('x','mock'),/PLACES_HTTP_429/);}finally{globalThis.fetch=saved;}
});
after(async()=>{await firestore.terminate();});
