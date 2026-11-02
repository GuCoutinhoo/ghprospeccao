import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { isLocalTestWorkspace, localTestOverrides } from '../src/lib/localTest';
import { api, getActiveFreelancerSession } from '../src/lib/api';

// Browser mock: no real API credentials, network requests, or Supabase database.
const store = new Map<string,string>();
const localStorageMock = {
  getItem: (key:string) => store.get(key) ?? null,
  setItem: (key:string,value:string) => { store.set(key,String(value)); },
  removeItem: (key:string) => { store.delete(key); },
};
Object.defineProperty(globalThis, 'window', { configurable:true, value: { location: { pathname: '/f/test' } } });
Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:localStorageMock });
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { configurable:true,value:webcrypto });

test('original API uses local adapter only in /f/test, no password or Supabase call', async()=>{
  assert.equal(isLocalTestWorkspace(),true);
  assert.equal(getActiveFreelancerSession()?.freelancer.access_code,'test');
  const result=await api.verifyFreelancerLink('test');
  assert.equal(result.freelancer.name,'test');
  const leads=await api.getLeads({limit:0});
  assert.equal(leads.total,0);
  assert.notEqual(api.getLeads, undefined);
  (window as any).location.pathname='/f/DANILO';
  assert.equal(isLocalTestWorkspace(),true);
  assert.equal(getActiveFreelancerSession()?.freelancer.access_code,'danilo');
  assert.equal((await api.verifyFreelancerLink('danilo')).freelancer.name,'Danilo');
  assert.equal((await api.getLeads({limit:0})).total,0);
  assert.equal(api.getLeads,localTestOverrides.getLeads);
  (window as any).location.pathname='/f/other';
  assert.equal(isLocalTestWorkspace(),false);
  assert.notEqual(api.getLeads,localTestOverrides.getLeads);
  (window as any).location.pathname='/f/test';
});

test('legacy browser leads migrate once; hide and notes persist after re-reading storage',async()=>{
  store.clear();
  localStorageMock.setItem('gh_temporary_test_prospecting_v1',JSON.stringify([
    { id:'old-123',name:'Clínica de teste',state:'SP',city:'Campinas',niche:'Odontologia',
      address:'Rua Teste',phone:'11999999999',website:'',rating:4,reviews:8,notes:'Primeira anotação' },
  ]));
  const first=await api.getLeads({limit:0});
  assert.equal(first.total,1);
  const hidden=await api.toggleLeadHide('old-123',true);
  assert.equal(hidden.is_hidden,true);
  assert.equal((await api.getLeads({limit:0})).leads[0].is_hidden,true);
  const note=await api.addLeadNote('old-123','Ligar amanhã');
  assert.equal(note.content,'Ligar amanhã');
  assert.equal((await api.getLeadById('old-123')).notes[0].content,'Ligar amanhã');
  await api.deleteLead('old-123');
  assert.equal((await api.getLeads({limit:0})).total,0);
});

test('original search job creates and saves only browser leads, no Supabase writes',async()=>{
  const calls:string[]=[];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(async(input:RequestInfo|URL)=>{
    calls.push(String(input));
    return { ok:true, status:200, json:async()=>({
      leads:[{id:'google-place-1',name:'Odonto A',state:'SP',city:'Campinas',
        niche:'clínicas odontológicas',phone:'11987654321',website:'',rating:4.7,
        reviews:12,address:'Rua das Flores',mapsUrl:'https://maps.google.com/?q=1',
        capturedAt:new Date().toISOString()}],scanned:1,nextPageToken:null,
    }) } as Response;
  });
  try {
    const created=await api.createSearchJob({ state:'SP',city:'Campinas',
      niche:'clínicas odontológicas',
      filters:{onlyWithoutWebsite:true,onlyWithPhone:false,minRating:0,minReviews:0,targetLeads:10},
    });
    assert.equal(created.job.status,'running');
    const job=await api.stepSearchJob(created.job.id);
    assert.equal(job.status,'completed');
    assert.equal(job.leads_created,1);
    const leadResult=await api.getLeads({search_job_id:job.id,limit:0});
    assert.equal(leadResult.total,1);
    assert.equal(leadResult.leads[0].name,'Odonto A');
    assert.ok(calls.length>0);
    assert.ok(calls.every(path=>path==='/api/temporary/search'));
  } finally { globalThis.fetch=originalFetch; }
});


test('duplicate filters skip hidden and renamed Google IDs, then continue pages until unique goal', async()=>{
  store.clear();
  localStorageMock.setItem('gh_temporary_test_prospecting_v1', JSON.stringify([{
    id:'existing-place',name:'Clínica Sorriso',city:'Campinas',state:'SP',
    niche:'Odontologia',phone:'(19) 99999-1234',address:'Av. Brasil, 200',
    status:'CONTATADO',hidden:true,notes:'Já prospectado',
  }]));
  const existing=(await api.getLeads({limit:0})).leads[0];
  assert.ok(existing.is_hidden);
  const snapshot=JSON.stringify(existing);
  const fetchOriginal=globalThis.fetch;
  const dateNowOriginal=Date.now;
  let time=100_000;
  Date.now=()=>time;
  const requests:string[]=[];
  globalThis.fetch=(async (_input: RequestInfo|URL, init?: RequestInit)=>{
    requests.push(String(_input));
    const payload=JSON.parse(String(init?.body || '{}'));
    const first=!payload.pageToken;
    const dupExisting={id:'different-google-id',name:'Clinica Sorriso',city:'Campinas',state:'SP',
      phone:'+55 19 99999-1234',address:'Rua Mudou, 999'};
    const dupAddress={id:'another-google-id',name:'CLINICA SORRISO',city:'Campinas',state:'SP',
      phone:'',address:'Avenida Brasil, 200'};
    const firstNew={id:'new-a',name:'Odonto Azul',city:'Campinas',state:'SP',address:'Rua A, 100',
      phone:'(19) 98765-1111',website:'',rating:4.5,reviews:8};
    const secondNew={id:'new-b',name:'Odonto Verde',city:'Campinas',state:'SP',address:'Rua B, 222',
      phone:'(19) 98765-2222',website:'',rating:4.1,reviews:15};
    const leads=first ? [dupExisting,dupAddress,firstNew,{...firstNew,id:'changed-id-same-business'}]
      : [{...firstNew,id:'another-id-a'},secondNew,{...secondNew,id:'id-b-other'}];
    return {ok:true,status:200,json:async()=>({leads,scanned:leads.length,nextPageToken:first?'next-1':null})} as Response;
  });
  try {
    const {job}=await api.createSearchJob({state:'SP',city:'Campinas',niche:'Odontologia',
      filters:{onlyWithoutWebsite:false,onlyWithPhone:false,minRating:0,minReviews:0,targetLeads:2}});
    const first=await api.stepSearchJob(job.id);
    assert.equal(first.status,'running');
    assert.equal(first.leads_created,1);
    time+=4000;
    const second=await api.stepSearchJob(job.id);
    assert.equal(second.status,'completed');
    assert.equal(second.leads_created,2);
    const saved=(await api.getLeads({limit:0})).leads;
    assert.equal(saved.length,3);
    assert.deepEqual(saved.map(l=>l.id).sort(),['existing-place','new-a','new-b']);
    assert.equal(JSON.stringify(saved.find(l=>l.id==='existing-place')),snapshot);
    assert.equal((await api.getLeads({search_job_id:job.id,limit:0})).total,2);
    assert.equal(requests.length,2);
    assert.ok(requests.every(x=>x==='/api/temporary/search'));
  } finally { globalThis.fetch=fetchOriginal;Date.now=dateNowOriginal; }
});

test('deleted local leads stay deduplicated; exhaustion stops short of target',async()=>{
  // The previous test stored new-b identity in the browser-only ledger.
  const original=globalThis.fetch;
  const calls:string[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL)=>{
    calls.push(String(input));
    return {ok:true,status:200,json:async()=>({
      leads:[{id:'new-b',name:'Odonto Verde',city:'Campinas',state:'SP',
        address:'Rua B, 222',phone:'19987652222'}],
      scanned:1,nextPageToken:null,
    })} as Response;
  });
  try {
    await api.deleteLead('new-b');
    const {job}=await api.createSearchJob({state:'SP',city:'Campinas',niche:'Odontologia',
      filters:{onlyWithoutWebsite:false,onlyWithPhone:false,minRating:0,minReviews:0,targetLeads:10}});
    const finished=await api.stepSearchJob(job.id);
    assert.equal(finished.status,'completed');
    assert.equal(finished.leads_created,0);
    assert.equal((await api.getLeads({limit:0})).total,2);
    assert.equal(calls.length,1);
  } finally {globalThis.fetch=original;}
});

test('identity matching is conservative for different businesses with shared phone',async()=>{
  const {prospectIdentityKeys,isAlreadyCollected,addCollectedIdentity}=await import('../src/lib/search/localDedup');
  const keys=new Set<string>();
  addCollectedIdentity({id:'a',name:'Clínica Sorriso',phone:'(19) 99999-1234',
    city:'Campinas',state:'SP',address:'Av. Brasil, 200'},keys);
  assert.ok(isAlreadyCollected({id:'b',name:'Clinica Sorriso',phone:'+55 19 99999-1234',
    city:'Campinas',state:'SP',address:'Outra rua, 500'},keys));
  assert.ok(isAlreadyCollected({id:'c',name:'Clínica Sorriso',city:'Campinas',
    state:'SP',address:'Avenida Brasil, 200'},keys));
  assert.equal(isAlreadyCollected({id:'d',name:'Outra Empresa',phone:'19999991234',
    city:'Campinas',state:'SP',address:'Rua B, 201'},keys),false);
  assert.ok(prospectIdentityKeys({id:'a'}).includes('id:a'));
});


test('DANILO has distinct browser storage, preserves TEST hidden leads and never accesses Supabase',async()=>{
  store.clear();
  // Only TEST has the historical migration source.
  localStorageMock.setItem('gh_temporary_test_prospecting_v1',JSON.stringify([{
    id:'historical-test-id',name:'Lead exclusivo TEST',state:'SP',city:'Campinas',
    niche:'Barbearia',hidden:true,phone:'11988888888',
  }]));
  (window as any).location.pathname='/f/test';
  const testBefore=await api.getLeads({limit:0});
  assert.equal(testBefore.total,1);
  assert.equal(testBefore.leads[0].is_hidden,true);
  const testSnapshot=store.get('gh_local_test_original_ui_leads_v1');

  (window as any).location.pathname='/f/danilo';
  assert.equal((await api.verifyFreelancerLink('danilo')).freelancer.id,'gh_local_danilo');
  assert.equal((await api.getLeads({limit:0})).total,0);
  assert.equal(store.get('gh_local_danilo_original_ui_leads_v1'),undefined);

  const originalFetch=globalThis.fetch;
  const calls:string[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL)=>{
    calls.push(String(input));
    return {ok:true,status:200,json:async()=>({
      leads:[{id:'danilo-new-1',name:'Empresa Danilo',state:'SP',city:'Campinas',
        niche:'Clínica',phone:'11977777777',website:'',rating:4.2,
        reviews:11,address:'Av Danilo, 90',capturedAt:new Date().toISOString()}],
      scanned:1,nextPageToken:null,
    })} as Response;
  });
  try {
    const created=await api.createSearchJob({state:'SP',city:'Campinas',niche:'Clínica',
      filters:{onlyWithoutWebsite:true,onlyWithPhone:false,minRating:0,minReviews:0,targetLeads:5}});
    assert.equal(created.job.freelancer_id,'gh_local_danilo');
    const result=await api.stepSearchJob(created.job.id);
    assert.equal(result.leads_created,1);
    assert.equal(result.status,'completed');
    assert.deepEqual(calls,['/api/temporary/search']);
    assert.equal((await api.getLeads({limit:0})).total,1);
    const hidden=await api.toggleLeadHide('danilo-new-1',true);
    assert.equal(hidden.is_hidden,true);
    const note=await api.addLeadNote('danilo-new-1','Falar amanhã');
    assert.equal(note.content,'Falar amanhã');
    assert.equal((await api.getLeadById('danilo-new-1')).notes[0].content,'Falar amanhã');
    assert.equal((await api.getLeads({limit:0})).leads[0].is_hidden,true);
    assert.ok(store.get('gh_local_danilo_original_ui_notes_v1'));
  } finally {globalThis.fetch=originalFetch;}
  (window as any).location.pathname='/f/test';
  assert.equal(store.get('gh_local_test_original_ui_leads_v1'),testSnapshot);
  assert.equal((await api.getLeads({limit:0})).total,1);
  assert.equal((await api.getLeads({limit:0})).leads[0].id,'historical-test-id');
  assert.equal((await api.getLeads({limit:0})).leads[0].is_hidden,true);
  (window as any).location.pathname='/f/DANILO';
  assert.equal((await api.getLeads({limit:0})).leads[0].id,'danilo-new-1');
});

test('DANILO deduplicates its own leads without reading TEST identity history',async()=>{
  store.clear();
  (window as any).location.pathname='/f/danilo';
  const originalFetch=globalThis.fetch;
  const origTime=Date.now;
  let tick=10_000;
  Date.now=()=>tick;
  globalThis.fetch=(async()=>({ok:true,status:200,json:async()=>({
    leads:[{id:'same-place',name:'Empresa compartilhada',state:'SP',city:'Campinas',
      niche:'Odontologia',address:'Rua Um, 123',phone:'(19) 99999-0000'}],
    scanned:1,nextPageToken:null,
  })} as Response));
  try {
    const filters={onlyWithoutWebsite:false,onlyWithPhone:false,minRating:0,minReviews:0,targetLeads:5};
    const search=async()=>{
      const {job}=await api.createSearchJob({state:'SP',city:'Campinas',niche:'Odontologia',filters});
      return api.stepSearchJob(job.id);
    };
    assert.equal((await search()).leads_created,1);
    tick+=4000;
    assert.equal((await search()).leads_created,0);
    assert.equal((await api.getLeads({limit:0})).total,1);
    (window as any).location.pathname='/f/test';
    assert.equal((await api.getLeads({limit:0})).total,0);
    tick+=4000;
    assert.equal((await search()).leads_created,1);
    assert.equal((await api.getLeads({limit:0})).total,1);
    (window as any).location.pathname='/f/danilo';
    assert.equal((await api.getLeads({limit:0})).total,1);
  } finally {
    globalThis.fetch=originalFetch;Date.now=origTime;
    (window as any).location.pathname='/f/test';
  }
});
