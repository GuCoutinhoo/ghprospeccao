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

    // Se for rede social ou link de WhatsApp/Linktree, a empresa NÃO tem site institucional próprio
    const isSocial = SOCIAL_MEDIA_DOMAINS.some((domain) => url.hostname.includes(domain));
    if (isSocial) {
      return { hasWebsite: false, status: 'no_website' };
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
  includedTypes?: string[]
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
  maxRetries = 2
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
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        const errorMessage = errorJson?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
        lastError = errorMessage;

        // Se for limite de cota do SearchTextRequest (429 / RESOURCE_EXHAUSTED) e houver coordenadas reais
        if (hasValidCenter && (response.status === 429 || errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('resource_exhausted'))) {
          console.warn('[Places] Cota de SearchTextRequest atingida, alternando para searchNearby...');
          const center = options?.locationBias?.circle?.center;
          if (center) {
            const types = getIncludedTypesForQuery(query);
            const nearbyRes = await searchPlacesNearby(apiKey, center, options?.locationBias?.circle?.radius || 12000, types);
            if (nearbyRes.places && nearbyRes.places.length > 0) {
              return { places: nearbyRes.places };
            }
          }
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

      // Se searchText não retornou resultados e temos coordenadas válidas
      if (hasValidCenter && options?.locationBias?.circle?.center) {
        const types = getIncludedTypesForQuery(query);
        const nearbyRes = await searchPlacesNearby(apiKey, options.locationBias.circle.center, options.locationBias.circle.radius || 12000, types);
        if (nearbyRes.places && nearbyRes.places.length > 0) {
          return { places: nearbyRes.places };
        }
      }

      return { places: [] };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // Fallback final: somente se houver coordenadas válidas reais
  if (hasValidCenter && options?.locationBias?.circle?.center) {
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
