import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { db } from '../lib/store/db';
import { fetchStates, fetchCitiesByState } from '../lib/ibge/ibgeService';
import {
  createAndPrepareSearchJob,
  runSearchJob,
  pauseSearchJob,
  resumeSearchJob,
  cancelSearchJob,
} from '../lib/search/searchWorker';
import { searchPlacesOfficial } from '../lib/google/places';
import { SUPABASE_MIGRATIONS_SQL } from '../lib/supabase/migrations';

dotenv.config();

const app = express();

app.use(express.json());

// CORS & Headers para produção e Vercel
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-matched-path, x-forwarded-uri');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});


// Middleware assíncrono para garantir sincronização com o Firestore antes de qualquer consulta à API
app.use('/api', async (req, _res, next) => {
  if (req.path === '' || req.path === '/') {
    return next();
  }
  try {
    await db.ensureInitialized();
  } catch (err) {
    console.warn('[Server] Falha ao sincronizar com Firestore:', err);
  }
  next();
});

// --- ROTAS DA API ---

// 0. HEALTH CHECK & SYNC
app.get('/api', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'ProspectaPlaces B2B Engine API',
    time: new Date().toISOString(),
  });
});

app.post('/api/sync', async (_req: Request, res: Response) => {
  try {
    const result = await db.syncFromFirestore();
    const stats = db.getDashboardStats();
    res.json({
      success: true,
      message: 'Sincronização com o Firestore concluída com sucesso!',
      leadsCount: result.leadsCount,
      placesCount: result.placesCount,
      stats,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 1. AUTH (Supabase / Session mock)
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }

  return res.json({
    user: {
      id: 'default_user_1',
      email,
      name: email.split('@')[0],
      role: 'admin',
    },
    token: 'session_token_' + Date.now(),
  });
});

app.get('/api/auth/me', (_req: Request, res: Response) => {
  res.json({
    user: {
      id: 'default_user_1',
      email: 'gustavohcsantos.mm2020@gmail.com',
      name: 'Gustavo Santos',
      role: 'admin',
    },
  });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  res.json({ success: true });
});

// 2. IBGE
app.get('/api/ibge/states', async (_req: Request, res: Response) => {
  try {
    const states = await fetchStates();
    res.json(states);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/ibge/cities', async (req: Request, res: Response) => {
  try {
    const uf = (req.query.uf as string) || 'SP';
    const cities = await fetchCitiesByState(uf);
    res.json(cities);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/ibge/cities/:uf', async (req: Request, res: Response) => {
  try {
    const uf = req.params.uf;
    const cities = await fetchCitiesByState(uf);
    res.json(cities);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 3. DASHBOARD STATS
app.get('/api/dashboard/stats', (_req: Request, res: Response) => {
  try {
    const stats = db.getDashboardStats();
    res.json(stats);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 4. LEADS & NICHES
app.get('/api/niches', (req: Request, res: Response) => {
  try {
    const onlyFavorites = req.query.onlyFavorites === 'true';
    const niches = db.getNichesSummary({ onlyFavorites });
    res.json(niches);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/states-summary', (req: Request, res: Response) => {
  try {
    const onlyFavorites = req.query.onlyFavorites === 'true';
    const niche = req.query.niche as string;
    const states = db.getStatesSummary({ onlyFavorites, niche });
    res.json(states);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/leads', (req: Request, res: Response) => {
  try {
    const {
      state,
      city,
      niche,
      onlyWithoutWebsite,
      onlyWithPhone,
      onlyFavorites,
      minRating,
      minReviews,
      minScore,
      status,
      search,
      sortBy,
      page,
      limit,
    } = req.query;

    const result = db.getLeads({
      state: state as string,
      city: city as string,
      niche: niche as string,
      onlyWithoutWebsite: onlyWithoutWebsite === 'true',
      onlyWithPhone: onlyWithPhone === 'true',
      onlyFavorites: onlyFavorites === 'true',
      minRating: minRating ? Number(minRating) : undefined,
      minReviews: minReviews ? Number(minReviews) : undefined,
      minScore: minScore ? Number(minScore) : undefined,
      status: status as string,
      search: search as string,
      sortBy: sortBy as 'score' | 'reviews' | 'rating' | 'recent',
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });

    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/leads/:id', (req: Request, res: Response) => {
  try {
    const lead = db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }
    const notes = db.getLeadNotes(lead.id);
    const place = db.getPlaceByPlaceId(lead.place_id);
    res.json({ lead, notes, place });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.patch('/api/leads/:id', (req: Request, res: Response) => {
  try {
    const updated = db.updateLead(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/leads/:id/favorite', (req: Request, res: Response) => {
  try {
    const updated = db.toggleFavoriteLead(req.params.id);
    if (!updated) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/leads/:id/notes', (req: Request, res: Response) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Conteúdo da observação não pode ser vazio.' });
    }
    const note = db.addLeadNote(req.params.id, 'default_user_1', content.trim());
    res.json(note);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 5. PIPELINE
app.get('/api/pipeline', (_req: Request, res: Response) => {
  try {
    const board = db.getPipelineBoard();
    res.json(board);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/pipeline/move', (req: Request, res: Response) => {
  try {
    const { leadId, toStatus } = req.body;
    if (!leadId || !toStatus) {
      return res.status(400).json({ error: 'leadId e toStatus são obrigatórios.' });
    }

    const updates: Record<string, unknown> = { pipeline_status: toStatus };
    if (toStatus === 'CONTATADO') {
      updates.contacted_at = new Date().toISOString();
    }

    const updated = db.updateLead(leadId, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 6. SEARCH JOBS
app.get('/api/search-jobs', (_req: Request, res: Response) => {
  try {
    const jobs = db.getAllSearchJobs();
    res.json(jobs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/search-jobs', async (req: Request, res: Response) => {
  try {
    const { state, city, niche, filters } = req.body;
    if (!state || !city || !niche) {
      return res.status(400).json({ error: 'Estado, cidade e nicho são obrigatórios.' });
    }

    const cleanFilters: {
      onlyWithoutWebsite: boolean;
      onlyWithPhone: boolean;
      minRating: number;
      minReviews: number;
      maxReviews?: number;
    } = {
      onlyWithoutWebsite: filters?.onlyWithoutWebsite ?? true,
      onlyWithPhone: filters?.onlyWithPhone ?? false,
      minRating: Number(filters?.minRating ?? 0),
      minReviews: Number(filters?.minReviews ?? 0),
    };
    if (filters?.maxReviews !== undefined && filters?.maxReviews !== null && filters?.maxReviews !== '') {
      cleanFilters.maxReviews = Number(filters.maxReviews);
    }

    const { job, estimatedQueries, totalCities, totalAreas } = await createAndPrepareSearchJob({
      userId: 'default_user_1',
      state,
      city,
      niche,
      filters: cleanFilters,
    });

    // Inicia worker em segundo plano
    runSearchJob(job.id).catch(console.error);

    res.json({ job, estimatedQueries, totalCities, totalAreas });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/search-jobs/:id', (req: Request, res: Response) => {
  try {
    const job = db.getSearchJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Search Job não encontrado.' });
    }
    const areas = db.getSearchAreas(job.id);
    const queries = db.getSearchQueries(job.id);
    res.json({ job, areas, queries });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/search-jobs/:id/pause', (req: Request, res: Response) => {
  try {
    const ok = pauseSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/search-jobs/:id/resume', (req: Request, res: Response) => {
  try {
    const ok = resumeSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/search-jobs/:id/cancel', (req: Request, res: Response) => {
  try {
    const ok = cancelSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 7. SETTINGS & TEST KEY
app.get('/api/settings', (_req: Request, res: Response) => {
  try {
    const settings = db.getSettings();
    // Mascara a chave por segurança se existir
    const maskedKey = settings.googleMapsApiKey
      ? `${settings.googleMapsApiKey.substring(0, 6)}...${settings.googleMapsApiKey.substring(settings.googleMapsApiKey.length - 4)}`
      : '';
    res.json({
      ...settings,
      maskedKey,
      googleMapsApiKey: settings.googleMapsApiKey ? '••••••••••••••••••••••••••••••••' : '',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/settings', (req: Request, res: Response) => {
  try {
    const updates = req.body;
    // Se enviou apenas a máscara, não altera a chave original
    if (updates.googleMapsApiKey && updates.googleMapsApiKey.includes('••••')) {
      delete updates.googleMapsApiKey;
    }
    const updated = db.updateSettings(updates);
    res.json({ success: true, settings: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/settings/test-key', async (req: Request, res: Response) => {
  try {
    let keyToTest = req.body.key;
    if (!keyToTest || keyToTest.includes('••••')) {
      keyToTest = db.getSettings().googleMapsApiKey;
    }

    if (!keyToTest || keyToTest.trim() === '') {
      return res.status(400).json({ valid: false, error: 'Chave de API não informada.' });
    }

    // Faz teste real com query simples
    const testRes = await searchPlacesOfficial('Barbearia em São Paulo SP', keyToTest, { maxResultCount: 1 });
    if (testRes.error) {
      return res.json({ valid: false, error: testRes.error });
    }

    res.json({
      valid: true,
      placesFound: testRes.places.length,
      samplePlace: testRes.places[0]?.displayName?.text || 'Sucesso na comunicação!',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ valid: false, error: message });
  }
});

// 8. SUPABASE MIGRATIONS
app.get('/api/supabase/migrations', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(SUPABASE_MIGRATIONS_SQL);
});

export { app };
export default app;
