import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { DocumentStore } from '../src/lib/supabase/documentStore';
import { Repository, actorContext } from '../src/lib/store/repository';
import { checkLeadFilters } from '../src/lib/search/searchWorker';
import type { Lead, SearchJob } from '../src/types';

type Row = { collection:string; id:string; workspace_id:string; document:Record<string,any>; revision:number };

process.env.GH_SUPABASE_URL = 'https://tests.supabase.co';
process.env.GH_SUPABASE_SECRET_KEY = 'test-server-secret';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'test-admin-password';

const clone = <T>(value:T):T => JSON.parse(JSON.stringify(value));

function createSupabaseHarness() {
  const rows = new Map<string,Row>();
  let failNextCommit = false;
  const key = (collection:string,id:string) => `${collection}/${id}`;
  const response = (body:unknown,status=200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status,headers:{'content-type':'application/json'}});

  const fetchMock:typeof fetch = async (input,init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/app_records')) {
      const collection = String(url.searchParams.get('collection') || '').replace(/^eq\./,'');
      const id = String(url.searchParams.get('id') || '').replace(/^eq\./,'');
      const workspace = String(url.searchParams.get('workspace_id') || '').replace(/^eq\./,'');
      let result = [...rows.values()].filter(row => !collection || row.collection===collection);
      if(id)result=result.filter(row=>row.id===id);
      if(workspace)result=result.filter(row=>row.workspace_id===workspace);
      return response(result.map(clone));
    }
    if (url.pathname.endsWith('/rpc/gh_commit_changes')) {
      if (failNextCommit) { failNextCommit=false; return response('forced write failure',503); }
      const body=JSON.parse(String(init?.body || '{}')) as {p_reads:Array<{collection:string;id:string;revision:number}>;p_operations:Array<{collection:string;id:string;op:string;document?:Record<string,any>}>};
      for(const read of body.p_reads || []) {
        const current=rows.get(key(read.collection,read.id));
        if((current?.revision || 0)!==read.revision)return response('GH_TX_CONFLICT',409);
      }
      for(const operation of body.p_operations || []) {
        const mapKey=key(operation.collection,operation.id);
        const current=rows.get(mapKey);
        if(operation.op==='create' && current)return response('23505 duplicate key value violates unique constraint',409);
        if(operation.op==='update' && !current)return response('missing record',404);
        if(operation.op==='delete'){rows.delete(mapKey);continue;}
        const document=['merge','update'].includes(operation.op)?{...(current?.document || {}),...(operation.document || {})}:clone(operation.document || {});
        rows.set(mapKey,{collection:operation.collection,id:operation.id,workspace_id:String(document.workspace_id || document.freelancer_id || document.user_id || 'admin'),document,revision:(current?.revision || 0)+1});
      }
      return response(true);
    }
    throw new Error(`Unexpected request ${url}`);
  };
  return {rows,fetchMock,failCommit(){failNextCommit=true;}};
}

function lead(overrides:Partial<Lead>={}):Lead {
  const stamp='2026-10-17T12:00:00.000Z';
  return {id:'candidate',workspace_id:'free_alpha',user_id:'free_alpha',freelancer_id:'free_alpha',place_id:'place-1',name:'Lead A',niche:'barbearia',state:'SP',city:'São Paulo',website:'',website_status:'no_website',phone:'11999999999',rating:3.5,reviews_count:20,lead_score:80,pipeline_status:'NOVO',is_hidden:false,is_favorite:false,created_at:stamp,updated_at:stamp,...overrides};
}

function searchJob(id:string,workspace:string):SearchJob {
  const stamp='2026-10-17T12:00:00.000Z';
  return {id,workspace_id:workspace,user_id:workspace,freelancer_id:workspace,state:'SP',city:'São Paulo',niche:'barbearia',status:'pending',filters:{onlyWithoutWebsite:true,onlyWithPhone:true,minRating:3.5,maxRating:4.5,minReviews:10,maxReviews:30},total_cities:1,processed_cities:0,total_search_areas:0,processed_search_areas:0,places_found:0,places_without_website:0,leads_created:0,created_at:stamp,updated_at:stamp};
}

test('persiste alterações comerciais e uma nova instância lê o mesmo estado', async () => {
  const harness=createSupabaseHarness(); globalThis.fetch=harness.fetchMock;
  const first=new Repository(new DocumentStore());
  const created=await first.createLead(lead());
  await first.toggleHideLead(created.lead.id,true);
  await first.toggleFavoriteLead(created.lead.id);
  await first.updateLead(created.lead.id,{pipeline_status:'CONTATADO',notes:'Retornar amanhã'});
  const second=new Repository(new DocumentStore());
  const persisted=await second.getLeadById(created.lead.id);
  assert.equal(persisted?.is_hidden,true);
  assert.equal(persisted?.is_favorite,true);
  assert.equal(persisted?.pipeline_status,'CONTATADO');
  assert.equal(persisted?.notes,'Retornar amanhã');
});

test('impede duplicação sob concorrência usando identidade determinística e retry otimista', async () => {
  const harness=createSupabaseHarness(); globalThis.fetch=harness.fetchMock;
  const repository=new Repository(new DocumentStore());
  const [a,b]=await Promise.all([repository.createLead(lead()),repository.createLead(lead({id:'other'}))]);
  assert.equal([a,b].filter(result=>result.created).length,1);
  assert.equal([...harness.rows.values()].filter(row=>row.collection==='leads').length,1);
});

test('falha de escrita não é mascarada nem altera o estado persistido', async () => {
  const harness=createSupabaseHarness(); globalThis.fetch=harness.fetchMock;
  const repository=new Repository(new DocumentStore());
  const created=await repository.createLead(lead());
  harness.failCommit();
  await assert.rejects(repository.toggleHideLead(created.lead.id,true),/Supabase storage failure/);
  assert.equal((await repository.getLeadById(created.lead.id))?.is_hidden,false);
});

test('contexto de freelancer bloqueia leitura e mutação de outro workspace', async () => {
  const harness=createSupabaseHarness(); globalThis.fetch=harness.fetchMock;
  const repository=new Repository(new DocumentStore());
  const foreign=await repository.createLead(lead({workspace_id:'free_beta',freelancer_id:'free_beta',user_id:'free_beta'}));
  await actorContext.run({role:'freelancer',freelancerId:'free_alpha'},async()=>{
    await assert.rejects(repository.getLeadById(foreign.lead.id),/Acesso negado/);
    const visible=await repository.getLeads({freelancer_id:'ALL',limit:0});
    assert.equal(visible.total,0);
  });
});

test('filtros respeitam nota decimal, avaliações, telefone e ausência real de site', () => {
  const filters={onlyWithoutWebsite:true,onlyWithPhone:true,minRating:3.5,maxRating:4,minReviews:10,maxReviews:30};
  assert.equal(checkLeadFilters({website:'',website_status:'no_website',phone:'11999999999',rating:3.5,reviews_count:30},filters),true);
  assert.equal(checkLeadFilters({website:'https://exemplo.com',website_status:'website_found',phone:'11999999999',rating:3.5,reviews_count:20},filters),false);
  assert.equal(checkLeadFilters({website:'',website_status:'no_website',phone:'11999999999',rating:3.49,reviews_count:20},filters),false);
  assert.equal(checkLeadFilters({website:'',website_status:'no_website',phone:'11999999999',rating:3.8,reviews_count:31},filters),false);
});

test('lease persistido permite apenas um worker e pode ser renovado/liberado pelo dono', async () => {
  const harness=createSupabaseHarness(); globalThis.fetch=harness.fetchMock;
  const repository=new Repository(new DocumentStore());
  await repository.createSearchJob(searchJob('job-1','free_alpha'));
  assert.equal(await repository.claimSearchJob('job-1','worker-a'),true);
  assert.equal(await repository.claimSearchJob('job-1','worker-b'),false);
  assert.equal(await repository.renewSearchJobLease('job-1','worker-b'),false);
  assert.equal(await repository.renewSearchJobLease('job-1','worker-a'),true);
  assert.equal(await repository.releaseSearchJobLease('job-1','worker-a'),true);
  assert.equal(await repository.claimSearchJob('job-1','worker-b'),true);
});

test('links personalizados são normalizados e únicos sem perder registros existentes', async () => {
  const harness=createSupabaseHarness(); globalThis.fetch=harness.fetchMock;
  const repository=new Repository(new DocumentStore());
  const a=await repository.createFreelancer({name:'João Silva',email:'a@example.com',access_code:'João Silva'});
  const b=await repository.createFreelancer({name:'João Silva',email:'b@example.com',access_code:'João Silva'});
  assert.equal(a.access_code,'joao-silva');
  assert.match(b.access_code,/^joao-silva-[a-f0-9]{6}$/);
  assert.equal((await repository.getFreelancers()).length,2);
});

test('API rejeita acesso anônimo e não expõe leads de outro workspace', async () => {
  const harness=createSupabaseHarness(); globalThis.fetch=harness.fetchMock;
  const repository=new Repository(new DocumentStore());
  const freelancer=await repository.createFreelancer({name:'Workspace Alpha',email:'alpha@example.com',access_code:'alpha'});
  const own=await repository.createLead(lead({workspace_id:freelancer.id,freelancer_id:freelancer.id,user_id:freelancer.id,place_id:'own-place'}));
  const foreign=await repository.createLead(lead({workspace_id:'free_beta',freelancer_id:'free_beta',user_id:'free_beta',place_id:'foreign-place'}));
  const {app}=await import('../src/server/app');
  await request(app).get('/api/leads').expect(401);
  await request(app).post('/api/sync').expect(401);
  const login=await request(app).post('/api/freelancer/auth/verify').send({accessCode:'alpha'}).expect(200);
  const listing=await request(app).get('/api/leads?limit=0').set('Authorization',`Bearer ${login.body.token}`).expect(200);
  assert.deepEqual(listing.body.leads.map((item:Lead)=>item.id),[own.lead.id]);
  assert.equal(listing.body.leads.some((item:Lead)=>item.id===foreign.lead.id),false);
  await request(app).post('/api/freelancer/logout').set('Authorization',`Bearer ${login.body.token}`).expect(200);
  await request(app).get('/api/leads').set('Authorization',`Bearer ${login.body.token}`).expect(401);
  assert.equal(await new Repository(new DocumentStore()).isSessionRevoked(login.body.token),true);
});


test('login responde antes de auditoria lenta e mantém os leads intactos', async () => {
  const harness = createSupabaseHarness();
  globalThis.fetch = harness.fetchMock;
  const repository = new Repository(new DocumentStore());
  const freelancer = await repository.createFreelancer({
    name: 'Workspace Danilo teste',
    email: 'test-login@example.com',
    access_code: 'test-danilo',
  });
  const originalLead = (await repository.createLead(lead({
    workspace_id: freelancer.id,
    freelancer_id: freelancer.id,
    user_id: freelancer.id,
    place_id: 'login-read-only-lead',
  }))).lead;

  let unblockCommit!: () => void;
  const blockedCommit = new Promise<void>((resolve) => { unblockCommit = resolve; });
  const normalFetch = harness.fetchMock;
  let pauseNextCommit = true;
  globalThis.fetch = async (input, init) => {
    if (pauseNextCommit && String(input).includes('/rpc/gh_commit_changes')) {
      pauseNextCommit = false;
      await blockedCommit; // Simula Supabase travado ao gravar atividade.
    }
    return normalFetch(input, init);
  };

  const { app } = await import('../src/server/app');
  const login = request(app)
    .post('/api/freelancer/auth/verify')
    .send({accessCode: 'test-danilo'})
    .expect(200)
    .then(response => response);
  let respondedBeforeTelemetry = false;
  try {
    respondedBeforeTelemetry = await Promise.race([
      login.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 1000)),
    ]);
  } finally {
    unblockCommit();
  }

  assert.equal(respondedBeforeTelemetry, true, 'login não deve aguardar atualização de atividade');
  const response = await login;
  assert.equal(response.body.freelancer.id, freelancer.id);
  assert.equal(typeof response.body.token, 'string');
  const existing = await repository.getLeadById(originalLead.id);
  assert.deepEqual(existing, originalLead);
});


test('login de freelancer não grava telemetria nem altera registros comerciais', async () => {
  const harness = createSupabaseHarness();
  globalThis.fetch = harness.fetchMock;
  const db = new Repository(new DocumentStore());
  const freelancer = await db.createFreelancer({name:'Sem Escritas',email:'no-write@example.com',access_code:'no-write'});
  const created = await db.createLead(lead({
    workspace_id: freelancer.id,
    freelancer_id: freelancer.id,
    user_id: freelancer.id,
    place_id: 'login-no-write',
    is_hidden: true,
  }));
  let commits = 0;
  globalThis.fetch = async (input,init) => {
    if(String(input).includes('/rpc/gh_commit_changes')) commits++;
    return harness.fetchMock(input,init);
  };
  const { app } = await import('../src/server/app');
  const response = await request(app).post('/api/freelancer/auth/verify').send({accessCode:'no-write'}).expect(200);
  assert.equal(response.body.freelancer.id,freelancer.id);
  assert.equal(commits,0,'login must not perform any RPC writes');
  assert.deepEqual(await db.getLeadById(created.lead.id),created.lead);
});

test('atualizar um freelancer não bloqueia documentos de outros workspaces', async () => {
  const harness = createSupabaseHarness();
  globalThis.fetch = harness.fetchMock;
  const db = new Repository(new DocumentStore());
  const one = await db.createFreelancer({name:'Um',email:'one@example.com',access_code:'one'});
  const two = await db.createFreelancer({name:'Dois',email:'two@example.com',access_code:'two'});
  let reads: Array<{collection:string;id:string}> = [];
  globalThis.fetch = async (input,init) => {
    if(String(input).includes('/rpc/gh_commit_changes')) {
      const body=JSON.parse(String(init?.body||'{}'));
      reads=body.p_reads||[];
    }
    return harness.fetchMock(input,init);
  };
  await db.updateFreelancer(one.id,{notes:'Nova anotação'});
  assert.deepEqual(reads.map(r=>r.id),[one.id]);
  assert.equal((await db.getFreelancerById(two.id))?.notes,undefined);
  await assert.rejects(db.updateFreelancer(one.id,{access_code:'two'}),/Link de acesso já está em uso/);
});
