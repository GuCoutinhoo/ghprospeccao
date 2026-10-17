import crypto from 'node:crypto';
import { db } from '../store/db';
import { searchPlacesOfficial, normalizePlace, GooglePlaceRaw } from '../google/places';
import { CITY_COORDINATES, METROPOLITAN_GRIDS, POPULAR_CITIES_BY_STATE, fetchCitiesByState } from '../ibge/ibgeService';
import { calculateLeadScore } from '../scoring/leadScore';
import { SearchArea, SearchJob, SearchQueryLog } from '../../types';
import { matchesRatingRange } from './ratingFilter';
import { isPlaceRelevantToNiche } from './relevance';

interface ActiveWorker {
  jobId: string;
  paused: boolean;
  cancelled: boolean;
}

const activeWorkers = new Map<string, ActiveWorker>();

export async function createAndPrepareSearchJob(params: {
  userId: string;
  freelancerId?: string;
  freelancerName?: string;
  state: string;
  city: string; // 'all' ou nome da cidade
  niche: string;
  filters: {
    onlyWithoutWebsite: boolean;
    onlyWithPhone: boolean;
    minRating: number;
    maxRating?: number;
    minReviews: number;
    maxReviews?: number;
    targetLeads?: number;
  };
}): Promise<{ job: SearchJob; estimatedQueries: number; totalCities: number; totalAreas: number }> {
  const settings = await db.getSettings();
  let targetCities: string[] = [];

  if (params.city === 'all') {
    // Prioriza as maiores cidades do estado (de grande relevância comercial)
    const popular = POPULAR_CITIES_BY_STATE[params.state] || [];
    const ibgeCities = await fetchCitiesByState(params.state);
    const otherCities = ibgeCities
      .map((c) => c.nome)
      .filter((nome) => !popular.includes(nome));

    // Combina: cidades polo primeiro, seguidas pelas demais
    const combined = [...popular, ...otherCities];
    if (settings.maxCitiesPerJob && settings.maxCitiesPerJob > 0) {
      targetCities = combined.slice(0, settings.maxCitiesPerJob);
    } else {
      targetCities = combined;
    }
    if (targetCities.length === 0) {
      targetCities = ['Capital'];
    }
  } else {
    targetCities = [params.city];
  }

  // Montar Search Areas (com grid para cidades grandes)
  const areas: SearchArea[] = [];
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  for (const c of targetCities) {
    const grid = METROPOLITAN_GRIDS[c];
    if (grid && grid.length > 0) {
      // Cidade grande: subdivide em regiões
      for (const cell of grid) {
        areas.push({
          id: `area_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          search_job_id: jobId,
          city: c,
          state: params.state,
          lat: cell.lat,
          lng: cell.lng,
          radius: cell.radius,
          status: 'pending',
          attempts: 0,
          places_found: 0,
        });
      }
    } else {
      // Cidade normal: usa coordenadas reais se conhecidas, senão 0 para não enviesar a busca geográfica
      const coords = CITY_COORDINATES[c];
      areas.push({
        id: `area_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        search_job_id: jobId,
        city: c,
        state: params.state,
        lat: coords ? coords.lat : 0,
        lng: coords ? coords.lng : 0,
        radius: coords ? 12000 : 0,
        status: 'pending',
        attempts: 0,
        places_found: 0,
      });
    }
  }

  const workspaceId = params.freelancerId ? params.freelancerId : 'admin';

  const newJob: SearchJob = {
    id: jobId,
    workspace_id: workspaceId,
    user_id: params.userId,
    freelancer_id: params.freelancerId,
    freelancer_name: params.freelancerName,
    state: params.state,
    city: params.city,
    niche: params.niche,
    status: 'pending',
    filters: params.filters,
    target_leads: params.filters.targetLeads || 0,
    total_cities: targetCities.length,
    processed_cities: 0,
    total_search_areas: areas.length,
    processed_search_areas: 0,
    places_found: 0,
    places_without_website: 0,
    matching_filters: 0,
    metrics_version: 1,
    leads_created: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await db.createSearchJob(newJob, areas);

  return {
    job: newJob,
    estimatedQueries: areas.length,
    totalCities: targetCities.length,
    totalAreas: areas.length,
  };
}

export async function runSearchJob(jobId: string, maxAreas = Number.POSITIVE_INFINITY) {
  const job = await db.getSearchJob(jobId);
  if (!job) return;

  const leaseToken = crypto.randomUUID();
  if (!(await db.claimSearchJob(jobId, leaseToken))) return;

  const worker: ActiveWorker = {
    jobId,
    paused: false,
    cancelled: false,
  };
  activeWorkers.set(jobId, worker);

  try {
    const areas = await db.getSearchAreas(jobId);
    const pendingAreas = areas.filter(a => a.status === 'pending' || (a.status === 'processing' && (job.lease_until || 0) < Date.now()));
    // Prioritize underexplored large cities over repetitive metropolitan grid cells.
    const firstCities = [...new Set(areas.map(a => a.city))].slice(0, 16);
    const priorityCities = new Set(firstCities);
    const doneByCity = new Map<string,number>();
    for (const area of areas.filter(a => a.status === 'completed')) {
      doneByCity.set(area.city, (doneByCity.get(area.city)||0)+1);
    }
    pendingAreas.sort((a,b)=>{
      const priorityA=priorityCities.has(a.city)?0:1;
      const priorityB=priorityCities.has(b.city)?0:1;
      return priorityA-priorityB
        || (doneByCity.get(a.city)||0)-(doneByCity.get(b.city)||0)
        || firstCities.indexOf(a.city)-firstCities.indexOf(b.city);
    });
    const settings = await db.getSettings();
    const targetGoal = job.target_leads || 0;
    let persistedLeadCount = job.leads_created || 0;

    const citiesSeen = new Set(areas.filter(a=>a.status==='completed').map(a=>a.city));
    let attemptedAreas = 0;

    for (const area of pendingAreas) {
      if (attemptedAreas >= maxAreas) break;
      attemptedAreas++;
      try {
        if (maxAreas > 1 && !(await db.renewSearchJobLease(jobId, leaseToken))) return;
        // Checa se já atingiu a meta de leads desejada pelo usuário
        if (targetGoal > 0) {
          const currentJobCheck = await db.getSearchJob(jobId);
          if (currentJobCheck && currentJobCheck.leads_created >= targetGoal) {
            break;
          }
        }
        // Checagem de pausa ou cancelamento
        const currentWorker = activeWorkers.get(jobId);
        if (!currentWorker || currentWorker.cancelled) {
          await db.updateSearchJob(jobId, { status: 'cancelled' });
          return;
        }

        if (currentWorker.paused) {
          await db.updateSearchJob(jobId, { status: 'paused' });
          return;
        }

        // Marca área como em processamento
        await db.updateJobArea(jobId, area.id, {
          status: 'processing',
          attempts: area.attempts + 1,
        });

        const query = `${job.niche} em ${area.city} ${area.state}`;
        const startTime = Date.now();

        let rawPlaces: GooglePlaceRaw[] = [];
        let queryError: string | undefined;

        // Consulta oficial à Google Places API (New) Text Search
        const apiKey = settings.googleMapsApiKey || process.env.GOOGLE_MAPS_API_KEY || '';
        const hasRealCoords = area.lat !== 0 && area.lng !== 0;
        const res = await searchPlacesOfficial(
          query,
          apiKey,
          hasRealCoords
            ? {
                locationBias: {
                  circle: {
                    center: { latitude: area.lat, longitude: area.lng },
                    radius: area.radius || 12000,
                  },
                },
                maxResultCount: 20,
              }
            : {
                maxResultCount: 20,
              }
        );

        if (res.isQuotaExceeded) {
          // Failed quota requests are not completed areas. Keep the cursor intact.
          await db.updateJobArea(jobId, area.id, {
            status: 'pending',
            error: res.error || 'Cota do Google Places esgotada.',
          });
          await db.updateSearchJob(jobId, {
            status: 'paused',
            error_message: 'A Google Places atingiu a cota de consultas. Busca pausada sem perder leads. Retome quando houver cota disponível.',
          });
          return;
        } else if (res.error) {
          // Erro da API não representa área pesquisada com zero resultados.
          queryError = res.error;
        } else {
          rawPlaces = res.places;
        }

        // A pause/cancel on a different serverless instance is authoritative.
        if ((await db.getSearchJob(jobId))?.status !== 'running') return;

        const durationMs = Date.now() - startTime;

        // Log da consulta realizada
        await db.logSearchQuery({
          id: `query_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          search_job_id: jobId,
          search_area_id: area.id,
          query,
          status: queryError ? 'error' : 'success',
          results_count: rawPlaces.length,
          duration_ms: durationMs,
          error_details: queryError,
          created_at: new Date().toISOString(),
        });

        if (queryError) {
          await db.updateJobArea(jobId, area.id, { status: 'failed', error: queryError });
          await db.updateSearchJob(jobId, {
            status: 'failed',
            error_message: `Falha na consulta Google Places: ${queryError}`.slice(0,350),
          });
          return;
        }

        // Deduplicate the Google page and persist all Places in a single transaction.
        const normalized = [...new Map(rawPlaces.map(raw=>{
          const place=normalizePlace(raw,area.city,area.state);
          return [place.place_id,place] as const;
        })).values()];
        const createdPlaces = await db.upsertPlacesBatch(normalized);
        const newPlacesFound = createdPlaces.size;
        let newWithoutWebsite = 0;
        let newLeadsCreated = 0;
        let matchingFilters = 0;
        const searchResults: Array<Record<string,unknown> & {id?:string}> = [];

        for (const normalizedPlace of normalized) {

          if ((!normalizedPlace.website || normalizedPlace.website.trim() === '') && normalizedPlace.website_status === 'no_website') {
            newWithoutWebsite++;
          }

          // Aplica filtros comerciais e relevância de nicho para criação do Lead
          const isRelevant = isPlaceRelevantToNiche(normalizedPlace, job.niche);
          const matchesFilters = checkLeadFilters(normalizedPlace, job.filters);
          if (matchesFilters && isRelevant) {
            matchingFilters++;
            const { score } = calculateLeadScore(normalizedPlace, settings.scoringWeights);
            const workspaceId = job.workspace_id || (job.freelancer_id ? job.freelancer_id : 'admin');
            const leadPrefix = job.freelancer_id ? `lead_${job.freelancer_id}_` : 'lead_admin_';
            const leadId = `${leadPrefix}${normalizedPlace.place_id}`;

            // Se o lead foi excluído e está tombstoned, não recria
            if (await db.isLeadDeleted(leadId)) {
              searchResults.push({
                job_id: jobId, workspace_id: workspaceId, place_id: normalizedPlace.place_id,
                result: 'deleted', rating: normalizedPlace.rating || 0,
                reviews_count: normalizedPlace.reviews_count || 0,
                website: normalizedPlace.website || '', website_status: normalizedPlace.website_status,
                phone: normalizedPlace.phone || '', created_at: new Date().toISOString(),
              });
              continue;
            }

            const { lead: persistedLead, created, isDeleted } = await db.createLead({
              id: leadId,
              workspace_id: workspaceId,
              user_id: job.user_id,
              freelancer_id: job.freelancer_id,
              freelancer_name: job.freelancer_name,
              place_id: normalizedPlace.place_id,
              name: normalizedPlace.name,
              niche: job.niche,
              state: normalizedPlace.state,
              city: normalizedPlace.city,
              address: normalizedPlace.formatted_address,
              phone: normalizedPlace.phone,
              website: normalizedPlace.website,
              website_status: normalizedPlace.website_status,
              maps_url: normalizedPlace.maps_url,
              rating: normalizedPlace.rating || 0,
              reviews_count: normalizedPlace.reviews_count || 0,
              lead_score: score,
              pipeline_status: 'NOVO',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

            if (isDeleted) {
              continue;
            }

            searchResults.push({
              job_id: jobId, workspace_id: workspaceId, place_id: normalizedPlace.place_id,
              lead_id: persistedLead.id, result: created ? 'created' : 'duplicate',
              rating: normalizedPlace.rating || 0, reviews_count: normalizedPlace.reviews_count || 0,
              website: normalizedPlace.website || '', website_status: normalizedPlace.website_status,
              phone: normalizedPlace.phone || '', created_at: new Date().toISOString(),
            });

            if (created) {
              newLeadsCreated++;
              persistedLeadCount++;
            }

            if (targetGoal > 0 && persistedLeadCount >= targetGoal) {
              break;
            }
          } else {
            const reason = !isRelevant ? 'niche'
              : job.filters.onlyWithoutWebsite && normalizedPlace.website_status !== 'no_website' ? 'website'
              : !matchesRatingRange(normalizedPlace.rating,job.filters) ? 'rating'
              : job.filters.onlyWithPhone && (!normalizedPlace.phone || normalizedPlace.phone.trim().length<8) ? 'phone'
              : 'reviews';
            searchResults.push({
              job_id: jobId, workspace_id: job.workspace_id || job.freelancer_id || 'admin',
              place_id: normalizedPlace.place_id, result: isRelevant ? 'filtered' : 'irrelevant',
              filter_reason: reason,
              rating: normalizedPlace.rating || 0, reviews_count: normalizedPlace.reviews_count || 0,
              website: normalizedPlace.website || '', website_status: normalizedPlace.website_status,
              phone: normalizedPlace.phone || '', created_at: new Date().toISOString(),
            });
          }
        }

        await db.logSearchResultsBatch(searchResults);

        citiesSeen.add(area.city);

        const committed = await db.completeSearchArea(jobId,area.id,leaseToken,{
          newPlaces:newPlacesFound,withoutSite:newWithoutWebsite,
          newLeads:newLeadsCreated,matchingFilters,placesInArea:rawPlaces.length,
        });
        if (!committed) return;

        // Se atingiu a meta de leads, conclui a busca imediatamente
        if (targetGoal > 0 && persistedLeadCount >= targetGoal) {
          break;
        }

        // Delay de proteção contra rate limit
        if (maxAreas > 1) {
          const delay = Math.max(300, settings.requestDelayMs || 600);
          await new Promise((r) => setTimeout(r, delay));
        }
      } catch (areaErr) {
        console.warn(`[SearchWorker] Erro ao processar área ${area.id}:`, areaErr);
        await db.updateJobArea(jobId, area.id, {
          status: 'failed',
          error: areaErr instanceof Error ? areaErr.message : String(areaErr),
        });
        // Avança contagem de áreas para o percentual não travar
        const currentJob = await db.getSearchJob(jobId);
        if (currentJob) {
          await db.updateSearchJob(jobId, {
            processed_search_areas: currentJob.processed_search_areas + 1,
            processed_cities: citiesSeen.size,
          });
        }
      }
    }

    // An HTTP slice is NOT the end of the search if any cell remains.
    const remaining = await db.getSearchAreas(jobId);
    const reachedGoal = targetGoal > 0 && persistedLeadCount >= targetGoal;
    if (!reachedGoal && remaining.some(a => a.status === 'pending' || a.status === 'processing')) return;

    // Só concluir se as áreas processadas não falharam. Falhas devem ser visíveis e recuperáveis.
    const finalJob = await db.getSearchJob(jobId);
    if (finalJob && finalJob.status === 'running') {
      const failedAreas = (await db.getSearchAreas(jobId)).filter((a) => a.status === 'failed');
      const goalReached = (finalJob.target_leads || 0) > 0 && finalJob.leads_created >= (finalJob.target_leads || 0);
      await db.updateSearchJob(jobId, failedAreas.length > 0 && !goalReached
        ? { status: 'failed', error_message: `${failedAreas.length} área(s) falharam. Tente novamente para retomar.`, finished_at: new Date().toISOString() }
        : { status: 'completed', finished_at: new Date().toISOString() });
    }

    if (job.freelancer_id) {
      const completedJob = await db.getSearchJob(jobId);
      await db.logActivity({
        freelancer_id: job.freelancer_id,
        freelancer_name: job.freelancer_name,
        action_type: 'search_completed',
        description: `Busca finalizada: "${job.niche} em ${job.city}, ${job.state}" gerou ${completedJob?.leads_created || 0} novos leads`,
        metadata: { jobId, leads_created: completedJob?.leads_created || 0 },
      });
    }
  } catch (fatalErr) {
    console.error(`[SearchWorker] Erro fatal no job ${jobId}:`, fatalErr);
    await db.updateSearchJob(jobId, {
      status: 'failed',
      error_message: fatalErr instanceof Error ? fatalErr.message : String(fatalErr),
      finished_at: new Date().toISOString(),
    });
  } finally {
    await db.releaseSearchJobLease(jobId, leaseToken).catch(() => undefined);
    activeWorkers.delete(jobId);
  }
}

export function checkLeadFilters(
  place: {
    website_status: string;
    website?: string;
    phone?: string;
    rating?: number;
    reviews_count?: number;
  },
  filters: {
    onlyWithoutWebsite: boolean;
    onlyWithPhone: boolean;
    minRating: number;
    maxRating?: number;
    minReviews: number;
    maxReviews?: number;
  }
): boolean {
  if (filters.onlyWithoutWebsite) {
    const hasAnyWebsite = Boolean(place.website && place.website.trim() !== '') || place.website_status !== 'no_website';
    if (hasAnyWebsite) {
      return false;
    }
  }

  if (filters.onlyWithPhone && (!place.phone || place.phone.trim().length < 8)) {
    return false;
  }

  if (!matchesRatingRange(place.rating, filters)) {
    return false;
  }

  const reviews = Number(place.reviews_count || 0);
  if (filters.minReviews > 0 && reviews < filters.minReviews) {
    return false;
  }

  if (filters.maxReviews && filters.maxReviews > 0 && reviews > filters.maxReviews) {
    return false;
  }

  return true;
}

export async function pauseSearchJob(jobId: string): Promise<boolean> {
  const worker = activeWorkers.get(jobId);
  if (worker) {
    worker.paused = true;
    await db.updateSearchJob(jobId, { status: 'paused' });
    return true;
  }
  // Se não estiver em memória mas constar no banco
  await db.updateSearchJob(jobId, { status: 'paused' });
  return true;
}

export async function resumeSearchJob(jobId: string): Promise<boolean> {
  // Reset failed/processing cells in one transaction, preserving all completed
  // cells, qualified leads and the existing workspace's search history.
  return db.prepareSearchJobResume(jobId);
}

export async function cancelSearchJob(jobId: string): Promise<boolean> {
  const worker = activeWorkers.get(jobId);
  if (worker) {
    worker.cancelled = true;
  }
  await db.updateSearchJob(jobId, {
    status: 'cancelled',
    finished_at: new Date().toISOString(),
  });
  activeWorkers.delete(jobId);
  return true;
}

export async function cancelAllSearchWorkers(): Promise<number> {
  let count = 0;
  for (const [jobId, worker] of activeWorkers.entries()) {
    worker.cancelled = true;
    await db.updateSearchJob(jobId, {
      status: 'cancelled',
      finished_at: new Date().toISOString(),
    });
    count++;
  }
  activeWorkers.clear();
  return count;
}

export function isJobWorkerActive(jobId: string): boolean {
  return activeWorkers.has(jobId);
}

export async function cleanupStaleJobs(): Promise<number> {
  let cleaned = 0;
  try {
    const allJobs = await db.getAllSearchJobs();
    const now = Date.now();
    for (const job of allJobs) {
      if (job.status === 'running') {
        // Se não há worker ativo em memória e o job não foi atualizado nos últimos 2 minutos
        const lastUpdated = job.updated_at ? new Date(job.updated_at).getTime() : 0;
        const isStale = (now - lastUpdated) > 120000;
        if (!activeWorkers.has(job.id) && isStale && (job.lease_until || 0) < now) {
          await db.updateSearchJob(job.id, {
            status: 'pending',
            lease_token: '',
            lease_until: 0,
            error_message: undefined,
          });
          cleaned++;
          console.warn(`[SearchWorker] Busca interrompida detectada: ${job.id} (${job.niche})`);
        }
      }
    }
  } catch (err) {
    console.warn('[SearchWorker] Erro ao limpar jobs zumbis:', err);
  }
  return cleaned;
}

