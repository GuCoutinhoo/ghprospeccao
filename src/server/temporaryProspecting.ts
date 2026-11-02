import { Router } from 'express';
import crypto from 'node:crypto';
import { hasWebsite, OFFICIAL_PLACES_FIELD_MASK, type GooglePlaceRaw, type GooglePlacesSearchResponse } from '../lib/google/places';

/**
 * Emergency, isolated prospecting service. No access to db, store or Supabase.
 * The only source of leads is Google Places; the browser stores them under a
 * separate key. Never reuse this route as a substitute for freelancer auth.
 */
export const temporaryProspectingRouter = Router();
const attempts = new Map<string, { count: number; reset: number }>();
const recentQueries = new Map<string, number>();
const VALID_STATES = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));

function safeEqual(value: string, expected: string): boolean {
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(value).digest(),
    crypto.createHash('sha256').update(expected).digest(),
  );
}

function signTempToken(): string {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || '';
  if (secret.length < 32) throw new Error('O servidor não possui segredo de sessão seguro.');
  const data = Buffer.from(JSON.stringify({ purpose: 'temporary-test-prospect', exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret + ':temporary-test-prospect').update(data).digest('base64url');
  return data + '.' + signature;
}

function validateTempToken(token: string): boolean {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || '';
  if (secret.length < 32 || token.length > 2000 || !token.includes('.')) return false;
  const pieces = token.split('.');
  if (pieces.length !== 2) return false;
  const [data, signature] = pieces;
  const expected = crypto.createHmac('sha256', secret + ':temporary-test-prospect').update(data).digest('base64url');
  if (!safeEqual(signature, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return payload?.purpose === 'temporary-test-prospect' && Number.isFinite(payload.exp) && payload.exp > Date.now();
  } catch { return false; }
}

temporaryProspectingRouter.post('/login', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  const now = Date.now();
  for (const [key, item] of attempts) if (item.reset < now) attempts.delete(key);
  const current = attempts.get(ip) || { count: 0, reset: now + 15 * 60_000 };
  if (current.count >= 8) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.' });
  const adminEmail = process.env.ADMIN_EMAIL || '';
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!adminEmail || !adminPassword || !email || password.length > 500 ||
      !safeEqual(email, adminEmail.trim().toLowerCase()) || !safeEqual(password, adminPassword)) {
    attempts.set(ip, { count: current.count + 1, reset: current.reset });
    return res.status(401).json({ error: 'Credenciais administrativas inválidas.' });
  }
  attempts.delete(ip);
  try { return res.json({ token: signTempToken() }); }
  catch { return res.status(503).json({ error: 'Login temporário indisponível nesta configuração.' }); }
});

temporaryProspectingRouter.post('/search', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const token = String(req.headers['x-temporary-token'] || '');
  if (!validateTempToken(token)) return res.status(401).json({ error: 'Sessão temporária expirada. Faça login novamente.' });
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
  const now = Date.now();
  if (recentQueries.size > 2000) recentQueries.clear();
  const queryId = crypto.createHash('sha256').update(token).digest('hex');
  const last = recentQueries.get(queryId) || 0;
  if (now - last < 2500) return res.status(429).json({ error: 'Aguarde alguns segundos antes de pesquisar novamente.' });
  recentQueries.set(queryId, now);

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
