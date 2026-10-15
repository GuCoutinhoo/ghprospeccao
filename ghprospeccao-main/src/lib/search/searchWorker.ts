import crypto from 'node:crypto';
import { db, Repository } from '../store/db';
import { now, digest, leadIdentity } from '../store/repository';
import { ownerOf } from '../store/ownership';
import { normalizePlace } from '../google/places';
import { searchPage, type PlacesPage } from '../google/searchPage';
import { isPlaceRelevantToNiche } from './relevance';
import { CITY_COORDINATES, METROPOLITAN_GRIDS, POPULAR_CITIES_BY_STATE, fetchCitiesByState } from '../ibge/ibgeService';
import { calculateLeadScore } from '../scoring/leadScore';
import type { SearchArea, SearchJob, SearchJobFilters, Place, Lead } from '../../types';

export async function createAndPrepareSearchJob(params:{userId:string;freelancerId?:string;freelancerName?:string;state:string;city:string;niche:string;filters:SearchJobFilters},repo=db) {
  const settings=await repo.getSettings();
  let cities=params.city==='all' ? [...new Set([...(POPULAR_CITIES_BY_STATE[params.state]||[]),...(await fetchCitiesByState(params.state,true)).map(c=>c.nome)])] : [params.city];
  if(settings.maxCitiesPerJob>0)cities=cities.slice(0,settings.maxCitiesPerJob);
  if(!cities.length)throw new Error('Não foi possível determinar as cidades da busca.');
  const id=`job_${crypto.randomUUID()}`;
  const areas:SearchArea[]=cities.flatMap(city=>{
    const coord=CITY_COORDINATES[city];
    const cells=METROPOLITAN_GRIDS[city] || [{lat:coord?.lat || 0,lng:coord?.lng || 0,radius:12000}];
    return cells.map((cell,i)=>({id:`${id}_${digest(city).slice(0,12)}_${i}`,search_job_id:id,city,state:params.state,...cell,status:'pending' as const,attempts:0,places_found:0}));
  });
  const job:SearchJob={id,version:2,user_id:params.userId,workspace_id:params.freelancerId||'admin',freelancer_id:params.freelancerId,freelancer_name:params.freelancerName,state:params.state,city:params.city,niche:params.niche,filters:params.filters,status:'pending',target_leads:params.filters.targetLeads||0,total_cities:cities.length,processed_cities:0,total_search_areas:areas.length,processed_search_areas:0,places_found:0,places_without_website:0,leads_created:0,approved_count:0,duplicates_count:0,rejected_count:0,deleted_count:0,results_count:0,area_cursor:0,candidate_cursor:0,created_at:now(),updated_at:now()};
  await repo.createSearchJob(job,areas);
  return {job,estimatedQueries:areas.length,totalCities:cities.length,totalAreas:areas.length};
}
export function checkLeadFilters(place:Partial<Place>,filters:SearchJobFilters) {
  return (!filters.onlyWithoutWebsite || (!place.website?.trim() && place.website_status==='no_website')) &&
    (!filters.onlyWithPhone || (place.phone?.replace(/\D/g,'').length||0)>=8) &&
    (place.rating||0)>=filters.minRating && (place.reviews_count||0)>=filters.minReviews &&
    (!filters.maxReviews || (place.reviews_count||0)<=filters.maxReviews) &&
    (!place.business_status || place.business_status==='OPERATIONAL');
}
type FetchPage=(query:string,key:string,options:Parameters<typeof searchPage>[2])=>Promise<PlacesPage>;
const clean=<T>(value:T):T=>JSON.parse(JSON.stringify(value));

/** One bounded, awaited queue delivery. Lease + fencing protect independent instances. */
export async function runSearchJob(jobId:string,repo:Repository=db,fetchPage:FetchPage=searchPage,budgetMs=25000) {
  const started=Date.now();const token=crypto.randomUUID();const ref=repo.firestore.collection('search_jobs').doc(jobId);
  const claimed=await repo.firestore.runTransaction(async tx=>{
    const snap=await tx.get(ref);if(!snap.exists)return false;const j=snap.data() as SearchJob;
    if(!['pending','running'].includes(j.status) || (j.retry_at||0)>Date.now() || (j.lease_until||0)>Date.now())return false;
    if(j.version!==2) {tx.update(ref,{status:'paused',error_message:'Busca histórica: revisar antes de executar novamente.'});return false;}
    tx.update(ref,{status:'running',lease_token:token,lease_until:Date.now()+45000,started_at:j.started_at||now(),updated_at:now()});return true;
  },{maxAttempts:1}).catch(error=>{if(error.code===10)return false;throw error;});
  if(!claimed)return false;
  const guarded=async<T>(fn:(tx:import('firebase-admin/firestore').Transaction,j:SearchJob)=>Promise<T>)=>repo.firestore.runTransaction(async tx=>{
    const snap=await tx.get(ref);const j=snap.data() as SearchJob;
    if(!j || j.status!=='running' || j.lease_token!==token || (j.lease_until||0)<=Date.now())return undefined;
    return fn(tx,j);
  },{maxAttempts:1}).catch(error=>{if(error.code===10)return undefined;throw error;});
  try {
    const settings=await repo.getSettings();
    while(Date.now()-started<budgetMs) {
      const job=await repo.getSearchJob(jobId);
      if(!job || job.status!=='running' || job.lease_token!==token)break;
      const cursor=job.area_cursor||0;const area=job.area_plan?.[cursor];
      if((job.target_leads>0 && job.leads_created>=job.target_leads) || !area) {
        await guarded(async(tx,j)=>{
          tx.update(ref,{status:'completed',completion_reason:area?'target_reached':'exhausted',finished_at:now(),lease_token:'',lease_until:0,updated_at:now()});
          tx.set(repo.firestore.collection('activities').doc(`completed_${jobId}`),clean({id:`completed_${jobId}`,freelancer_id:j.freelancer_id||'admin',action_type:'search_completed',description:`Busca concluída com ${j.leads_created} novos leads persistidos.`,metadata:{jobId,leads_created:j.leads_created},created_at:now()}));return true;
        });break;
      }
      if(!job.candidates) {
        // External calls are outside transactions. Checkpoint each page before saving leads.
        const queryStarted=Date.now();
        const page=await fetchPage(`${job.niche} em ${area.city} ${area.state}`,settings.googleMapsApiKey,{pageToken:job.page_token,lat:area.lat,lng:area.lng,radius:area.radius});
        if(page.nextPageToken && page.nextPageToken===job.page_token)throw new Error('PLACES_REPEATED_PAGE_TOKEN');
        await guarded(async(tx,j)=>{
          const plan=[...j.area_plan!];plan[cursor]={...plan[cursor],status:'processing',attempts:plan[cursor].attempts+1,places_found:plan[cursor].places_found+page.places.length};
          tx.update(ref,{area_plan:clean(plan),candidates:clean(page.places),candidate_cursor:0,next_page_token:page.nextPageToken||'',error_message:'',updated_at:now()});
          const id=digest(`${jobId}:${cursor}:${j.page_token||''}`);
          tx.set(repo.firestore.collection('search_queries').doc(id),{id,search_job_id:jobId,search_area_id:area.id,query:`${j.niche} em ${area.city} ${area.state}`,status:'success',results_count:page.places.length,duration_ms:Date.now()-queryStarted,created_at:now()});return true;
        });
        continue;
      }
      if((job.candidate_cursor||0)>=job.candidates.length) {
        await guarded(async(tx,j)=>{
          const plan=[...(j.area_plan||[])];const a=plan[cursor];
          if(!j.next_page_token)plan[cursor]={...a,status:'completed',processed_at:now()};
          const next= j.next_page_token ? cursor : cursor+1;
          const citiesDone=new Set(plan.filter(x=>x.status==='completed').map(x=>x.city));
          for(const a of plan.filter(x=>x.status!=='completed'))citiesDone.delete(a.city);
          tx.update(ref,{area_plan:clean(plan),area_cursor:next,page_token:j.next_page_token||'',next_page_token:'',candidates:null,candidate_cursor:0,processed_search_areas:next,processed_cities:citiesDone.size,updated_at:now()});return true;
        });
        break; // One page per delivery gives other workspaces a chance to run.
      }
      const raw=job.candidates[job.candidate_cursor||0];
      await guarded(async(tx,j)=>{
        const place=normalizePlace(raw,area.city,area.state);
        if(!raw.id && !raw.name)throw new Error('PLACES_MISSING_ID');
        const receiptRef=repo.firestore.collection('search_results').doc(digest(`${jobId}:${place.place_id}`));
        const receipt=await tx.get(receiptRef);
        const patch:Record<string,unknown>={candidate_cursor:(j.candidate_cursor||0)+1,updated_at:now(),attempts:0};
        if(receipt.exists){tx.update(ref,patch);return;}
        const approved=isPlaceRelevantToNiche(place,j.niche)&&checkLeadFilters(place,j.filters)&&place.state===j.state;
        patch.places_found=j.places_found+1;
        patch.places_without_website=j.places_without_website+(place.website_status==='no_website'?1:0);
        let result='rejected';let leadId:string|undefined;
        if(approved){
          const lead:Lead=clean({id:leadIdentity(ownerOf(j),place.place_id,j.niche),workspace_id:j.workspace_id,user_id:j.user_id,freelancer_id:j.freelancer_id,freelancer_name:j.freelancer_name,place_id:place.place_id,name:place.name,niche:j.niche,state:place.state,city:place.city,address:place.formatted_address,phone:place.phone,website:place.website,website_status:place.website_status,maps_url:place.maps_url,rating:place.rating,reviews_count:place.reviews_count,lead_score:calculateLeadScore(place,settings.scoringWeights).score,pipeline_status:'NOVO',search_job_ids:[j.id],created_at:now(),updated_at:now()});
          const saved=await repo.createLeadInTransaction(tx,lead);
          result=saved.isDeleted?'deleted':saved.created?'created':'duplicate';leadId=saved.isDeleted?undefined:saved.lead.id;
          if(!saved.created && !saved.isDeleted)tx.update(repo.firestore.collection('leads').doc(saved.lead.id),{search_job_ids:[...new Set([...(saved.lead.search_job_ids||[]),j.id])]});
          patch.approved_count=(j.approved_count||0)+1;
          patch.leads_created=j.leads_created+(saved.created?1:0);
          patch.duplicates_count=(j.duplicates_count||0)+(result==='duplicate'?1:0);
          patch.deleted_count=(j.deleted_count||0)+(result==='deleted'?1:0);
          patch.results_count=(j.results_count||0)+(leadId?1:0);
        }else patch.rejected_count=(j.rejected_count||0)+1;
        tx.set(repo.firestore.collection('places').doc(place.id),clean(place),{merge:true});
        tx.create(receiptRef,clean({job_id:jobId,workspace_id:j.workspace_id,place_id:place.place_id,lead_id:leadId,result,created_at:now()}));
        tx.update(ref,patch);
      });
    }
  } catch(error) {
    await guarded(async(tx,j)=>{const attempts=(j.attempts||0)+1;tx.update(ref,{attempts,status:attempts>=5?'failed':'running',retry_at:Date.now()+Math.min(60000,1000*2**attempts),error_message:'Falha de processamento. Checkpoint preservado para nova tentativa.',updated_at:now()});return true;});
    throw error;
  } finally {
    await guarded(async(tx)=>{tx.update(ref,{lease_token:'',lease_until:0});return true;});
  }
  return true;
}
export async function pauseSearchJob(id:string,repo=db){return Boolean(await repo.updateSearchJob(id,{status:'paused',lease_token:'',lease_until:0}));}
export async function cancelSearchJob(id:string,repo=db){return Boolean(await repo.updateSearchJob(id,{status:'cancelled',lease_token:'',lease_until:0,finished_at:now()}));}
export async function resumeSearchJob(id:string,repo=db){const job=await repo.getSearchJob(id);if(!job || job.version!==2 || ['completed','cancelled'].includes(job.status))return false;return Boolean(await repo.updateSearchJob(id,{status:'pending',lease_token:'',lease_until:0,retry_at:0,attempts:0,error_message:''}));}
export async function cleanupStaleJobs(){return 0;}
export async function cancelAllSearchWorkers(){return db.cancelWorkspaceJobs('ALL');}
export async function isJobWorkerActive(id:string){const job=await db.getSearchJob(id);return (job?.lease_until||0)>Date.now();}
export async function dispatchSearchJobs(repo=db) {
  const jobs=(await repo.getAllSearchJobs('ALL')).filter(j=>['pending','running'].includes(j.status)).sort((a,b)=>a.updated_at.localeCompare(b.updated_at));
  for(const job of jobs){if(await runSearchJob(job.id,repo))return job.id;}return null;
}
