import type { DashboardStats, Freelancer, Lead, LeadNote, PipelineStatus, SearchArea, SearchJob, SearchJobFilters, SearchQueryLog } from '../types';
import { BRAZILIAN_STATES, POPULAR_CITIES_BY_STATE } from './ibge/ibgeService';
import type { IBGECity } from '../types';
import { addCollectedIdentity, isAlreadyCollected } from './search/localDedup';

// Only the explicitly permitted TEST and DANILO routes use browser storage.
// Preserve legacy TEST storage keys exactly; keep DANILO's dataset separate.
export function localWorkspaceCode(): 'test' | 'danilo' | null {
  if (typeof window === 'undefined') return null;
  const match = /^\/f\/(test|danilo)\/?$/i.exec(window.location.pathname);
  return match ? (match[1].toLowerCase() as 'test' | 'danilo') : null;
}
export function isLocalBrowserWorkspace(): boolean { return localWorkspaceCode() !== null; }
// Legacy export name retained for callers and existing tests.
export const isLocalTestWorkspace = isLocalBrowserWorkspace;

const scopedKey = (suffix: string) => 'gh_local_' + (localWorkspaceCode() || 'test') + '_original_ui_' + suffix;
// The one-time legacy migration belongs to TEST only; never copy TEST leads to DANILO.
const PREVIOUS_KEY = 'gh_temporary_test_prospecting_v1';
const localId = () => 'gh_local_' + (localWorkspaceCode() || 'test');
const now = () => new Date().toISOString();
const jobsInFlight = new Set<string>();
const stepTimes = new Map<string, number>();
function localFreelancer(): Freelancer {
  const code = localWorkspaceCode() || 'test';
  return {
    id: localId(), name: code === 'danilo' ? 'Danilo' : 'test',
    email: '', access_code: code,
    status: 'active', created_at: '2026-11-02T00:00:00.000Z', updated_at: '2026-11-02T00:00:00.000Z',
  };
}
export function localFreelancerSession() {
  return { token: 'local.' + (localWorkspaceCode() || 'test'), freelancer: localFreelancer() };
}
function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch { return fallback; }
}
function write<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { throw new Error('Não foi possível salvar os dados no navegador. Verifique o espaço disponível e exporte seus contatos.'); }
}
type LegacyLead = {
  id: string; name: string; place_id?: string; niche?: string;
  city?: string; state?: string; phone?: string; website?: string;
  address?: string; rating?: number; reviews?: number; reviews_count?: number;
  mapsUrl?: string; maps_url?: string; capturedAt?: string; created_at?: string;
  notes?: string; status?: PipelineStatus; hidden?: boolean; is_hidden?: boolean;
  lead_score?: number; search_job_ids?: string[];
};
function legacyToLead(l: LegacyLead): Lead {
  const website = l.website || '';
  const date = l.created_at || l.capturedAt || now();
  return {
    id: l.id, place_id: l.place_id || l.id, user_id: localId(), workspace_id: localId(),
    freelancer_id: localId(), freelancer_name: localWorkspaceCode() || 'test',
    name: l.name, niche: l.niche || 'Geral', city: l.city || '', state: l.state || '',
    address: l.address || '', phone: l.phone || '', website,
    website_status: website ? 'website_found' : 'no_website',
    rating: Number(l.rating) || 0, reviews_count: Number(l.reviews_count ?? l.reviews) || 0,
    maps_url: l.maps_url || l.mapsUrl || '',
    lead_score: Number(l.lead_score) || (website ? 20 : 60) + (l.phone ? 10 : 0),
    pipeline_status: l.status || 'NOVO', notes: l.notes || '',
    is_favorite: false, is_hidden: Boolean(l.hidden ?? l.is_hidden),
    created_at: date, updated_at: date, search_job_ids: l.search_job_ids || [],
  };
}
function getLeadsRaw(): Lead[] {
  const entries = read<Lead[]>(scopedKey('leads_v1'), []);
  // One-time copy from the previous temporary BROWSER store only (never Supabase).
  // Do not re-import deleted/hidden leads on every refresh.
  if (localWorkspaceCode() === 'test' && localStorage.getItem(scopedKey('legacy_migrated_v1')) !== '1') {
    const old = read<LegacyLead[]>(PREVIOUS_KEY, []);
    const seen = new Set(entries.map(l => l.id));
    let changed = false;
    for (const lead of old) {
      if (lead && typeof lead.id === 'string' && lead.id && typeof lead.name === 'string' && !seen.has(lead.id)) {
        entries.push(legacyToLead(lead)); seen.add(lead.id); changed = true;
      }
    }
    if (changed) write(scopedKey('leads_v1'), entries);
    try { localStorage.setItem(scopedKey('legacy_migrated_v1'), '1'); } catch { /* storage failure reported by writes */ }
  }
  return entries;
}
function getJobs(): SearchJob[] { return read<SearchJob[]>(scopedKey('jobs_v1'), []); }
function saveJobs(jobs: SearchJob[]) { write(scopedKey('jobs_v1'), jobs); }
function replaceJob(job: SearchJob) { saveJobs(getJobs().map(j => j.id === job.id ? job : j)); }
function getNotes(): LeadNote[] { return read<LeadNote[]>(scopedKey('notes_v1'), []); }
function updateLeadStrict(id: string, updates: Partial<Lead>): Lead {
  const leads = getLeadsRaw();
  const idx = leads.findIndex(l => l.id === id);
  if (idx === -1) throw new Error('Lead não encontrado neste navegador.');
  // Never permit changing an ID, workspace ownership, or historical provenance.
  const { id: _id, user_id: _user, workspace_id: _workspace, freelancer_id: _freelancer, ...fields } = updates;
  const next = { ...leads[idx], ...fields, updated_at: now() };
  leads[idx] = next;
  write(scopedKey('leads_v1'), leads);
  return next;
}
type LeadParams = {
  search_job_id?: string; freelancer_id?: string; state?: string; city?: string;
  niche?: string; onlyWithoutWebsite?: boolean; onlyWithPhone?: boolean;
  onlyFavorites?: boolean; excludeHidden?: boolean; onlyHidden?: boolean;
  minRating?: number; maxRating?: number; minReviews?: number; minScore?: number;
  status?: string; search?: string; sortBy?: 'score'|'reviews'|'rating'|'recent';
  page?: number; limit?: number;
};
function getLocalLeads(params: LeadParams) {
  let leads = getLeadsRaw();
  if (params.freelancer_id && !['ALL', localId()].includes(params.freelancer_id)) leads = [];
  if (params.search_job_id) leads = leads.filter(l => l.search_job_ids?.includes(params.search_job_id!));
  if (params.state && params.state !== 'ALL') leads = leads.filter(l => l.state === params.state);
  if (params.city && params.city !== 'ALL') leads = leads.filter(l => l.city === params.city);
  if (params.niche && params.niche !== 'ALL') leads = leads.filter(l => l.niche.toLocaleLowerCase('pt-BR').includes(params.niche!.toLocaleLowerCase('pt-BR')));
  if (params.status && params.status !== 'ALL') leads = leads.filter(l => l.pipeline_status === params.status);
  if (params.onlyWithoutWebsite) leads = leads.filter(l => !l.website);
  if (params.onlyWithPhone) leads = leads.filter(l => Boolean(l.phone));
  if (params.onlyFavorites) leads = leads.filter(l => l.is_favorite);
  if (params.excludeHidden) leads = leads.filter(l => !l.is_hidden);
  if (params.onlyHidden) leads = leads.filter(l => l.is_hidden);
  if (params.minRating !== undefined) leads = leads.filter(l => l.rating >= params.minRating!);
  if (params.maxRating !== undefined) leads = leads.filter(l => l.rating <= params.maxRating!);
  if (params.minReviews !== undefined) leads = leads.filter(l => l.reviews_count >= params.minReviews!);
  if (params.minScore !== undefined) leads = leads.filter(l => l.lead_score >= params.minScore!);
  if (params.search) {
    const q = params.search.trim().toLocaleLowerCase('pt-BR');
    leads = leads.filter(l => [l.name, l.city, l.phone || '', l.niche].some(v => v.toLocaleLowerCase('pt-BR').includes(q)));
  }
  const sort = params.sortBy || 'score';
  leads.sort((a,b) => sort === 'reviews' ? b.reviews_count - a.reviews_count :
    sort === 'rating' ? b.rating - a.rating :
    sort === 'recent' ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime() :
    b.lead_score - a.lead_score);
  const total = leads.length, page = Math.max(1, params.page || 1);
  const limit = params.limit === 0 || params.limit === -1 ? Math.max(total, 1) : Math.max(1, params.limit || 50);
  return { leads: leads.slice((page-1)*limit,(page-1)*limit+limit), total, page, totalPages: Math.max(1, Math.ceil(total/limit)) };
}
function stats(): DashboardStats {
  const leads = getLeadsRaw();
  const countStatus = (state: string) => leads.filter(l=>l.pipeline_status===state).length;
  const by = (key: 'niche'|'state') => Object.entries(leads.reduce<Record<string,number>>((acc,l) => { acc[l[key]]=(acc[l[key]]||0)+1; return acc; },{}))
    .map(([label,count]) => key==='niche'?{niche:label,count}:{state:label,count}).sort((a,b)=>b.count-a.count);
  const statusKeys: PipelineStatus[] = ['NOVO','PRÉVIA CRIADA','CONTATADO','RESPONDEU','INTERESSADO','FOLLOW_UP','NEGOCIACAO','REUNIÃO','PROPOSTA','FECHADO','PERDIDO','NAO_INTERESSADO','SEM_RESPOSTA'];
  const contacted = leads.filter(l=>l.contacted_at || l.pipeline_status!=='NOVO').length;
  return {
    totalLeads:leads.length,newLeads:countStatus('NOVO'),
    contactedLeads:countStatus('CONTATADO'),interestedLeads:countStatus('INTERESSADO'),
    closedLeads:countStatus('FECHADO'),noWebsiteLeads:leads.filter(l=>!l.website).length,
    withPhoneLeads:leads.filter(l=>!!l.phone).length,
    responseRate:contacted?Math.round(100*leads.filter(l=>l.response_at).length/contacted):0,
    closingRate:leads.length?Math.round(100*countStatus('FECHADO')/leads.length):0,
    leadsByDay: Array.from({length:7}, (_,i) => {
      const date = new Date();date.setDate(date.getDate()-(6-i));
      const label=date.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
      return {date:label,count:leads.filter(l=>new Date(l.created_at).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})===label).length};
    }),
    leadsByNiche:by('niche') as DashboardStats['leadsByNiche'],
    leadsByState:by('state') as DashboardStats['leadsByState'],
    pipelineDistribution:statusKeys.map(status=>({status,count:countStatus(status)})),
    topOpportunities:[...leads].sort((a,b)=>b.lead_score-a.lead_score).slice(0,5),
  };
}
type SearchPayload = {
  state:string;city:string;niche:string;freelancerId?:string;freelancerName?:string;
  filters:SearchJobFilters;
};
function createJob(p: SearchPayload) {
  const cityPlan = p.city === 'all'
    ? (POPULAR_CITIES_BY_STATE[p.state] || []).slice(0, 15)
    : [p.city];
  if (!cityPlan.length) throw new Error('Escolha uma cidade específica para esta UF.');
  const at = now();
  const job:SearchJob = {
    id:'local-job-'+crypto.randomUUID(),user_id:localId(),workspace_id:localId(),freelancer_id:localId(),freelancer_name:localWorkspaceCode() || 'test',
    state:p.state,city:p.city,niche:p.niche,filters:p.filters,status:'running',
    target_leads:p.filters.targetLeads||0,total_cities:cityPlan.length,processed_cities:0,
    total_search_areas:cityPlan.length,processed_search_areas:0,
    places_found:0,places_without_website:0,matching_filters:0,metrics_version:1,
    leads_created:0,started_at:at,created_at:at,updated_at:at,area_plan:cityPlan.map((city,i):SearchArea=>({
      id:'local-area-'+i,search_job_id:'',city,state:p.state,lat:0,lng:0,radius:0,
      status:'pending',attempts:0,places_found:0,new_leads:0,
    })),
  };
  job.area_plan?.forEach(area=>area.search_job_id=job.id);
  saveJobs([job,...getJobs()]);
  return {job,estimatedQueries:cityPlan.length*3,totalCities:cityPlan.length,totalAreas:cityPlan.length};
}
type GoogleLead = {
  id:string;name:string;city:string;state:string;niche:string;
  address?:string;phone?:string;website?:string;
  rating?:number;reviews?:number;mapsUrl?:string;capturedAt?:string;
};
async function stepJob(id:string):Promise<SearchJob> {
  const existing=getJobs().find(j=>j.id===id);
  if (!existing) throw new Error('Busca não encontrada.');
  if (existing.status!=='running' && existing.status!=='pending') return existing;
  if (jobsInFlight.has(id) || Date.now()-(stepTimes.get(id)||0)<3200) return existing;
  jobsInFlight.add(id);stepTimes.set(id,Date.now());
  try {
    const job=getJobs().find(j=>j.id===id) || existing;
    const plan=job.area_plan || [];
    const area=plan.find(a=>a.status!=='completed');
    if (!area) {job.status='completed';job.finished_at=now();replaceJob(job);return job;}
    // A page token is stored as a purely local extra property, never in Supabase.
    const current=area as SearchArea & {pageToken?:string;pages?:number};
    const result=await fetch('/api/temporary/search', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:job.state,city:area.city,niche:job.niche,pageToken:current.pageToken||'',
        filters:job.filters}),
    });
    const data=await result.json().catch(()=>({})) as {leads?:GoogleLead[];nextPageToken?:string|null;scanned?:number;error?:string};
    if (!result.ok) {
      if (result.status===429) {stepTimes.set(id,Date.now()+4000);return job;}
      job.status='paused';job.error_message=data.error||'Falha no Google Places. Continue após verificar o serviço.';
      job.updated_at=now();replaceJob(job);return job;
    }
    const latest=getJobs().find(j=>j.id===id);
    if (!latest || latest.status!=='running') return latest||job;
    const raw=Array.isArray(data.leads)?data.leads:[];
    const leads=getLeadsRaw();
    // Include all already collected leads, including hidden or previously
    // contacted ones. Read-only inspection; never change their saved state.
    const known=new Set(read<string[]>(scopedKey('collected_identities_v1'), []));
    for (const lead of leads) addCollectedIdentity(lead, known);
    let created=0;
    const target=latest.target_leads || 0;
    for (const place of raw) {
      if (!place.id) continue;
      const candidate={...place,place_id:place.id};
      if (isAlreadyCollected(candidate,known)) {
        // Remember alternate Google IDs for the same business, too.
        addCollectedIdentity(candidate,known);
        continue;
      }
      if (target>0 && latest.leads_created+created>=target) break;
      addCollectedIdentity(candidate,known);
      const lead=legacyToLead({...place,place_id:place.id,reviews:place.reviews,mapsUrl:place.mapsUrl,
        capturedAt:place.capturedAt||now(),search_job_ids:[id]});
      lead.pipeline_status='NOVO';
      leads.push(lead);created++;
    }
    // Commit new leads first; no existing lead is rewritten.
    if (created>0) write(scopedKey('leads_v1'),leads);
    // Best-effort browser-only identity history also prevents re-collection
    // after deleting a local record. Existing saved leads remain the source of
    // truth if the browser's quota prevents this auxiliary write.
    try { write(scopedKey('collected_identities_v1'),[...known]); } catch { /* no lead data was lost */ }
    latest.leads_created+=created;
    latest.places_found+=(data.scanned||raw.length);
    latest.places_without_website+=raw.filter(l=>!l.website).length;
    latest.matching_filters=(latest.matching_filters||0)+raw.length;
    latest.updated_at=now();
    const currentArea=(latest.area_plan||[]).find(a=>a.id===area.id) as (SearchArea&{pageToken?:string;pages?:number})|undefined;
    if(currentArea) {
      currentArea.places_found+=(data.scanned||raw.length);
      currentArea.new_leads=(currentArea.new_leads||0)+created;
      currentArea.pages=(currentArea.pages||0)+1;
      if(data.nextPageToken && data.nextPageToken!==current.pageToken && currentArea.pages<3 &&
          !(target>0 && latest.leads_created>=target)) {
        currentArea.pageToken=data.nextPageToken;
      } else {
        currentArea.status='completed';currentArea.processed_at=now();currentArea.pageToken=undefined;
        latest.processed_search_areas++;
        latest.processed_cities++;
      }
    }
    if((target>0 && latest.leads_created>=target) || latest.processed_search_areas>=latest.total_search_areas) {
      latest.status='completed';latest.finished_at=now();
    }
    replaceJob(latest);
    return latest;
  } finally { jobsInFlight.delete(id); }
}
function getJobDetails(id:string) {
  const job=getJobs().find(j=>j.id===id);
  if(!job) throw new Error('Busca não encontrada.');
  return {job,areas:job.area_plan||[],queries:[] as SearchQueryLog[]};
}
function changeJob(id:string,status:SearchJob['status']):boolean {
  const job=getJobs().find(j=>j.id===id);
  if(!job) return false;
  job.status=status;job.updated_at=now();
  if(status==='cancelled')job.finished_at=now();
  replaceJob(job);
  return true;
}
export const localTestOverrides = {
  verifyFreelancerLink:async (_code:string)=>localFreelancerSession(),
  getFreelancerMe:async()=>({freelancer:localFreelancer()}),
  freelancerLogout:async()=>{},
  getStates:async()=>BRAZILIAN_STATES,
  getCities:async(uf:string):Promise<IBGECity[]>=>{
    const normalized=uf.toUpperCase();
    const fallback=(POPULAR_CITIES_BY_STATE[normalized]||[]).map((nome,i)=>({id:i+1,nome}));
    try {
      const res=await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados/'+encodeURIComponent(normalized)+'/municipios',{signal:AbortSignal.timeout(7000)});
      if(!res.ok) return fallback;
      const places=await res.json() as {id:number;nome:string}[];
      return Array.isArray(places)?places.map(p=>({id:p.id,nome:p.nome})).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR')):fallback;
    }catch{return fallback;}
  },
  getDashboardStats:async()=>stats(),
  getNiches:async (params?:{onlyFavorites?:boolean;freelancer_id?:string})=>{
    const ls=getLeadsRaw().filter(l=>!params?.onlyFavorites||l.is_favorite);
    return Object.entries(ls.reduce<Record<string,number>>((a,l)=>{a[l.niche]=(a[l.niche]||0)+1;return a;},{}))
      .map(([niche,count])=>({niche,count})).sort((a,b)=>b.count-a.count);
  },
  getStatesSummary:async (params?:{onlyFavorites?:boolean;niche?:string;freelancer_id?:string})=>{
    const ls=getLeadsRaw().filter(l=>(!params?.onlyFavorites||l.is_favorite)&&(!params?.niche||params.niche==='ALL'||l.niche===params.niche));
    return Object.entries(ls.reduce<Record<string,number>>((a,l)=>{a[l.state]=(a[l.state]||0)+1;return a;},{}))
      .map(([state,count])=>({state,count})).sort((a,b)=>b.count-a.count);
  },
  getLeads:async (params:LeadParams)=>getLocalLeads(params),
  getLeadById:async (id:string)=>{
    const lead=getLeadsRaw().find(l=>l.id===id);
    if(!lead) throw new Error('Lead não encontrado no navegador.');
    return {lead,notes:getNotes().filter(n=>n.lead_id===id)};
  },
  updateLead:async (id:string,updates:Partial<Lead>)=>updateLeadStrict(id,updates),
  toggleLeadFavorite:async (id:string)=>{const l=getLeadsRaw().find(x=>x.id===id);if(!l)throw new Error('Lead não encontrado');return updateLeadStrict(id,{is_favorite:!l.is_favorite});},
  toggleLeadHide:async (id:string,value?:boolean)=>{const l=getLeadsRaw().find(x=>x.id===id);if(!l)throw new Error('Lead não encontrado');return updateLeadStrict(id,{is_hidden:value??!l.is_hidden}) as Lead &{is_hidden:boolean};},
  addLeadNote:async(id:string,content:string)=>{
    if(!getLeadsRaw().some(l=>l.id===id)) throw new Error('Lead não encontrado');
    const note:LeadNote={id:crypto.randomUUID(),lead_id:id,user_id:localId(),content,created_at:now()};
    write(scopedKey('notes_v1'),[...getNotes(),note]);
    return note;
  },
  registerContactAttempt:async(id:string,_channel?:string)=>{
    const l=getLeadsRaw().find(x=>x.id===id);if(!l)throw new Error('Lead não encontrado');
    const lead=updateLeadStrict(id,{pipeline_status:'CONTATADO',contacted_at:now(),contact_attempts_count:(l.contact_attempts_count||0)+1});
    return {success:true,lead};
  },
  recordContactAttempt:async(id:string,channel?:string)=>localTestOverrides.registerContactAttempt(id,channel),
  registerSale:async(id:string,value:number)=>{
    const lead=updateLeadStrict(id,{pipeline_status:'FECHADO',sale_value:value,sale_date:now()});
    return {success:true,lead};
  },
  recordSale:async(id:string,value:number)=>localTestOverrides.registerSale(id,value),
  deleteLead:async(id:string)=>{
    const ls=getLeadsRaw();write(scopedKey('leads_v1'),ls.filter(l=>l.id!==id));
    return {success:true};
  },
  // No global deletion on a temporary workspace; preserve all original leads.
  deleteAllLeads:async()=>{throw new Error('Exclusão em massa desativada no modo local para proteger os leads.');},
  adminPurgeGlobalLeads:async()=>{throw new Error('Exclusão global desativada.');},
  getPipeline:async()=>{
    const statuses:PipelineStatus[]=['NOVO','PRÉVIA CRIADA','CONTATADO','RESPONDEU','INTERESSADO','FOLLOW_UP','NEGOCIACAO','REUNIÃO','PROPOSTA','FECHADO','PERDIDO','NAO_INTERESSADO','SEM_RESPOSTA'];
    const leads=getLeadsRaw();
    return Object.fromEntries(statuses.map(s=>[s,leads.filter(l=>l.pipeline_status===s)])) as Record<PipelineStatus,Lead[]>;
  },
  movePipelineLead:async(id:string,toStatus:PipelineStatus)=>updateLeadStrict(id,{pipeline_status:toStatus}),
  createSearchJob:async(p:SearchPayload)=>createJob(p),
  getSearchJobs:async()=>getJobs().sort((a,b)=>b.created_at.localeCompare(a.created_at)),
  getSearchJob:async(id:string)=>getJobDetails(id),
  stepSearchJob:async(id:string)=>stepJob(id),
  pauseSearchJob:async(id:string)=>changeJob(id,'paused'),
  resumeSearchJob:async(id:string)=>changeJob(id,'running'),
  cancelSearchJob:async(id:string)=>changeJob(id,'cancelled'),
};
