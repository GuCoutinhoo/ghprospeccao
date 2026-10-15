import {test,expect,type Page} from '@playwright/test';
const freelancer={id:'free_ui',access_code:'ui-code',name:'Freelancer Teste',email:'test@example.test',status:'active'};
const makeLeads=()=>Array.from({length:10},(_,i)=>({id:`lead-${i}`,place_id:`place-${i}`,name:`Odonto Teste ${i+1}`,niche:'Odontologia',state:'SP',city:'São Paulo',workspace_id:'free_ui',freelancer_id:'free_ui',rating:4.5,reviews_count:50,lead_score:90,pipeline_status:'NOVO',website_status:'no_website',phone:'11999999999',created_at:'2026-10-15T00:00:00Z',updated_at:'2026-10-15T00:00:00Z'}));
async function setup(page:Page){
  let leads=makeLeads(),fail=false,active=false,requests=0;const queries:URLSearchParams[]=[];
  await page.addInitScript(f=>{localStorage.setItem('gh_freelancer_token','mock.signature');localStorage.setItem('gh_freelancer_session',JSON.stringify({token:'mock.signature',freelancer:f}));},freelancer);
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='http://127.0.0.1:4173')return route.abort();
    if(!url.pathname.startsWith('/api/'))return route.continue();
    let body:any={};
    if(url.pathname==='/api/freelancer/me')body={freelancer};
    else if(url.pathname==='/api/dashboard/stats')body={totalLeads:10,newLeads:10,contactedLeads:0,interestedLeads:0,closedLeads:0,noWebsiteLeads:10,withPhoneLeads:10,responseRate:0,closingRate:0,leadsByDay:[],leadsByNiche:[],leadsByState:[],pipelineDistribution:[],topOpportunities:[]};
    else if(url.pathname==='/api/leads'){
      requests++;queries.push(url.searchParams);
      if(fail)return route.fulfill({status:503,json:{error:'Firestore temporariamente indisponível'}});
      let rows=leads;if(url.searchParams.get('search')==='ultimo')rows=leads.slice(-1);
      if(url.searchParams.get('excludeHidden')==='true')rows=rows.filter(l=>l.id!=='lead-0');
      body={leads:rows,total:rows.length,page:1,totalPages:1};
    }else if(url.pathname==='/api/niches')body=[{niche:'Odontologia',count:10}];
    else if(url.pathname==='/api/states-summary')body=[{state:'SP',count:10}];
    else if(url.pathname==='/api/search-jobs')body=active?[{id:'job-ui',status:'running',niche:'Odontologia',state:'SP',city:'all',leads_created:10,updated_at:new Date().toISOString()}]:[];
    else if(url.pathname.endsWith('/process'))body={success:true};
    else if(url.pathname==='/api/ibge/states')body=[{id:35,nome:'São Paulo',sigla:'SP'}];
    else if(url.pathname==='/api/pipeline')body={NOVO:leads};
    else if(url.pathname.startsWith('/api/leads/') && route.request().method()==='DELETE'){leads=leads.filter(l=>l.id!==url.pathname.split('/')[3]);body={success:true};}
    return route.fulfill({json:body});
  });
  return {setFailure:(v:boolean)=>fail=v,setActive:(v:boolean)=>active=v,setLeads:(v:typeof leads)=>leads=v,getRequests:()=>requests,queries};
}
test('10 saved leads survive scrolling, navigation, reload and automatic refresh',async({page})=>{
  const state=await setup(page);state.setActive(true);await page.goto('/leads');
  const cards=page.getByRole('heading',{name:/^Odonto Teste \d+$/});await expect(cards).toHaveCount(10);
  await page.mouse.wheel(0,2500);await page.mouse.wheel(0,-2500);await expect(cards).toHaveCount(10);
  await expect.poll(state.getRequests,{timeout:12000}).toBeGreaterThan(2);await expect(cards).toHaveCount(10);
  state.setActive(false);await page.getByRole('button',{name:'Buscar Leads',exact:true}).first().click();await page.getByRole('button',{name:'Meus Leads',exact:true}).click();await expect(cards).toHaveCount(10);
  await page.reload();await expect(cards).toHaveCount(10);
});
test('transient failure preserves current cards with an error, then confirmed deletion removes them',async({page})=>{
  const state=await setup(page);state.setActive(true);await page.goto('/leads');const cards=page.getByRole('heading',{name:/^Odonto Teste \d+$/});await expect(cards).toHaveCount(10);
  state.setFailure(true);await expect(page.getByText('Não foi possível sincronizar os dados mais recentes. Mantendo dados atuais.')).toBeVisible({timeout:12000});await expect(cards).toHaveCount(10);
  state.setFailure(false);state.setLeads(makeLeads().slice(0,2));await expect(cards).toHaveCount(2,{timeout:12000});
});
test('job scope survives reload and can explicitly switch to all workspace leads',async({page})=>{
  const state=await setup(page);await page.goto('/leads?search_job_id=job-specific');await expect(page.getByText('Resultados associados à busca selecionada')).toBeVisible();
  await expect.poll(()=>state.queries.some(q=>q.get('search_job_id')==='job-specific')).toBe(true);
  await page.reload();await expect(page.getByText('Resultados associados à busca selecionada')).toBeVisible();
  await page.getByRole('button',{name:'Ver todos os leads',exact:true}).click();await expect(page.getByText('Resultados associados à busca selecionada')).toHaveCount(0);await expect.poll(()=>state.queries.at(-1)?.has('search_job_id')).toBe(false);
});
test('late requests from the previous view cannot repopulate a new view',async({page})=>{
  await setup(page);await page.goto('/leads');await expect(page.getByRole('heading',{name:/^Odonto Teste \d+$/})).toHaveCount(10);
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  await page.route('**/api/leads?**',async route=>{await gate;await route.fulfill({json:{leads:makeLeads().slice(0,1),total:1,page:1,totalPages:1}}).catch(()=>{});});
  await page.getByRole('button',{name:'Buscar Leads',exact:true}).first().click();await page.getByRole('button',{name:'Meus Leads',exact:true}).click();
  await page.getByRole('button',{name:'Buscar Leads',exact:true}).first().click();release();await expect(page.getByRole('heading',{name:/^Odonto Teste \d+$/})).toHaveCount(0);
});
