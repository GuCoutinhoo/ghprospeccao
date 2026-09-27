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

export function normalizePlace(raw: GooglePlaceRaw, fallbackCity: string, fallbackState: string): Place {
  const placeId = raw.id || (raw.name ? raw.name.replace('places/', '') : `gen_${Date.now()}_${Math.random().toString(36).substring(7)}`);
  const displayName = raw.displayName?.text || 'Estabelecimento sem nome';
  const address = raw.formattedAddress || 'Endereço não informado';
  const { status: websiteStatus } = hasWebsite(raw.websiteUri);
  const now = new Date().toISOString();

  // Tenta extrair CEP e cidade do endereço formatado brasileiro se possível
  let postalCode: string | undefined;
  const cepMatch = address.match(/\d{5}-\d{3}/);
  if (cepMatch) {
    postalCode = cepMatch[0];
  }

  return {
    id: placeId,
    place_id: placeId,
    name: displayName,
    formatted_address: address,
    city: fallbackCity,
    state: fallbackState,
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

/**
 * Consulta oficial à Google Places API (New) Text Search
 * Endpoint: POST https://places.googleapis.com/v1/places:searchText
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
  }
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

  if (options?.locationBias?.circle) {
    body.locationBias = {
      circle: {
        center: {
          latitude: options.locationBias.circle.center.latitude,
          longitude: options.locationBias.circle.center.longitude,
        },
        radius: options.locationBias.circle.radius,
      },
    };
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
      const errorMessage = errorJson?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      const isQuota = response.status === 429 || errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('resource_exhausted');

      return {
        places: [],
        error: errorMessage,
        isQuotaExceeded: isQuota,
      };
    }

    const data = await response.json() as GooglePlacesSearchResponse;
    return {
      places: data.places || [],
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      places: [],
      error: `Falha na requisição: ${errorMsg}`,
    };
  }
}
