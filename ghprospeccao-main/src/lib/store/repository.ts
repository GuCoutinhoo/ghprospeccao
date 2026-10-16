import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { Filter as FirestoreFilter } from 'firebase-admin/firestore';
import { SupabaseFilter } from '../supabase/firestoreAdapter';
import { shouldUseSupabase } from '../supabase/admin';
const Filter: typeof FirestoreFilter = shouldUseSupabase() ? SupabaseFilter as unknown as typeof FirestoreFilter : FirestoreFilter;
import { getServerFirestore } from '../firebase/admin';
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
const freelancerInputError=(message:string,status=400)=>Object.assign(new Error(message),{status});
const freelancerSlug=(raw:string):string=>String(raw || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
  .replace(/^\/?f\//,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64).replace(/-+$/,'');
const isFriendlyFreelancerCode=(value:string)=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const createTemporaryPin=()=>crypto.randomInt(0,1_000_000).toString().padStart(6,'0');

const mutableLeadFields = new Set(['name','phone','address','city','state','website','website_status','maps_url','is_favorite','is_hidden','pipeline_status','contacted_at','contact_attempts_count','response_at','follow_up_at','negotiation_at','sale_value','sale_date','preview_url','notes']);
export const pipelineStatuses = ['NOVO','PRÉVIA CRIADA','CONTATADO','RESPONDEU','INTERESSADO','FOLLOW_UP','NEGOCIACAO','REUNIÃO','PROPOSTA','FECHADO','PERDIDO','NAO_INTERESSADO','SEM_RESPOSTA'];
const defaults: AppSettings = {googleMapsApiKey:'',hasCustomKey:false,maxResultsPerJob:0,maxCitiesPerJob:0,requestDelayMs:400,scoringWeights:DEFAULT_SCORING_WEIGHTS};

/** Firestore is authoritative. Every method returns only after its read/commit succeeds. */
export class Repository {
  constructor(private supplied?: Firestore) {}
  get firestore() { return this.supplied || getServerFirestore(); }
  async list<T>(collection: string, field?: string, value?: unknown): Promise<T[]> {
    const ref = this.firestore.collection(collection);
    const snap = await (field ? ref.where(field, '==', value) : ref).get();
    return snap.docs.map(d => ({...d.data(), id:d.id}) as T);
  }
  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const snap = await this.firestore.collection(collection).doc(id).get();
    return snap.exists ? {...snap.data(), id:snap.id} as T : undefined;
  }
  async ensureInitialized() { await this.firestore.collection('settings').doc('config').get(); }
  async ensureWorkspaceHydrated(_workspace?: string, _force?: boolean) { await this.ensureInitialized(); }
  async syncFromFirestore() { const [leads,places] = await Promise.all([this.list<Lead>('leads'),this.list<Place>('places')]); return {leadsCount:leads.length,placesCount:places.length}; }
  private async projection(includeAdmin = false, workspace?:string) {
    // A single read-only transaction gives every aggregate a consistent snapshot.
    // Legacy ownership fields are retained; no implicit backfill or truncated query.
    return this.firestore.runTransaction(async tx => {
      const actor = actorContext.getStore();
      const target=actor?.role==='freelancer'?actor.freelancerId:workspace;
      const base=this.firestore.collection('leads');
      const canonical=canonicalWorkspace(target);
      const short=canonical.replace(/^freelancer:/,'');
      const ids=[...new Set([target,canonical,short,`free_${short}`])].filter(Boolean);
      const query=target && target!=='ALL' && canonical!=='admin' ? base.where(Filter.or(...['workspace_id','freelancer_id','user_id'].map(field=>Filter.where(field,'in',ids)))) : base;
      const leads = await tx.get(query);
      const tombs = await tx.get(this.firestore.collection('deleted_leads'));
      const deleted = new Set(tombs.docs.map(d => d.id));
      const rows = leads.docs.filter(d => !deleted.has(d.id)).map(d => ({...d.data(),id:d.id}) as Lead).filter(l => actor?.role !== 'freelancer' || isLeadInWorkspace(l,actor.freelancerId));
      const data = {leads:rows,freelancers:[] as Freelancer[],activities:[] as Activity[],search_jobs:[] as SearchJob[]};
      if (includeAdmin) {
        for (const col of ['freelancers','activities','search_jobs'] as const) {
          const snap = await tx.get(this.firestore.collection(col));
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
    if (!job || (params.freelancer_id !== 'ALL' && !isLeadInWorkspace(job,params.freelancer_id)))
      return {leads:[] as Lead[],total:0,page:1,totalPages:1};
    const f = job.filters;
    // Each receipt represents one candidate of THIS search, including reused leads.
    // Never overwrite existing lead documents to apply a later search's filters.
    const receipts = await this.list<{lead_id?:string;rating?:number;reviews_count?:number;website?:string;website_status?:Lead['website_status'];phone?:string}>('search_results','job_id',job.id);
    const snapshots = new Map<string,Partial<Lead>>();
    for (const receipt of receipts) {
      if (!receipt.lead_id) continue;
      // Old receipts lack snapshots; keep legacy associations and filter stored metrics.
      if (typeof receipt.rating !== 'number' || typeof receipt.reviews_count !== 'number') continue;
      snapshots.set(receipt.lead_id,{
        rating:receipt.rating,reviews_count:receipt.reviews_count,
        website:receipt.website??'',website_status:receipt.website_status??'not_verified',
        phone:receipt.phone??''
      });
    }
    const projection = await this.projection(false,params.freelancer_id);
    return projection.getLeads({
      ...params,
      onlyWithoutWebsite:Boolean(params.onlyWithoutWebsite || f.onlyWithoutWebsite),
      onlyWithPhone:Boolean(params.onlyWithPhone || f.onlyWithPhone),
      minRating:Math.max(params.minRating??0,f.minRating??0),
      minReviews:Math.max(params.minReviews??0,f.minReviews??0),
      maxReviews:f.maxReviews,
    },snapshots);
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
  async upsertPlace(place: Place) { await this.firestore.collection('places').doc(place.id).set(clean(place),{merge:true}); return {place,isNew:true}; }

  async createLead(lead: Lead) {
    assertOwner(lead);
    return this.firestore.runTransaction(async tx => this.createLeadInTransaction(tx,lead));
  }
  async createLeadInTransaction(tx: Transaction, input: Lead) {
    const id = leadIdentity(ownerOf(input),input.place_id,input.niche);
    const ref = this.firestore.collection('leads').doc(id);
    const existing = await tx.get(this.firestore.collection('leads').where('place_id','==',input.place_id));
    const legacyId = `lead_${input.freelancer_id || 'admin'}_${input.place_id}`;
    const tombs = await tx.getAll(...[...new Set([id,input.id,legacyId])].map(x => this.firestore.collection('deleted_leads').doc(x)));
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
    return this.firestore.runTransaction(async tx => {
      const ref=this.firestore.collection('leads').doc(id); const snap=await tx.get(ref);
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
    await this.firestore.runTransaction(async tx=>{const snap=await tx.get(this.firestore.collection('leads').doc(leadId));if(!snap.exists)throw new Error('Lead não encontrado');assertOwner(snap.data()!);tx.create(this.firestore.collection('lead_notes').doc(note.id),note);});return note;
  }
  async getLeadNotes(id:string) {await this.getLeadById(id);return this.list<LeadNote>('lead_notes','lead_id',id);}
  async deleteLead(id:string,freelancerId?:string) {
    return this.firestore.runTransaction(async tx=>{
      const ref=this.firestore.collection('leads').doc(id);const snap=await tx.get(ref);if(!snap.exists)return false;
      const lead={...snap.data(),id} as Lead;assertOwner(lead);
      if(freelancerId && !isLeadInWorkspace(lead,freelancerId))throw Object.assign(new Error('Acesso negado'),{status:403});
      // Preserve a recoverable commercial snapshot and notes; tombstones block resurrection.
      const tomb={deleted_at:now(),workspace_id:ownerOf(lead),lead};
      tx.set(this.firestore.collection('deleted_leads').doc(id),tomb);
      const identity=leadIdentity(ownerOf(lead),lead.place_id,lead.niche);
      if(identity!==id)tx.set(this.firestore.collection('deleted_leads').doc(identity),tomb);
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
  async purgeAllLeadsGlobal() {const jobsCancelled=await this.cancelWorkspaceJobs('ALL');const result=await this.deleteAllLeads({freelancerId:'ALL',role:'admin'});return {...result,jobsCancelled,firestoreDeletedCount:result.deletedCount};}
  async cleanFreelancerWorkspace(id:string) {return {leadsRemoved:(await this.deleteAllLeads({freelancerId:id,role:'admin'})).deletedCount};}
  async cancelWorkspaceJobs(id:string) {const jobs=await this.getAllSearchJobs(id);for(const job of jobs.filter(j=>['pending','running','paused','failed'].includes(j.status)))await this.updateSearchJob(job.id,{status:'cancelled',lease_token:'',lease_until:0});return jobs.length;}
  async getFreelancers() {return (await this.list<Freelancer>('freelancers')).filter(f=>!(f as any).deleted_at);}
  async getFreelancerById(id:string) {const f=await this.get<Freelancer>('freelancers',id);return (f as any)?.deleted_at?undefined:f;}
  async getFreelancerByAccessCode(code:string) {
    const clean = code.trim().toLowerCase().replace(/^https?:\/\/[^/]+\/f\//i, '').replace(/^\/f\//i, '').replace(/\/+$/, '');
    return (await this.getFreelancers()).find(f => {
      const fCode = (f.access_code || '').toLowerCase().trim();
      const fName = (f.name || '').toLowerCase().trim();
      const fId = (f.id || '').toLowerCase().trim();
      return fCode === clean ||
             fName === clean ||
             fId === clean ||
             fId === `free_${clean}` ||
             (clean === 'test' && (fCode === 'teste' || fId === 'free_teste' || fName === 'teste')) ||
             (clean === 'teste' && (fCode === 'test' || fId === 'free_test' || fName === 'test'));
    });
  }
  // Friendly paths are public identifiers, NOT authentication secrets. A PIN protects every new slug.
  async createFreelancer(data:{name:string;email:string;access_code?:string;notes?:string;pin?:string;status?:Freelancer['status']}) {
    const name=String(data.name || '').trim();
    const email=String(data.email || '').trim().toLowerCase();
    const explicitCode=Boolean(data.access_code?.trim());
    const baseCode=freelancerSlug(data.access_code || name.split(/\s+/)[0]);
    let code=baseCode;
    if(!name || !email || !code) throw freelancerInputError('Nome, e-mail e código de acesso válidos são obrigatórios.');
    const suppliedPin=typeof data.pin==='string' ? data.pin.trim() : '';
    if(suppliedPin && !/^\d{4,6}$/.test(suppliedPin)) throw freelancerInputError('O PIN deve ter de 4 a 6 dígitos.');
    const temporaryPin=suppliedPin ? undefined : createTemporaryPin();
    const id=`free_${crypto.randomUUID()}`, time=now();
    const f:Freelancer=clean({id,name,email,access_code:code,status:data.status || 'active',
      notes:data.notes?.trim() || '',pin_hash:hashPin(suppliedPin || temporaryPin!),created_at:time,updated_at:time});
    await this.firestore.runTransaction(async tx=>{
      const existing=await tx.get(this.firestore.collection('freelancers'));
      const occupied=new Set(existing.docs.filter(s=>!s.data()?.deleted_at)
        .map(s=>String(s.data()?.access_code||'').toLowerCase()));
      if(explicitCode && occupied.has(code))
        throw freelancerInputError('Este link já está em uso. Escolha outro código de acesso.',409);
      let suffix=2;
      while(occupied.has(code))code=`${baseCode}-${suffix++}`;
      f.access_code=code;
      tx.create(this.firestore.collection('freelancers').doc(id),f);
    });
    await this.logActivity({freelancer_id:id,action_type:'freelancer_created',description:'Freelancer cadastrado.'});
    return {...f,temporaryPin};
  }
  async updateFreelancer(id:string,updates:Partial<Freelancer>) {
    const inputCode=typeof updates.access_code==='string' && updates.access_code.trim()
      ? freelancerSlug(updates.access_code) : undefined;
    if(updates.access_code!==undefined && !inputCode)throw freelancerInputError('Código de acesso inválido.');
    const suppliedPin=typeof updates.pin==='string' ? updates.pin.trim() : '';
    if(suppliedPin && !/^\d{4,6}$/.test(suppliedPin))throw freelancerInputError('O PIN deve ter de 4 a 6 dígitos.');
    const allowed=['name','email','notes','status','last_access_at','last_activity_at'];
    return this.firestore.runTransaction(async tx=>{
      const collection=this.firestore.collection('freelancers');
      const ref=collection.doc(id), snap=await tx.get(ref);
      if(!snap.exists || snap.data()?.deleted_at)return undefined;
      const previous=snap.data() as Freelancer;
      const changedCode=Boolean(inputCode && inputCode!==previous.access_code.toLowerCase());
      if(changedCode){
        const existing=await tx.get(collection);
        if(existing.docs.some(s=>s.id!==id && !s.data()?.deleted_at &&
          String(s.data()?.access_code||'').toLowerCase()===inputCode))
          throw freelancerInputError('Este link já está em uso. Escolha outro código de acesso.',409);
      }
      const temporaryPin=changedCode && !suppliedPin && !previous.pin_hash && !previous.pin
        ? createTemporaryPin() : undefined;
      const pinToStore=suppliedPin || temporaryPin;
      const changes=Object.fromEntries(Object.entries(updates).filter(([k])=>allowed.includes(k)));
      if(inputCode)changes.access_code=inputCode;
      if(pinToStore){changes.pin_hash=hashPin(pinToStore);changes.pin='';}
      const f=clean({...previous,...changes,id,updated_at:now()}) as Freelancer;
      if(f.status==='active' && isFriendlyFreelancerCode(f.access_code) && !f.pin_hash && !f.pin)
        throw freelancerInputError('Configure um PIN de segurança antes de ativar este link.',409);
      tx.set(ref,f);
      return {...f,temporaryPin};
    });
  }
  async setFreelancerStatus(id:string,status:Freelancer['status']) {return this.updateFreelancer(id,{status});}
  async regenerateFreelancerAccessCode(id:string) {
    return this.firestore.runTransaction(async tx=>{
      const collection=this.firestore.collection('freelancers');
      const ref=collection.doc(id),snap=await tx.get(ref);
      if(!snap.exists || snap.data()?.deleted_at)return undefined;
      const freelancer=snap.data() as Freelancer;
      const all=await tx.get(collection);
      const base=freelancerSlug(freelancer.name.split(/\s+/)[0]);
      if(!base)throw freelancerInputError('Nome inválido para gerar o link.');
      let code=base,number=2;
      const codes=new Set(all.docs.filter(s=>s.id!==id && !s.data()?.deleted_at)
        .map(s=>String(s.data()?.access_code||'').toLowerCase()));
      while(codes.has(code) || code===freelancer.access_code.toLowerCase())code=`${base}-${number++}`;
      const temporaryPin=!freelancer.pin_hash && !freelancer.pin ? createTemporaryPin() : undefined;
      tx.update(ref,{access_code:code,updated_at:now(),...(temporaryPin?{pin_hash:hashPin(temporaryPin)}:{})});
      return {accessCode:code,temporaryPin};
    });
  }
  async deleteFreelancer(id:string) {const f=await this.getFreelancerById(id);if(!f)return {success:false,leadsRemoved:0,jobsRemoved:0,activitiesRemoved:0};await this.updateFreelancer(id,{status:'blocked'});const jobsRemoved=await this.cancelWorkspaceJobs(id);const {leadsRemoved}=await this.cleanFreelancerWorkspace(id);await this.firestore.collection('freelancers').doc(id).update({deleted_at:now()});return {success:true,name:f.name,leadsRemoved,jobsRemoved,activitiesRemoved:0};}
  async logActivity(activity:Omit<Activity,'id'|'created_at'>) {const item=clean({...activity,id:crypto.randomUUID(),created_at:now()});await this.firestore.collection('activities').doc(item.id).create(item);return item;}
  async getSearchJob(id:string) {const job=await this.get<SearchJob>('search_jobs',id);if(job)assertOwner(job);return job;}
  async getAllSearchJobs(id?:string) {const actor=actorContext.getStore();return (await this.list<SearchJob>('search_jobs')).filter(j=>isLeadInWorkspace(j,id) && (actor?.role!=='freelancer'||isLeadInWorkspace(j,actor.freelancerId))).sort((a,b)=>b.created_at.localeCompare(a.created_at));}
  async createSearchJob(job:SearchJob,areas:SearchArea[]=[]) {
    // Areas are embedded in the initial document so no partially prepared job is runnable.
    await this.firestore.collection('search_jobs').doc(job.id).create(clean({...job,area_plan:areas}));return job;
  }
  async updateSearchJob(id:string,updates:Partial<SearchJob>) {return this.firestore.runTransaction(async tx=>{const ref=this.firestore.collection('search_jobs').doc(id);const snap=await tx.get(ref);if(!snap.exists)return undefined;assertOwner(snap.data()!);const job=clean({...snap.data(),...updates,id,updated_at:now()}) as SearchJob;tx.set(ref,job);return job;});}
  async getSearchAreas(id:string) {const job=await this.getSearchJob(id);return job?.area_plan || this.list<SearchArea>('search_areas','search_job_id',id);}
  async ensureSearchAreasLoaded(id:string) {return this.getSearchAreas(id);}
  async getSearchQueries(id:string) {await this.getSearchJob(id);return this.list<SearchQueryLog>('search_queries','search_job_id',id);}
  async getSettings():Promise<AppSettings> {const config=await this.get<Partial<AppSettings>>('settings','config');const key=process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || config?.googleMapsApiKey || '';return {...defaults,...config,googleMapsApiKey:key,hasCustomKey:Boolean(key)};}
  async updateSettings(updates:Partial<AppSettings>) {const allowed=['googleMapsApiKey','maxResultsPerJob','maxCitiesPerJob','requestDelayMs','scoringWeights'];await this.firestore.collection('settings').doc('config').set(clean(Object.fromEntries(Object.entries(updates).filter(([k])=>allowed.includes(k)))),{merge:true});return this.getSettings();}
}
export const db = new Repository();
