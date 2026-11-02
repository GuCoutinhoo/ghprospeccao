import { Router } from 'express';
import crypto from 'node:crypto';
import { hasWebsite, OFFICIAL_PLACES_FIELD_MASK, type GooglePlaceRaw, type GooglePlacesSearchResponse } from '../lib/google/places';

/**
 * Emergency, isolated prospecting service. No access to db, store or Supabase.
 * The only source of leads is Google Places; the browser stores them under a
 * separate key. Never reuse this route as a substitute for freelancer auth.
 */
export const temporaryProspectingRouter = Router();
// Best-effort per-client throttle: independent of the Supabase database.
// Google Cloud billing quotas should also be configured because serverless
// instances do not share in-memory counters.
const recentQueries = new Map<string, { last: number; count: number; day: string }>();
const VALID_STATES = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));

temporaryProspectingRouter.post('/search', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // This mode is intentionally accessible without an account only for the
  // isolated TEST workflow. Never remove auth checks from the real API.
  const origin = req.get('origin');
  const requestHost = req.get('host');
  const fetchSite = req.get('sec-fetch-site');
  if (!origin || !requestHost || !/^https?:\/\//.test(origin) ||
      new URL(origin).host !== requestHost ||
      (fetchSite && fetchSite !== 'same-origin')) {
    return res.status(403).json({ error: 'Pesquisa disponível apenas dentro do GH Prospecção.' });
  }
  const now = Date.now();
  if (recentQueries.size > 1500) recentQueries.clear();
  const clientId = crypto.createHash('sha256').update(
    String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0] +
    ':' + String(req.headers['user-agent'] || '')
  ).digest('hex');
  const day = new Date(now).toISOString().slice(0, 10);
  const usage = recentQueries.get(clientId) || { last: 0, count: 0, day };
  if (usage.day !== day) { usage.day = day; usage.count = 0; usage.last = 0; }
  if (usage.count >= 40) return res.status(429).json({ error: 'Limite preventivo de buscas deste navegador atingido. Volte amanhã.' });
  if (now - usage.last < 2500) return res.status(429).json({ error: 'Aguarde alguns segundos antes da próxima consulta.' });
  const state = String(req.body?.state || '').trim().toUpperCase();
  const city = String(req.body?.city || '').trim();
  const niche = String(req.body?.niche || '').trim();
  const pageToken = String(req.body?.pageToken || '').trim();
  if (!VALID_STATES.has(state) || city.length < 2 || city.length > 75 || niche.length < 2 || niche.length > 75 ||
      pageToken.length > 1500 || /[<>]/.test(city + niche)) {
    return res.status(400).json({ error: 'Informe UF, cidade e nicho válidos.' });
  }
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || '';
  if (!key) return res.status(503).json({ error: 'Chave Google Places não configurada no servidor.' });
  // Count only valid search requests before charging Google Places.
  recentQueries.set(clientId, { last: now, count: usage.count + 1, day });

  const query: Record<string, unknown> = {
    textQuery: niche + ' em ' + city + ', ' + state + ', Brasil',
    languageCode: 'pt-BR',
    regionCode: 'BR',
    pageSize: 20,
  };
  if (pageToken) query.pageToken = pageToken;
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': OFFICIAL_PLACES_FIELD_MASK + ',nextPageToken',
      },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(18000),
    });
    const result = (await response.json().catch(() => ({}))) as GooglePlacesSearchResponse;
    if (!response.ok) {
      const error = response.status === 429 ? 'Limite de consultas do Google Places atingido.' :
        result.error?.message || 'Falha na consulta ao Google Places.';
      return res.status(response.status === 429 ? 429 : 502).json({ error });
    }
    const opts = req.body?.filters || {};
    const minRating = Number(opts.minRating) || 0;
    const maxRating = opts.maxRating === '' || opts.maxRating == null ? 5 : Number(opts.maxRating);
    const maxReviews = opts.maxReviews === '' || opts.maxReviews == null ? Infinity : Number(opts.maxReviews);
    const minReviews = Number(opts.minReviews) || 0;
    if (![minRating, maxRating, minReviews].every(Number.isFinite) || minRating < 0 || maxRating > 5 ||
        maxRating < minRating || minReviews < 0 || minReviews > 100000 || maxReviews < minReviews) {
      return res.status(400).json({ error: 'Filtros inválidos.' });
    }
    const places = (result.places || []).filter((place: GooglePlaceRaw) => {
      const website = hasWebsite(place.websiteUri).hasWebsite;
      const rating = place.rating ?? 0;
      const reviews = place.userRatingCount ?? 0;
      return (!opts.onlyWithoutWebsite || !website) &&
        (!opts.onlyWithPhone || Boolean(place.nationalPhoneNumber)) &&
        rating >= minRating && rating <= maxRating &&
        reviews >= minReviews && reviews <= maxReviews &&
        place.businessStatus !== 'CLOSED_PERMANENTLY';
    }).map((place: GooglePlaceRaw) => ({
      id: place.id || '',
      name: place.displayName?.text || 'Estabelecimento',
      city,
      state,
      niche,
      address: place.formattedAddress || '',
      phone: place.nationalPhoneNumber || '',
      website: place.websiteUri || '',
      rating: place.rating ?? 0,
      reviews: place.userRatingCount ?? 0,
      mapsUrl: place.googleMapsUri || '',
      capturedAt: new Date().toISOString(),
    })).filter(place => place.id.length > 0);
    return res.json({ leads: places, nextPageToken: result.nextPageToken || null, scanned: (result.places || []).length });
  } catch (err) {
    const message = err instanceof Error && err.name === 'TimeoutError'
      ? 'O Google demorou a responder. Tente novamente.'
      : 'Não foi possível consultar o Google Places agora.';
    return res.status(502).json({ error: message });
  }
});
