import { db, matchesNicheSemantics } from '../store/db';
import { searchPlacesOfficial, normalizePlace, GooglePlaceRaw } from '../google/places';
import { CITY_COORDINATES, METROPOLITAN_GRIDS, POPULAR_CITIES_BY_STATE, fetchCitiesByState } from '../ibge/ibgeService';
import { calculateLeadScore } from '../scoring/leadScore';
import { SearchArea, SearchJob, SearchQueryLog } from '../../types';

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
    minReviews: number;
    maxReviews?: number;
    targetLeads?: number;
  };
}): Promise<{ job: SearchJob; estimatedQueries: number; totalCities: number; totalAreas: number }> {
  const settings = db.getSettings();
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

  const newJob: SearchJob = {
    id: jobId,
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
    leads_created: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  db.createSearchJob(newJob);
  db.addSearchAreas(areas);

  return {
    job: newJob,
    estimatedQueries: areas.length,
    totalCities: targetCities.length,
    totalAreas: areas.length,
  };
}

export async function runSearchJob(jobId: string) {
  const job = db.getSearchJob(jobId);
  if (!job) return;

  const worker: ActiveWorker = {
    jobId,
    paused: false,
    cancelled: false,
  };
  activeWorkers.set(jobId, worker);

  db.updateSearchJob(jobId, {
    status: 'running',
    started_at: job.started_at || new Date().toISOString(),
  });

  const areas = db.getSearchAreas(jobId);
  const pendingAreas = areas.filter((a) => a.status === 'pending' || a.status === 'failed');
  const settings = db.getSettings();
  const targetGoal = job.target_leads || 0;

  const citiesSeen = new Set<string>();

  for (const area of pendingAreas) {
    try {
      // Checa se já atingiu a meta de leads desejada pelo usuário
      if (targetGoal > 0) {
        const currentJobCheck = db.getSearchJob(jobId);
        if (currentJobCheck && currentJobCheck.leads_created >= targetGoal) {
          break;
        }
      }
      // Checagem de pausa ou cancelamento
      const currentWorker = activeWorkers.get(jobId);
      if (!currentWorker || currentWorker.cancelled) {
        db.updateSearchJob(jobId, { status: 'cancelled' });
        activeWorkers.delete(jobId);
        return;
      }

      if (currentWorker.paused) {
        db.updateSearchJob(jobId, { status: 'paused' });
        return;
      }

      // Marca área como em processamento
      db.updateSearchArea(area.id, {
        status: 'processing',
        attempts: area.attempts + 1,
      });

      const query = `${job.niche} em ${area.city} ${area.state}`;
      const startTime = Date.now();

      let rawPlaces: GooglePlaceRaw[] = [];
      let isQuotaExceeded = false;
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
        isQuotaExceeded = true;
        queryError = res.error;
      } else if (res.error) {
        queryError = res.error;
      } else {
        rawPlaces = res.places;
      }

      const durationMs = Date.now() - startTime;

      // Log da consulta realizada
      db.logSearchQuery({
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

      let newPlacesFound = 0;
      let newWithoutWebsite = 0;
      let newLeadsCreated = 0;

      for (const raw of rawPlaces) {
        const normalizedPlace = normalizePlace(raw, area.city, area.state);
        const { isNew } = db.upsertPlace(normalizedPlace);
        if (isNew) {
          newPlacesFound++;
        }

        if (normalizedPlace.website_status === 'no_website') {
          newWithoutWebsite++;
        }

        // Aplica filtros comerciais e relevância de nicho para criação do Lead
        const isRelevant = isPlaceRelevantToNiche(normalizedPlace, job.niche);
        const matchesFilters = checkLeadFilters(normalizedPlace, job.filters);
        if (matchesFilters && isRelevant) {
          const { score } = calculateLeadScore(normalizedPlace, settings.scoringWeights);
          const leadId = `lead_${job.freelancer_id ? job.freelancer_id + '_' : ''}${normalizedPlace.place_id}`;
          const { created } = db.createLead({
            id: leadId,
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

          // Incrementa leads encontrados no job mesmo se já existia na base de dados
          newLeadsCreated++;

          if (targetGoal > 0) {
            const currentTotal = (job.leads_created || 0) + newLeadsCreated;
            if (currentTotal >= targetGoal) {
              break;
            }
          }
        }
      }

      citiesSeen.add(area.city);

      // Atualiza status da área
      db.updateSearchArea(area.id, {
        status: 'completed',
        places_found: rawPlaces.length,
        processed_at: new Date().toISOString(),
      });

      // Atualiza progresso do Job
      const updatedJob = db.getSearchJob(jobId);
      if (updatedJob) {
        db.updateSearchJob(jobId, {
          processed_search_areas: updatedJob.processed_search_areas + 1,
          processed_cities: citiesSeen.size,
          places_found: updatedJob.places_found + (newPlacesFound || rawPlaces.length),
          places_without_website: updatedJob.places_without_website + newWithoutWebsite,
          leads_created: updatedJob.leads_created + newLeadsCreated,
        });
      }

      // Se atingiu a meta de leads, conclui a busca imediatamente
      if (targetGoal > 0 && updatedJob && (updatedJob.leads_created + newLeadsCreated >= targetGoal)) {
        break;
      }

      // Delay de proteção contra rate limit
      const delay = Math.max(300, settings.requestDelayMs || 600);
      await new Promise((r) => setTimeout(r, delay));
    } catch (areaErr) {
      console.warn(`[SearchWorker] Erro ao processar área ${area.id}:`, areaErr);
      db.updateSearchArea(area.id, {
        status: 'failed',
        error: areaErr instanceof Error ? areaErr.message : String(areaErr),
      });
    }
  }

  // Conclui o Job
  db.updateSearchJob(jobId, {
    status: 'completed',
    finished_at: new Date().toISOString(),
  });

  if (job.freelancer_id) {
    const finalJob = db.getSearchJob(jobId);
    db.logActivity({
      freelancer_id: job.freelancer_id,
      freelancer_name: job.freelancer_name,
      action_type: 'search_completed',
      description: `Busca finalizada: "${job.niche} em ${job.city}, ${job.state}" gerou ${finalJob?.leads_created || 0} novos leads`,
      metadata: { jobId, leads_created: finalJob?.leads_created || 0 },
    });
  }

  activeWorkers.delete(jobId);
}

function checkLeadFilters(
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
    minReviews: number;
    maxReviews?: number;
  }
): boolean {
  if (filters.onlyWithoutWebsite && place.website_status !== 'no_website' && place.website) {
    return false;
  }

  if (filters.onlyWithPhone && (!place.phone || place.phone.trim().length < 8)) {
    return false;
  }

  const rating = Number(place.rating || 0);
  if (filters.minRating > 0 && rating < filters.minRating) {
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

function isPlaceRelevantToNiche(place: { name?: string; raw_types?: string[] }, niche: string): boolean {
  if (!niche || niche.trim() === '') return true;
  const name = (place.name || '').toLowerCase();
  const types = (place.raw_types || []).map((t) => t.toLowerCase());

  // 1. Se o nome ou tipos combinarem semanticamente com o nicho
  if (matchesNicheSemantics(name, niche)) return true;
  if (matchesNicheSemantics(types.join(' '), niche)) return true;

  // 2. Se a busca oficial retornou o estabelecimento pelo textQuery direto (Google Places já ranqueou)
  // e não possui tipos incompatíveis óbvios (ex: cemitério, posto de gasolina para nichos de estética)
  const incompatible = ['gas_station', 'cemetery', 'funeral_home', 'police', 'fire_station'];
  const hasIncompatible = incompatible.some((inc) => types.includes(inc));
  if (hasIncompatible && !matchesNicheSemantics(incompatible.join(' '), niche)) {
    return false;
  }

  return true;
}

export function pauseSearchJob(jobId: string): boolean {
  const worker = activeWorkers.get(jobId);
  if (worker) {
    worker.paused = true;
    db.updateSearchJob(jobId, { status: 'paused' });
    return true;
  }
  // Se não estiver em memória mas constar no banco
  db.updateSearchJob(jobId, { status: 'paused' });
  return true;
}

export function resumeSearchJob(jobId: string): boolean {
  const job = db.getSearchJob(jobId);
  if (!job) return false;

  const worker = activeWorkers.get(jobId);
  if (worker) {
    worker.paused = false;
  }

  // Limpa erro e reseta áreas que falharam para tentar novamente
  db.updateSearchJob(jobId, { status: 'running', error_message: undefined });
  const areas = db.getSearchAreas(jobId);
  for (const a of areas) {
    if (a.status === 'failed' || a.status === 'processing') {
      db.updateSearchArea(a.id, { status: 'pending', error: undefined });
    }
  }

  // Roda em segundo plano
  runSearchJob(jobId).catch(console.error);
  return true;
}

export function cancelSearchJob(jobId: string): boolean {
  const worker = activeWorkers.get(jobId);
  if (worker) {
    worker.cancelled = true;
  }
  db.updateSearchJob(jobId, {
    status: 'cancelled',
    finished_at: new Date().toISOString(),
  });
  activeWorkers.delete(jobId);
  return true;
}
