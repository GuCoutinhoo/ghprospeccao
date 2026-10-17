import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { DocumentStore } from '../src/lib/supabase/documentStore';
import { Repository, actorContext } from '../src/lib/store/repository';
import { checkLeadFilters } from '../src/lib/search/searchWorker';
import { searchPlacesOfficial, searchPlacesAdaptive } from '../src/lib/google/places';
import { prioritizeSearchAreas } from '../src/lib/search/smartScheduler';
import type { Lead, SearchJob, Place, SearchArea } from '../src/types';

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
      const idFilter = String(url.searchParams.get('id') || '');
      const id = idFilter.startsWith('eq.') ? idFilter.slice(3) : '';
      const ids = idFilter.startsWith('in.(') ? idFilter.slice(4,-1).split(',').map(value=>value.replace(/^"|"$/g,'')) : [];
      const workspace = String(url.searchParams.get('workspace_id') || '').replace(/^eq\./,'');
      let result = [...rows.values()].filter(row => !collection || row.collection===collection);
      if(id)result=result.filter(row=>row.id===id);
      if(ids.length)result=result.filter(row=>ids.includes(row.id));
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

test('Nearby geográfico consulta categoria compatível uma única vez, por DISTANCE',async()=>{
  const originalFetch=globalThis.fetch;
  const calls:Array<{url:string;body:Record<string,any>}>=[];
  try {
    globalThis.fetch=async(input,init)=>{
      calls.push({url:String(input),body:JSON.parse(String(init?.body||'{}'))});
      return new Response(JSON.stringify({places:[{
        id:'dental-1', displayName:{text:'Clínica Odontológica'}, rating:3.5,
        userRatingCount:12, types:['dental_clinic'], nationalPhoneNumber:'11999999999'
      }]}),{status:200,headers:{'content-type':'application/json'}});
    };
    const result=await searchPlacesAdaptive('Clínica odontológica em Campinas SP','test-key',{
      locationBias:{circle:{center:{latitude:-22.9,longitude:-47.0},radius:4500}},
      maxResultCount:20,
    });
    assert.equal(calls.length,1,'nunca duplicar busca Text após Nearby bem-sucedido');
    assert.match(calls[0].url,/searchNearby$/);
    assert.deepEqual(calls[0].body.includedTypes,['dentist','dental_clinic']);
    assert.equal(calls[0].body.rankPreference,'DISTANCE');
    assert.equal(result.source,'nearby');
    assert.equal(result.places.length,1);
    assert.equal(checkLeadFilters({website:'',website_status:'no_website',rating:result.places[0].rating,reviews_count:12},{
      onlyWithoutWebsite:true,onlyWithPhone:false,minRating:3,maxRating:3.9,minReviews:0
    }),true);
  } finally {globalThis.fetch=originalFetch;}
});

test('Nearby vazio não executa Text extra, e nicho sem tipo usa Text normalmente',async()=>{
  const initial=globalThis.fetch;
  const calls:string[]=[];
  try {
    globalThis.fetch=async(input)=>{
      calls.push(String(input));
      return new Response(JSON.stringify({places:[]}),{status:200,headers:{'content-type':'application/json'}});
    };
    const opts={locationBias:{circle:{center:{latitude:-23.5,longitude:-46.6},radius:4000}}};
    const nearby=await searchPlacesAdaptive('dentista em São Paulo SP','test-key',opts);
    assert.equal(nearby.source,'nearby');
    assert.equal(calls.length,1);
    assert.match(calls[0],/searchNearby$/);
    const text=await searchPlacesAdaptive('consultoria tributária em São Paulo SP','test-key',opts);
    assert.equal(text.source,'text');
    assert.match(calls[1],/searchText$/);
    assert.equal(calls.length,2);
  } finally {globalThis.fetch=initial;}
});

test('erro no Nearby recorre a Text uma única vez e mantém resultado',async()=>{
  const initial=globalThis.fetch;
  const calls:string[]=[];
  try {
    globalThis.fetch=async(input)=>{
      calls.push(String(input));
      return String(input).includes('searchNearby')
        ? new Response(JSON.stringify({error:{message:'endpoint unavailable'}}),{status:503})
        : new Response(JSON.stringify({places:[{id:'p1',rating:3.2}]}),{status:200});
    };
    const result=await searchPlacesAdaptive('Clínica odontológica em Santos SP','test-key',{
      locationBias:{circle:{center:{latitude:-23.96,longitude:-46.33},radius:3000}}
    });
    assert.equal(result.source,'text');
    assert.equal(result.places.length,1);
    assert.equal(calls.length,2);
  } finally {globalThis.fetch=initial;}
});

test('planejador prioriza cidades novas e depois regiões com mais leads, sem modificar plano',()=>{
  const area=(id:string,city:string,status:SearchArea['status'],newLeads=0):SearchArea=>({
    id,city,state:'SP',search_job_id:'job-priority',lat:-23.5,lng:-46.6,
    radius:4000,status,attempts:0,places_found:20,new_leads:newLeads,
    new_places_found:newLeads>0?18:0,matching_filters:newLeads,
  });
  const seed=[area('s1','São Paulo','completed'),area('s2','São Paulo','pending'),
    area('c1','Campinas','pending'),area('g1','Guarulhos','pending')];
  const original=JSON.stringify(seed);
  assert.equal(prioritizeSearchAreas(seed)[0].city,'Campinas');
  assert.equal(JSON.stringify(seed),original,'scheduler nunca modifica o plano');
  const productive=[area('s1','São Paulo','completed',4),area('s2','São Paulo','pending'),
    area('c1','Campinas','completed',0),area('c2','Campinas','pending')];
  assert.equal(prioritizeSearchAreas(productive)[0].city,'São Paulo');
});

test('cota diária do Search Text é reconhecida sem refazer chamadas inúteis',async()=>{
  let attempts=0;
  const initialFetch=globalThis.fetch;
  try {
    globalThis.fetch=async()=>{
      attempts++;
      return new Response(JSON.stringify({error:{message:"Quota exceeded for quota metric 'SearchTextRequest' and limit 'SearchTextRequest per day'."}}),{
        status:429,headers:{'content-type':'application/json'}
      });
    };
    const result=await searchPlacesOfficial('Clínica odontológica em Campinas SP','fake-valid-key',undefined,3);
    assert.equal(attempts,1);
    assert.equal(result.isQuotaExceeded,true);
    assert.match(result.error||'',/per day/);
    assert.equal(result.places.length,0);
  } finally {
    globalThis.fetch=initialFetch;
  }
});

test('retomada em lote reinicia somente áreas falhas e mantém os leads intactos',async()=>{
  const harness=createSupabaseHarness();globalThis.fetch=harness.fetchMock;
  const repository=new Repository(new DocumentStore());
  const originalLead=(await repository.createLead(lead({is_hidden:true,notes:'preservar'}))).lead;
  const job=searchJob('job-quota','free_alpha');
  const area=(id:string,status:SearchArea['status']):SearchArea=>({
    id,search_job_id:job.id,city:'São Paulo',state:'SP',lat:-23.5,lng:-46.6,
    radius:4000,status,attempts:1,places_found:status==='completed'?20:0
  });
  await repository.createSearchJob({...job,status:'paused',processed_search_areas:3,total_search_areas:4},[
    area('done','completed'),area('quota1','failed'),area('quota2','failed'),area('next','pending')
  ]);
  const before=await repository.getLeadById(originalLead.id);
  let writes=0;
  const originalFetch=harness.fetchMock;
  globalThis.fetch=async(input,init)=>{
    if(String(input).includes('/rpc/gh_commit_changes'))writes++;
    return originalFetch(input,init);
  };
  assert.equal(await repository.prepareSearchJobResume(job.id),true);
  assert.equal(writes,1,'todas as áreas devem ser recuperadas em um único commit');
  const resumed=await repository.getSearchJob(job.id);
  assert.equal(resumed?.status,'pending');
  assert.equal(resumed?.processed_search_areas,1);
  assert.deepEqual(resumed?.area_plan?.map(a=>a.status),['completed','pending','pending','pending']);
  assert.deepEqual(await repository.getLeadById(originalLead.id),before);
});

test('varredura em lote mantém leads intactos e escreve locais e resultados em uma transação cada',async()=>{
  const harness=createSupabaseHarness();
  globalThis.fetch=harness.fetchMock;
  const repository=new Repository(new DocumentStore());
  const protectedLead=(await repository.createLead(lead({is_hidden:true,notes:'Não alterar'}))).lead;
  const original=await repository.getLeadById(protectedLead.id);
  const place=(id:string):Place=>({
    id,place_id:id,name:'Clínica Odontológica',formatted_address:'São Paulo, SP',city:'São Paulo',
    state:'SP',lat:-23.5,lng:-46.6,website_status:'no_website',rating:3.5,reviews_count:20,
    created_at:'2026-10-17T00:00:00.000Z',updated_at:'2026-10-17T00:00:00.000Z',last_fetched_at:'2026-10-17T00:00:00.000Z'
  });
  await repository.upsertPlace(place('place-existing'));
  const calls:string[]=[];
  const normalFetch=harness.fetchMock;
  globalThis.fetch=async(input,init)=>{calls.push(String(input));return normalFetch(input,init);};
  const added=await repository.upsertPlacesBatch([place('place-existing'),place('place-new'),place('place-new')]);
  assert.deepEqual([...added],['place-new']);
  assert.equal(calls.filter(url=>url.includes('/app_records?')).length,1,'leitura de 20 locais deve usar uma consulta');
  assert.equal(calls.filter(url=>url.includes('/rpc/gh_commit_changes')).length,1,'upsert atômico em lote');
  calls.length=0;
  await repository.logSearchResultsBatch([
    {job_id:'job-1',workspace_id:'free_alpha',place_id:'place-existing',result:'duplicate'},
    {job_id:'job-1',workspace_id:'free_alpha',place_id:'place-new',result:'created'}
  ]);
  assert.equal(calls.filter(url=>url.includes('/rpc/gh_commit_changes')).length,1);
  assert.equal([...harness.rows.values()].filter(row=>row.collection==='search_results').length,2);
  assert.deepEqual(await repository.getLeadById(protectedLead.id),original,'não modificar leads ocultos/notas/status');
});

test('conclusão atômica de área evita contagem duplicada e preserva workspaces',async()=>{
  const harness=createSupabaseHarness();globalThis.fetch=harness.fetchMock;
  const repository=new Repository(new DocumentStore());
  const job=searchJob('job-metrics','free_alpha');
  const area:SearchArea={id:'area-one',search_job_id:job.id,city:'São Paulo',state:'SP',lat:-23.5,lng:-46.6,radius:4000,status:'pending',attempts:0,places_found:0};
  await repository.createSearchJob({...job,total_search_areas:1},[area]);
  assert.equal(await repository.claimSearchJob(job.id,'worker-one'),true);
  const metrics={newPlaces:2,withoutSite:1,newLeads:1,matchingFilters:1,placesInArea:5};
  assert.equal(await repository.completeSearchArea(job.id,area.id,'wrong-worker',metrics),false);
  assert.equal(await repository.completeSearchArea(job.id,area.id,'worker-one',metrics),true);
  assert.equal(await repository.completeSearchArea(job.id,area.id,'worker-one',metrics),false);
  const result=await repository.getSearchJob(job.id);
  assert.equal(result?.processed_search_areas,1);
  assert.equal(result?.places_found,2);
  assert.equal(result?.matching_filters,1);
  assert.equal(result?.leads_created,1);
  assert.equal(result?.area_plan?.[0].status,'completed');
  await actorContext.run({role:'freelancer',freelancerId:'free_beta'},async()=>{
    await assert.rejects(repository.completeSearchArea(job.id,area.id,'worker-one',metrics),/Acesso negado/);
  });
});

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
