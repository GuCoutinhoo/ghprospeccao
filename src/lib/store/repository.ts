import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DocumentFilter as Filter, getDocumentStore, type DocumentStore, type Transaction } from '../supabase/documentStore';
import { Projections } from './projections';
import { canonicalWorkspace, isLeadInWorkspace, ownerOf } from './ownership';
import { nicheKey } from '../search/relevance';
import { DEFAULT_SCORING_WEIGHTS } from '../scoring/leadScore';
import { hashPin } from '../../server/security';
import type { Lead, LeadNote, SearchJob, SearchArea, SearchQueryLog, Place, Freelancer, Activity, AppSettings } from '../../types';

export const actorContext = new AsyncLocalStorage<{role: string; freelancerId?: string}>();
export const now = () => new Date().toISOString();
export const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const leadIdentity = (workspace: string, place: string, niche: string) => `lead_${digest(JSON.stringify([canonicalWorkspace(workspace), place, nicheKey(niche)]))}`;
export function assertOwner(record: {workspace_id?: string; freelancer_id?: string; user_id?: string}) {
  const actor = actorContext.getStore();
  if (actor?.role === 'freelancer' && !isLeadInWorkspace(record, actor.freelancerId)) throw Object.assign(new Error('Acesso negado ao workspace.'), {status:403});
}
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const accessCodeBase = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'freelancer';
const mutableLeadFields = new Set(['name','phone','address','city','state','website','website_status','maps_url','is_favorite','is_hidden','pipeline_status','contacted_at','contact_attempts_count','response_at','follow_up_at','negotiation_at','sale_value','sale_date','preview_url','notes']);
export const pipelineStatuses = ['NOVO','PRÉVIA CRIADA','CONTATADO','RESPONDEU','INTERESSADO','FOLLOW_UP','NEGOCIACAO','REUNIÃO','PROPOSTA','FECHADO','PERDIDO','NAO_INTERESSADO','SEM_RESPOSTA'];
const defaults: AppSettings = {googleMapsApiKey:'',hasCustomKey:false,maxResultsPerJob:0,maxCitiesPerJob:0,requestDelayMs:400,scoringWeights:DEFAULT_SCORING_WEIGHTS};

/** Supabase is authoritative. Every method returns only after its read/commit succeeds. */
export class Repository {
  constructor(private supplied?: DocumentStore) {}
  get store() { return this.supplied || getDocumentStore(); }
  async list<T>(collection: string, field?: string, value?: unknown): Promise<T[]> {
    const ref = this.store.collection(collection);
    const snap = await (field ? ref.where(field, '==', value) : ref).get();
    return snap.docs.map(d => ({...d.data(), id:d.id}) as T);
  }
  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const snap = await this.store.collection(collection).doc(id).get();
    return snap.exists ? {...snap.data(), id:snap.id} as T : undefined;
  }
  async ensureInitialized() { await this.store.collection('settings').doc('config').get(); }
  async ensureWorkspaceHydrated(_workspace?: string, _force?: boolean) { await this.ensureInitialized(); }
  async syncFromSupabase() { const [leads,places] = await Promise.all([this.list<Lead>('leads'),this.list<Place>('places')]); return {leadsCount:leads.length,placesCount:places.length}; }
  async isSessionRevoked(token:string) {return Boolean(await this.get('revoked_sessions',digest(token)));}
  async revokeSession(token:string) {const id=digest(token);await this.store.collection('revoked_sessions').doc(id).set({revoked_at:now(),workspace_id:'admin'});return id;}
  private async projection(includeAdmin = false, workspace?:string) {
    // A single read-only transaction gives every aggregate a consistent snapshot.
    // Legacy ownership fields are retained; no implicit backfill or truncated query.
    return this.store.runTransaction(async tx => {
      const actor = actorContext.getStore();
      const target=actor?.role==='freelancer'?actor.freelancerId:workspace;
      const base=this.store.collection('leads');
      const canonical=canonicalWorkspace(target);
      const short=canonical.replace(/^freelancer:/,'');
      const ids=[...new Set([target,canonical,short,`free_${short}`])].filter(Boolean);
      const query=target && target!=='ALL' && canonical!=='admin' ? base.where(Filter.or(...['workspace_id','freelancer_id','user_id'].map(field=>Filter.where(field,'in',ids)))) : base;
      const leads = await tx.get(query);
      const tombs = await tx.get(this.store.collection('deleted_leads'));
      const deleted = new Set(tombs.docs.map(d => d.id));
      const rows = leads.docs.filter(d => !deleted.has(d.id)).map(d => ({...d.data(),id:d.id}) as Lead).filter(l => actor?.role !== 'freelancer' || isLeadInWorkspace(l,actor.freelancerId));
      const data = {leads:rows,freelancers:[] as Freelancer[],activities:[] as Activity[],search_jobs:[] as SearchJob[]};
      if (includeAdmin) {
        for (const col of ['freelancers','activities','search_jobs'] as const) {
          const snap = await tx.get(this.store.collection(col));
          (data[col] as unknown[]) = snap.docs.map(d => ({...d.data(),id:d.id}));
        }
        data.activities.sort((a,b) => b.created_at.localeCompare(a.created_at));
      }
      return new Projections(data);
    }, {readOnly:true});
  }
  async getLeads(params: Parameters<Projections['getLeads']>[0] & {search_job_id?:string}) {
    if (!params.search_job_id) return (await this.projection(false,params.freelancer_id)).getLeads(params);
    const job = await this.getSearchJob(params.search_job_id);
    if (!job || (params.freelancer_id !== 'ALL' && !isLeadInWorkspace(job,params.freelancer_id))) {
      return {leads:[] as Lead[],total:0,page:1,totalPages:1};
    }
    const receipts = await this.list<{result?:string;lead_id?:string;rating?:number;reviews_count?:number;website?:string;website_status?:Lead['website_status'];phone?:string}>('search_results','job_id',job.id);
    const snapshots = new Map<string,Partial<Lead>>();
    for (const receipt of receipts) {
      // A busca deve mostrar apenas os novos leads gerados por ela, jamais
      // duplicatas antigas do mesmo nicho nem resultados de outras buscas.
      if (receipt.result !== 'created' || !receipt.lead_id || typeof receipt.rating !== 'number' || typeof receipt.reviews_count !== 'number') continue;
      snapshots.set(receipt.lead_id, {
        rating: receipt.rating,
        reviews_count: receipt.reviews_count,
        website: receipt.website ?? '',
        website_status: receipt.website_status ?? 'not_verified',
        phone: receipt.phone ?? '',
      });
    }
    return (await this.projection(false,params.freelancer_id)).getLeads({
      ...params,
      excludeHidden: params.excludeHidden ?? !params.onlyHidden,
      onlyWithoutWebsite:Boolean(params.onlyWithoutWebsite || job.filters.onlyWithoutWebsite),
      onlyWithPhone:Boolean(params.onlyWithPhone || job.filters.onlyWithPhone),
      minRating:Math.max(params.minRating??0,job.filters.minRating??0),
      maxRating:job.filters.maxRating,
      minReviews:Math.max(params.minReviews??0,job.filters.minReviews??0),
      maxReviews:job.filters.maxReviews,
    }, snapshots);
  }
  async getLeadsCount() { return (await this.getLeads({freelancer_id:'ALL',limit:0})).total; }
  async getNichesSummary(params?: Parameters<Projections['getNichesSummary']>[0]) { return (await this.projection(false,params?.freelancer_id)).getNichesSummary(params); }
  async getStatesSummary(params?: Parameters<Projections['getStatesSummary']>[0]) { return (await this.projection(false,params?.freelancer_id)).getStatesSummary(params); }
  async getDashboardStats(id?: string) { return (await this.projection(false,id)).getDashboardStats(id); }
  async getPipelineBoard(id?: string) { return (await this.projection(false,id)).getPipelineBoard(id); }
  async getAdminDashboardStats(filter?: Parameters<Projections['getAdminDashboardStats']>[0]) { return (await this.projection(true)).getAdminDashboardStats(filter); }
  async getFreelancerPerformance(id: string) { return (await this.projection(true)).getFreelancerPerformance(id); }
  async getActivities(params?: Parameters<Projections['getActivities']>[0]) { return (await this.projection(true)).getActivities(params); }
  async getLeadById(id: string) { const [lead,tomb]=await Promise.all([this.get<Lead>('leads',id),this.get('deleted_leads',id)]); if(lead) assertOwner(lead); return tomb?undefined:lead; }
  async getPlaceByPlaceId(id: string) { return this.get<Place>('places',id); }
  async isLeadDeleted(id: string) { return Boolean(await this.get('deleted_leads',id)); }
  async upsertPlace(place: Place) {
    return this.store.runTransaction(async tx => {
      const ref=this.store.collection('places').doc(place.id);
      const previous=await tx.get(ref);
      tx.set(ref,clean(place),{merge:true});
      return {place,isNew:!previous.exists};
    });
  }

  /** One selective read and one atomic commit for all Places in the Google response. */
  async upsertPlacesBatch(places: Place[]): Promise<Set<string>> {
    const unique = [...new Map(places.map(place => [place.id, place])).values()];
    if (!unique.length) return new Set<string>();
    return this.store.runTransaction(async tx => {
      const snapshots = await tx.getMany('places', unique.map(place => place.id));
      const newIds = new Set(snapshots.filter(snapshot => !snapshot.exists).map(snapshot => snapshot.id));
      for (const place of unique) tx.set(this.store.collection('places').doc(place.id), clean(place), { merge:true });
      return newIds;
    });
  }

  async logSearchResultsBatch(results: Array<Record<string,unknown> & {id?:string}>): Promise<void> {
    if (!results.length) return;
    // Entries are immutable audit receipts; never overwrite lead records.
    await this.store.runTransaction(async tx => {
      for (const result of results) {
        const id = result.id || crypto.randomUUID();
        tx.create(this.store.collection('search_results').doc(id), clean({...result,id}));
      }
    });
  }

  async createLead(lead: Lead) {
    assertOwner(lead);
    return this.store.runTransaction(async tx => this.createLeadInTransaction(tx,lead));
  }
  async createLeadInTransaction(tx: Transaction, input: Lead) {
    const id = leadIdentity(ownerOf(input),input.place_id,input.niche);
    const ref = this.store.collection('leads').doc(id);
    const [sameId,existing] = await Promise.all([tx.get(ref),tx.get(this.store.collection('leads').where('place_id','==',input.place_id))]);
    const legacyId = `lead_${input.freelancer_id || 'admin'}_${input.place_id}`;
    const tombs = await tx.getAll(...[...new Set([id,input.id,legacyId])].map(x => this.store.collection('deleted_leads').doc(x)));
    if (sameId.exists) return {lead:{...sameId.data(),id} as Lead,created:false,isDeleted:false};
    const previous = existing.docs.map(d => ({...d.data(),id:d.id}) as Lead).find(l => ownerOf(l) === ownerOf(input) && nicheKey(l.niche) === nicheKey(input.niche));
    if (tombs.some(s => s.exists)) return {lead:input,created:false,isDeleted:true};
    if (previous) return {lead:previous,created:false,isDeleted:false};
    const lead = clean({...input,id,workspace_id:input.workspace_id || input.freelancer_id || 'admin'});
    tx.create(ref,lead);
    return {lead,created:true,isDeleted:false};
  }
  async updateLead(id: string, updates: Partial<Lead>, freelancerId?: string) {
    return this.mutateLead(id,lead => {
      if (freelancerId && !isLeadInWorkspace(lead,freelancerId)) throw Object.assign(new Error('Acesso negado.'),{status:403});
      if (updates.pipeline_status && !pipelineStatuses.includes(updates.pipeline_status)) throw Object.assign(new Error('Status inválido.'),{status:400});
      const fields = Object.fromEntries(Object.entries(updates).filter(([key]) => mutableLeadFields.has(key)));
      for(const [key,value] of Object.entries(fields)) {
        const valid=['is_favorite','is_hidden'].includes(key)?typeof value==='boolean':['sale_value','contact_attempts_count'].includes(key)?typeof value==='number'&&Number.isFinite(value)&&value>=0:typeof value==='string';
        if(!valid || (key==='name' && !String(value).trim()))throw Object.assign(new Error('Campo comercial inválido.'),{status:400});
      }
      return {...lead,...fields};
    });
  }
  async mutateLead(id: string, change: (lead: Lead)=>Lead) {
    return this.store.runTransaction(async tx => {
      const ref=this.store.collection('leads').doc(id); const snap=await tx.get(ref);
      if(!snap.exists) return undefined;
      const previous={...snap.data(),id} as Lead; assertOwner(previous);
      const updated=clean({...change(previous),id,updated_at:now()});
      tx.set(ref,updated); return updated;
    });
  }
  async toggleFavoriteLead(id:string) {return this.mutateLead(id,l=>({...l,is_favorite:!l.is_favorite}));}
  async toggleHideLead(id:string,value?:boolean) {return this.mutateLead(id,l=>({...l,is_hidden:value ?? !l.is_hidden}));}
  async contactLead(id:string) {return this.mutateLead(id,l=>({...l,contacted_at:now(),contact_attempts_count:(l.contact_attempts_count || 0)+1,pipeline_status:['NOVO','PRÉVIA CRIADA'].includes(l.pipeline_status)?'CONTATADO':l.pipeline_status}));}
  async addLeadNote(leadId:string,userId:string,content:string) {
    const note:LeadNote={id:crypto.randomUUID(),lead_id:leadId,user_id:userId,content,created_at:now()};
    await this.store.runTransaction(async tx=>{const snap=await tx.get(this.store.collection('leads').doc(leadId));if(!snap.exists)throw new Error('Lead não encontrado');assertOwner(snap.data()!);tx.create(this.store.collection('lead_notes').doc(note.id),note);});return note;
  }
  async getLeadNotes(id:string) {await this.getLeadById(id);return this.list<LeadNote>('lead_notes','lead_id',id);}
  async deleteLead(id:string,freelancerId?:string) {
    return this.store.runTransaction(async tx=>{
      const ref=this.store.collection('leads').doc(id);const snap=await tx.get(ref);if(!snap.exists)return false;
      const lead={...snap.data(),id} as Lead;assertOwner(lead);
      if(freelancerId && !isLeadInWorkspace(lead,freelancerId))throw Object.assign(new Error('Acesso negado'),{status:403});
      // Preserve a recoverable commercial snapshot and notes; tombstones block resurrection.
      const tomb={deleted_at:now(),workspace_id:ownerOf(lead),lead};
      tx.set(this.store.collection('deleted_leads').doc(id),tomb);
      const identity=leadIdentity(ownerOf(lead),lead.place_id,lead.niche);
      if(identity!==id)tx.set(this.store.collection('deleted_leads').doc(identity),tomb);
      tx.delete(ref);return true;
    });
  }
  async deleteMultipleLeads(ids:string[],freelancerId?:string) { let count=0;for(const id of [...new Set(ids)]) if(await this.deleteLead(id,freelancerId))count++;return count; }
  async deleteAllLeads(scope:{freelancerId?:string;role?:string}) {
    const target=scope.freelancerId || 'admin';
    if(scope.role==='freelancer' && target==='ALL')throw Object.assign(new Error('Acesso negado'),{status:403});
    await this.cancelWorkspaceJobs(target);
    const leads=(await this.getLeads({freelancer_id:target,limit:0})).leads;
    const deletedCount=await this.deleteMultipleLeads(leads.map(l=>l.id),target);
    return {deletedCount,leadIds:leads.map(l=>l.id)};
  }
  async purgeAllLeadsGlobal() {const jobsCancelled=await this.cancelWorkspaceJobs('ALL');const result=await this.deleteAllLeads({freelancerId:'ALL',role:'admin'});return {...result,jobsCancelled,supabaseDeletedCount:result.deletedCount};}
  async cleanFreelancerWorkspace(id:string) {return {leadsRemoved:(await this.deleteAllLeads({freelancerId:id,role:'admin'})).deletedCount};}
  async cancelWorkspaceJobs(id:string) {const jobs=await this.getAllSearchJobs(id);for(const job of jobs.filter(j=>['pending','running','paused','failed'].includes(j.status)))await this.updateSearchJob(job.id,{status:'cancelled',lease_token:'',lease_until:0});return jobs.length;}
  async getFreelancers() {return (await this.list<Freelancer>('freelancers')).filter(f=>!(f as any).deleted_at);}
  async getFreelancerById(id:string) {const f=await this.get<Freelancer>('freelancers',id);return (f as any)?.deleted_at?undefined:f;}
  async getFreelancerByAccessCode(code:string) {return (await this.getFreelancers()).find(f=>f.access_code?.toLowerCase()===code.trim().toLowerCase());}
  async createFreelancer(data:{name:string;email:string;access_code?:string;notes?:string;pin?:string;status?:Freelancer['status']}) {
    const requested=accessCodeBase(data.access_code || data.name);
    const created=await this.store.runTransaction(async tx=>{
      const existing=await tx.get(this.store.collection('freelancers'));
      const occupied=new Set(existing.docs.map(doc=>String(doc.data()?.access_code || '').toLowerCase()));
      let code=requested;
      if(occupied.has(code)) {
        do code=`${requested}-${crypto.randomBytes(3).toString('hex')}`; while(occupied.has(code));
      }
      const f:Freelancer=clean({...data,id:`free_${crypto.randomUUID()}`,access_code:code,status:data.status || 'active',created_at:now(),updated_at:now()});
      if(f.pin){f.pin_hash=hashPin(f.pin);delete f.pin;}
      tx.create(this.store.collection('freelancers').doc(f.id),f);
      return f;
    });
    await this.logActivity({freelancer_id:created.id,action_type:'freelancer_created',description:'Freelancer cadastrado.'});return created;
  }
  async updateFreelancer(id:string,updates:Partial<Freelancer>) {
    if(updates.pin!==undefined)updates={...updates,pin_hash:updates.pin?hashPin(updates.pin):'',pin:''};
    if(updates.access_code!==undefined)updates={...updates,access_code:accessCodeBase(updates.access_code)};
    const allowed=['name','email','access_code','notes','pin','pin_hash','status','last_access_at','last_activity_at'];
    return this.store.runTransaction(async tx=>{
      const ref=this.store.collection('freelancers').doc(id);
      const snap=await tx.get(ref);
      if(!snap.exists || snap.data()?.deleted_at)return undefined;
      const accepted=Object.fromEntries(Object.entries(updates).filter(([k])=>allowed.includes(k)));
      // Only read/lock all freelancers when changing the unique access code.
      // Ordinary profile/status/activity updates must not serialize every workspace.
      if(accepted.access_code) {
        const all=await tx.get(this.store.collection('freelancers'));
        if(all.docs.some(doc=>doc.id!==id && String(doc.data()?.access_code || '').toLowerCase()===String(accepted.access_code).toLowerCase())) {
          throw Object.assign(new Error('Link de acesso já está em uso.'),{status:409});
        }
      }
      const f=clean({...snap.data(),...accepted,id,updated_at:now()}) as Freelancer;
      tx.set(ref,f);
      return f;
    });
  }
  async setFreelancerStatus(id:string,status:Freelancer['status']) {return this.updateFreelancer(id,{status});}
  async regenerateFreelancerAccessCode(id:string) {const f=await this.getFreelancerById(id);if(!f)return undefined;const code=`${accessCodeBase(f.name)}-${crypto.randomBytes(3).toString('hex')}`;await this.updateFreelancer(id,{access_code:code});return code;}
  async deleteFreelancer(id:string) {const f=await this.getFreelancerById(id);if(!f)return {success:false,leadsRemoved:0,jobsRemoved:0,activitiesRemoved:0};const jobsRemoved=await this.cancelWorkspaceJobs(id);await this.store.collection('freelancers').doc(id).update({status:'blocked',deleted_at:now(),updated_at:now()});return {success:true,name:f.name,leadsRemoved:0,jobsRemoved,activitiesRemoved:0};}
  async logActivity(activity:Omit<Activity,'id'|'created_at'>) {const item=clean({...activity,id:crypto.randomUUID(),created_at:now()});await this.store.collection('activities').doc(item.id).create(item);return item;}
  async getSearchJob(id:string) {const job=await this.get<SearchJob>('search_jobs',id);if(job)assertOwner(job);return job;}
  async getAllSearchJobs(id?:string) {const actor=actorContext.getStore();return (await this.list<SearchJob>('search_jobs')).filter(j=>(id===undefined || isLeadInWorkspace(j,id)) && (actor?.role!=='freelancer'||isLeadInWorkspace(j,actor.freelancerId))).sort((a,b)=>b.created_at.localeCompare(a.created_at));}
  async claimSearchJob(id:string,token:string,leaseMs=80_000) {return this.store.runTransaction(async tx=>{const ref=this.store.collection('search_jobs').doc(id);const snap=await tx.get(ref);if(!snap.exists)return false;const job={...snap.data(),id} as SearchJob;assertOwner(job);if(!['pending','running'].includes(job.status))return false;if(job.lease_token && job.lease_token!==token && (job.lease_until || 0)>Date.now())return false;tx.update(ref,{status:'running',lease_token:token,lease_until:Date.now()+leaseMs,started_at:job.started_at||now(),updated_at:now()});return true;});}
  async renewSearchJobLease(id:string,token:string,leaseMs=80_000) {return this.store.runTransaction(async tx=>{const ref=this.store.collection('search_jobs').doc(id);const snap=await tx.get(ref);if(!snap.exists || snap.data()?.lease_token!==token || snap.data()?.status!=='running')return false;tx.update(ref,{lease_until:Date.now()+leaseMs,updated_at:now()});return true;});}
  async releaseSearchJobLease(id:string,token:string) {return this.store.runTransaction(async tx=>{const ref=this.store.collection('search_jobs').doc(id);const snap=await tx.get(ref);if(!snap.exists || snap.data()?.lease_token!==token)return false;tx.update(ref,{lease_token:'',lease_until:0,updated_at:now()});return true;});}
  async createSearchJob(job:SearchJob,areas:SearchArea[]=[]) {
    // Areas are embedded in the initial document so no partially prepared job is runnable.
    await this.store.collection('search_jobs').doc(job.id).create(clean({...job,area_plan:areas}));return job;
  }
  async updateSearchJob(id:string,updates:Partial<SearchJob>) {return this.store.runTransaction(async tx=>{const ref=this.store.collection('search_jobs').doc(id);const snap=await tx.get(ref);if(!snap.exists)return undefined;assertOwner(snap.data()!);const job=clean({...snap.data(),...updates,id,updated_at:now()}) as SearchJob;tx.set(ref,job);return job;});}
  async getSearchAreas(id:string) {const job=await this.getSearchJob(id);return job?.area_plan || this.list<SearchArea>('search_areas','search_job_id',id);}
  async ensureSearchAreasLoaded(id:string) {return this.getSearchAreas(id);}
  async getSearchQueries(id:string) {await this.getSearchJob(id);return this.list<SearchQueryLog>('search_queries','search_job_id',id);}
  async addSearchAreas(areas:SearchArea[]) {
    const groups=new Map<string,SearchArea[]>();
    for(const area of areas)groups.set(area.search_job_id,[...(groups.get(area.search_job_id)||[]),area]);
    for(const [jobId,items] of groups)await this.updateSearchJob(jobId,{area_plan:items});
  }
  async updateSearchArea(id:string,updates:Partial<SearchArea>) {
    const jobs=await this.list<SearchJob>('search_jobs');
    const job=jobs.find(item=>item.area_plan?.some(area=>area.id===id));
    if(!job)return undefined;
    const areas=(job.area_plan||[]).map(area=>area.id===id?clean({...area,...updates,id}):area);
    await this.updateSearchJob(job.id,{area_plan:areas});
    return areas.find(area=>area.id===id);
  }
  // Update just the target job's area plan, avoiding a full search_jobs scan.
  async updateJobArea(jobId:string,areaId:string,updates:Partial<SearchArea>) {
    return this.store.runTransaction(async tx=>{
      const ref=this.store.collection('search_jobs').doc(jobId);
      const snap=await tx.get(ref);
      if(!snap.exists)return undefined;
      assertOwner(snap.data()!);
      const original=(snap.data() as SearchJob).area_plan||[];
      const index=original.findIndex(a=>a.id===areaId);
      if(index<0)return undefined;
      const updated=clean({...original[index],...updates,id:areaId});
      const areas=original.slice();
      areas[index]=updated;
      tx.update(ref,{area_plan:areas,updated_at:now()});
      return updated;
    });
  }
  /** Complete one search cell and its counters atomically after all receipts are saved. */
  async completeSearchArea(
    jobId:string,
    areaId:string,
    leaseToken:string,
    metrics:{newPlaces:number;withoutSite:number;newLeads:number;matchingFilters:number;placesInArea:number},
  ) {
    return this.store.runTransaction(async tx=>{
      const ref=this.store.collection('search_jobs').doc(jobId);
      const snap=await tx.get(ref);
      if(!snap.exists)return false;
      const job=snap.data() as SearchJob;
      assertOwner(job);
      if(job.status!=='running' || job.lease_token!==leaseToken)return false;
      const areas=job.area_plan||[];
      const index=areas.findIndex(a=>a.id===areaId);
      if(index<0 || areas[index].status==='completed')return false;
      const updatedAreas=areas.slice();
      updatedAreas[index]=clean({...areas[index],status:'completed',places_found:metrics.placesInArea,new_places_found:metrics.newPlaces,matching_filters:metrics.matchingFilters,new_leads:metrics.newLeads,processed_at:now(),error:undefined});
      const processedCities=new Set(updatedAreas.filter(a=>a.status==='completed').map(a=>a.city)).size;
      tx.update(ref,{
        area_plan:updatedAreas,
        processed_search_areas:updatedAreas.filter(a=>a.status==='completed'||a.status==='failed').length,
        processed_cities:processedCities,
        places_found:(job.places_found||0)+metrics.newPlaces,
        places_without_website:(job.places_without_website||0)+metrics.withoutSite,
        leads_created:(job.leads_created||0)+metrics.newLeads,
        matching_filters:(job.matching_filters||0)+metrics.matchingFilters,
        updated_at:now(),
      });
      return true;
    });
  }

  /** Retry only incomplete cells, resetting them in ONE transaction (not 170 RPC calls). */
  async prepareSearchJobResume(jobId:string) {
    return this.store.runTransaction(async tx=>{
      const ref=this.store.collection('search_jobs').doc(jobId);
      const snap=await tx.get(ref);
      if(!snap.exists)return false;
      const job=snap.data() as SearchJob;
      assertOwner(job);
      if(!['paused','failed'].includes(job.status))return false;
      const plan=job.area_plan||[];
      const recovered=plan.map(area=>['failed','processing'].includes(area.status)
        ? clean({...area,status:'pending',error:undefined}) as SearchArea
        : area);
      const completed=recovered.filter(area=>area.status==='completed');
      tx.update(ref,{
        area_plan:recovered,
        status:'pending',
        lease_token:'',
        lease_until:0,
        processed_search_areas:completed.length,
        processed_cities:new Set(completed.map(area=>area.city)).size,
        error_message:'',
        updated_at:now(),
      });
      return true;
    });
  }

  async logSearchQuery(query:SearchQueryLog) {await this.store.collection('search_queries').doc(query.id).create(clean(query));return query;}
  async logSearchResult(result:Record<string,unknown>&{id?:string}) {const id=result.id||crypto.randomUUID();const item=clean({...result,id});await this.store.collection('search_results').doc(id).set(item);return item;}
  async getSettings():Promise<AppSettings> {const config=await this.get<Partial<AppSettings>>('settings','config');const key=process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || config?.googleMapsApiKey || '';return {...defaults,...config,googleMapsApiKey:key,hasCustomKey:Boolean(key)};}
  async updateSettings(updates:Partial<AppSettings>) {const allowed=['googleMapsApiKey','maxResultsPerJob','maxCitiesPerJob','requestDelayMs','scoringWeights'];await this.store.collection('settings').doc('config').set(clean(Object.fromEntries(Object.entries(updates).filter(([k])=>allowed.includes(k)))),{merge:true});return this.getSettings();}
}
export const db = new Repository();
