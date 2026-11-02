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
