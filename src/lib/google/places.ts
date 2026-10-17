import { Place, WebsiteStatus } from '../../types';

// Oficial Google Places API (New) FieldMask
export const OFFICIAL_PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.location',
  'places.primaryType',
  'places.types',
  'places.googleMapsUri',
  'places.businessStatus',
].join(',');

export interface GooglePlaceRaw {
  id?: string;
  name?: string; // Resource name format: places/ChIJ...
  displayName?: {
    text?: string;
    languageCode?: string;
  };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  primaryType?: string;
  types?: string[];
  googleMapsUri?: string;
  businessStatus?: string;
}

export interface GooglePlacesSearchResponse {
  places?: GooglePlaceRaw[];
  nextPageToken?: string;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

const SOCIAL_MEDIA_DOMAINS = [
  'instagram.com',
  'facebook.com',
  'fb.com',
  'wa.me',
  'whatsapp.com',
  'linktr.ee',
  'linktree.com',
  'tiktok.com',
  'google.com',
  'goo.gl',
  'bio.site',
  'beacons.ai',
];

export function hasWebsite(rawWebsiteUri?: string | null): { hasWebsite: boolean; status: WebsiteStatus } {
  if (!rawWebsiteUri || rawWebsiteUri.trim() === '') {
    return { hasWebsite: false, status: 'no_website' };
  }

  const trimmed = rawWebsiteUri.trim().toLowerCase();
  
  // Validar se é uma URL válida
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (url.hostname.length < 3 || !url.hostname.includes('.')) {
      return { hasWebsite: false, status: 'invalid_website' };
    }

    return { hasWebsite: true, status: 'website_found' };
  } catch {
    return { hasWebsite: false, status: 'invalid_website' };
  }
}

export function extractCityAndStateFromAddress(address?: string): { city?: string; state?: string } {
  if (!address) return {};
  const matchHyphen = address.match(/,\s*([A-Za-zÀ-ÿ\s.'-]+?)\s*-\s*([A-Z]{2})\b/);
  if (matchHyphen) {
    const rawCity = matchHyphen[1].trim();
    const rawUf = matchHyphen[2].trim();
    if (rawCity.length >= 2 && rawCity.length <= 40) {
      return { city: rawCity, state: rawUf };
    }
  }
  const matchComma = address.match(/,\s*([A-Za-zÀ-ÿ\s.'-]+?),\s*([A-Z]{2})\b/);
  if (matchComma) {
    const rawCity = matchComma[1].trim();
    const rawUf = matchComma[2].trim();
    if (rawCity.length >= 2 && rawCity.length <= 40) {
      return { city: rawCity, state: rawUf };
    }
  }
  return {};
}

export function normalizePlace(raw: GooglePlaceRaw, fallbackCity: string, fallbackState: string): Place {
  const placeId = raw.id || (raw.name ? raw.name.replace('places/', '') : `gen_${Date.now()}_${Math.random().toString(36).substring(7)}`);
  const displayName = raw.displayName?.text || 'Estabelecimento sem nome';
  const address = raw.formattedAddress || 'Endereço não informado';
  const { status: websiteStatus } = hasWebsite(raw.websiteUri);
  const now = new Date().toISOString();

  // Extrai CEP e cidade/UF real do endereço retornado pelo Google
  let postalCode: string | undefined;
  const cepMatch = address.match(/\d{5}-\d{3}/);
  if (cepMatch) {
    postalCode = cepMatch[0];
  }

  const extracted = extractCityAndStateFromAddress(address);
  const resolvedCity = (fallbackCity && fallbackCity !== 'all') ? fallbackCity : (extracted.city || fallbackCity);
  const resolvedState = extracted.state || fallbackState;

  return {
    id: placeId,
    place_id: placeId,
    name: displayName,
    formatted_address: address,
    city: resolvedCity,
    state: resolvedState,
    postal_code: postalCode,
    lat: raw.location?.latitude ?? 0,
    lng: raw.location?.longitude ?? 0,
    phone: raw.nationalPhoneNumber || undefined,
    website: raw.websiteUri || undefined,
    website_status: websiteStatus,
    rating: raw.rating ?? 0,
    reviews_count: raw.userRatingCount ?? 0,
    maps_url: raw.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${displayName} ${address}`)}`,
    business_status: raw.businessStatus || 'OPERATIONAL',
    raw_types: raw.types || (raw.primaryType ? [raw.primaryType] : []),
    created_at: now,
    updated_at: now,
    last_fetched_at: now,
  };
}

const NICHE_TO_PLACE_TYPES: Record<string, string[]> = {
  barbearia: ['barber_shop', 'hair_salon'],
  salao: ['beauty_salon', 'hair_salon'],
  dentista: ['dentist', 'dental_clinic'],
  odonto: ['dentist', 'dental_clinic'],
  restaurante: ['restaurant'],
  pizzaria: ['restaurant', 'meal_delivery'],
  academia: ['gym', 'fitness_center'],
  estetica: ['beauty_salon', 'spa'],
  advogado: ['lawyer'],
  oficina: ['car_repair'],
  mecanica: ['car_repair'],
  imobiliaria: ['real_estate_agency'],
  pet: ['pet_store', 'veterinary_care'],
  contabilidade: ['accounting'],
  eletricista: ['electrician'],
  solar: ['point_of_interest'],
  fotografo: ['point_of_interest'],
};

export function getIncludedTypesForQuery(query: string): string[] | undefined {
  const norm = query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  for (const [key, types] of Object.entries(NICHE_TO_PLACE_TYPES)) {
    if (norm.includes(key)) {
      return types;
    }
  }
  return undefined;
}

/**
 * Consulta alternativa via searchNearby quando a cota de searchText estiver esgotada
 */
export async function searchPlacesNearby(
  apiKey: string,
  center: { latitude: number; longitude: number },
  radius: number,
  includedTypes?: string[],
  rankPreference: 'POPULARITY' | 'DISTANCE' = 'POPULARITY',
): Promise<{ places: GooglePlaceRaw[]; error?: string }> {
  const endpoint = 'https://places.googleapis.com/v1/places:searchNearby';
  const body: Record<string, unknown> = {
    locationRestriction: {
      circle: {
        center,
        radius: Math.max(1000, Math.min(radius || 8000, 50000)),
      },
    },
    maxResultCount: 20,
    rankPreference,
  };

  if (includedTypes && includedTypes.length > 0) {
    body.includedTypes = includedTypes;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': OFFICIAL_PLACES_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => null);
      return {
        places: [],
        error: errorJson?.error?.message || `HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as GooglePlacesSearchResponse;
    return { places: data.places || [] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { places: [], error: msg };
  }
}

/**
 * Smart geo search: for typed niches and actual grid coordinates, Nearby is
 * more precise and avoids repeating a Text Search biased to adjacent grids.
 * The Google response is still validated by the exact business filters.
 * Text search remains the fallback when the niche has no reliable place types,
 * coordinates are missing, or Nearby reports a transport/API error.
 */
export async function searchPlacesAdaptive(
  query: string,
  apiKey: string,
  options?: Parameters<typeof searchPlacesOfficial>[2],
): Promise<{ places: GooglePlaceRaw[]; error?: string; isQuotaExceeded?: boolean; source: 'nearby' | 'text' }> {
  const circle = options?.locationBias?.circle;
  const center = circle?.center;
  const types = getIncludedTypesForQuery(query);
  const validCoordinates = center && Number.isFinite(center.latitude) &&
    Number.isFinite(center.longitude) && center.latitude !== 0 && center.longitude !== 0;
  if (apiKey?.trim() && validCoordinates && types?.length) {
    const nearby = await searchPlacesNearby(apiKey, center, circle?.radius || 12000, types, 'DISTANCE');
    // A valid, empty geographic response is not an API error. Do not double
    // bill/consume quota by automatically repeating it as a text search.
    if (!nearby.error) return { places: nearby.places, source: 'nearby' };
    // Errors are not empty results. Try the text endpoint at most once, so
    // either quota can be used when the other endpoint is unavailable.
    const textResult = await searchPlacesOfficial(query, apiKey, options, 1, false);
    return { ...textResult, source: 'text' };
  }
  return { ...await searchPlacesOfficial(query, apiKey, options), source: 'text' };
}

/**
 * Consulta oficial à Google Places API (New) com fallback automático para searchNearby
 * Garante que a busca NUNCA trave por limite de cota temporário do endpoint searchText
 */
export async function searchPlacesOfficial(
  query: string,
  apiKey: string,
  options?: {
    locationBias?: {
      circle?: {
        center: { latitude: number; longitude: number };
        radius: number;
      };
    };
    maxResultCount?: number;
  },
  maxRetries = 2,
  allowNearbyFallback = true,
): Promise<{ places: GooglePlaceRaw[]; error?: string; isQuotaExceeded?: boolean }> {
  if (!apiKey || apiKey.trim() === '') {
    return { places: [], error: 'GOOGLE_MAPS_API_KEY_MISSING' };
  }

  const endpoint = 'https://places.googleapis.com/v1/places:searchText';

  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: 'pt-BR',
    maxResultCount: Math.min(options?.maxResultCount || 20, 20),
  };

  const centerLat = options?.locationBias?.circle?.center?.latitude;
  const centerLng = options?.locationBias?.circle?.center?.longitude;
  const hasValidCenter = typeof centerLat === 'number' && typeof centerLng === 'number' && centerLat !== 0 && centerLng !== 0;

  if (options?.locationBias?.circle && hasValidCenter) {
    body.locationBias = {
      circle: {
        center: {
          latitude: centerLat,
          longitude: centerLng,
        },
        radius: options.locationBias.circle.radius || 12000,
      },
    };
  }

  let lastError: string | undefined;
  const typesForNearby = getIncludedTypesForQuery(query) || [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': OFFICIAL_PLACES_FIELD_MASK,
        },
        body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        const errorMessage = errorJson?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
        lastError = errorMessage;
        const quotaExceeded = response.status === 429 ||
          /quota|resource_exhausted/i.test(errorMessage);

        // If Search Text daily quota is exhausted, try Nearby at most once.
        // Never make 2 or 3 more Search Text calls that cannot succeed today.
        if (quotaExceeded) {
          if (allowNearbyFallback && hasValidCenter && typesForNearby.length && options?.locationBias?.circle?.center) {
            const nearbyRes = await searchPlacesNearby(
              apiKey,
              options.locationBias.circle.center,
              options.locationBias.circle.radius || 12000,
              getIncludedTypesForQuery(query),
            );
            if (nearbyRes.places.length > 0) return {places:nearbyRes.places};
          }
          return {places:[],error:errorMessage,isQuotaExceeded:true};
        }

        const isTemporary = response.status === 503 || response.status === 500;
        if (isTemporary && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        break;
      }

      const data = (await response.json()) as GooglePlacesSearchResponse;
      if (data.places && data.places.length > 0) {
        return { places: data.places };
      }

      // Empty Text Search is authoritative. Never perform an untyped Nearby
      // search, which could add unrelated businesses and consume quota.
      return { places: [] };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // Fallback final: somente se houver coordenadas válidas reais
  if (allowNearbyFallback && hasValidCenter && typesForNearby.length && options?.locationBias?.circle?.center) {
    try {
      const types = getIncludedTypesForQuery(query);
      const nearbyRes = await searchPlacesNearby(apiKey, options.locationBias.circle.center, options.locationBias.circle.radius || 12000, types);
      if (nearbyRes.places && nearbyRes.places.length > 0) {
        return { places: nearbyRes.places };
      }
    } catch {
      // ignore
    }
  }

  return { places: [], error: lastError };
}
