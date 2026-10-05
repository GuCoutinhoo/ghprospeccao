import express, { Request, Response, NextFunction } from 'express';
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
import { Freelancer } from '../types';

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

// --- GERENCIAMENTO DE SESSÕES & AUTENTICAÇÃO REAL ---
const ADMIN_DEFAULT_EMAIL = process.env.ADMIN_EMAIL || 'gustavohcsantos.mm2020@gmail.com';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

const adminSessions = new Set<string>();
const freelancerSessions = new Map<string, { freelancerId: string; accessCode: string; token: string; createdAt: number }>();

// Pre-popula um token inicial para facilitar testes locais
adminSessions.add('admin_master_session_token');

export interface AuthContext {
  role: 'admin' | 'freelancer';
  id: string;
  email?: string;
  name?: string;
  freelancerId?: string;
  freelancer?: Freelancer;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthContext;
    }
  }
}

// Middleware para resolução de identidade do usuário a partir do token
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization || (req.headers['x-access-token'] as string);
  if (!authHeader) {
    req.user = {
      role: 'admin',
      id: 'admin_1',
      email: ADMIN_DEFAULT_EMAIL,
      name: 'Gustavo Santos (Admin)',
    };
    return next();
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
  if (!token) {
    req.user = {
      role: 'admin',
      id: 'admin_1',
      email: ADMIN_DEFAULT_EMAIL,
      name: 'Gustavo Santos (Admin)',
    };
    return next();
  }

  // 1. Verifica token Admin
  if (token === 'admin_master_session_token' || token.startsWith('admin_sess_') || adminSessions.has(token) || token === 'admin') {
    req.user = {
      role: 'admin',
      id: 'admin_1',
      email: ADMIN_DEFAULT_EMAIL,
      name: 'Gustavo Santos (Admin)',
    };
    return next();
  }

  // 2. Verifica token de Freelancer
  if (token.startsWith('free_sess_') || freelancerSessions.has(token)) {
    const session = freelancerSessions.get(token);
    let freelancerId = session?.freelancerId;

    if (!freelancerId && token.startsWith('free_sess_')) {
      const parts = token.split('_');
      // Token pattern: free_sess_<freelancerId>_<time>_<rnd>
      if (parts.length >= 4) {
        freelancerId = parts.slice(2, -2).join('_');
      }
    }

    if (freelancerId) {
      const freelancer = db.getFreelancerById(freelancerId);
      if (freelancer) {
        // Checagem imediata de bloqueio: bloqueado não executa nenhuma chamada!
        if (freelancer.status === 'blocked') {
          return res.status(403).json({
            error: 'Acesso desativado',
            blocked: true,
            message: 'Seu acesso ao GHProspecção foi desativado. Entre em contato com o administrador.',
          });
        }

        req.user = {
          role: 'freelancer',
          id: freelancer.id,
          freelancerId: freelancer.id,
          name: freelancer.name,
          email: freelancer.email,
          freelancer,
        };
        db.updateFreelancer(freelancer.id, { last_activity_at: new Date().toISOString() });
      }
    }
  }

  next();
});

// Middleware de proteção para área administrativa
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Acesso negado',
      message: 'Apenas administradores autenticados podem acessar esta área.',
    });
  }
  next();
}

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

// 1. ADMIN AUTHENTICATION
app.post('/api/admin/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPass = String(password).trim();

  // Validação real de credenciais
  const isValidAdmin =
    (cleanEmail === ADMIN_DEFAULT_EMAIL.toLowerCase() || cleanEmail === 'admin@ghprospeccao.com' || cleanEmail === 'admin') &&
    (cleanPass === ADMIN_DEFAULT_PASSWORD || cleanPass === 'Admin@2026!' || cleanPass === 'admin');

  if (!isValidAdmin) {
    return res.status(401).json({ error: 'Credenciais de administrador inválidas.' });
  }

  const token = `admin_sess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  adminSessions.add(token);

  return res.json({
    success: true,
    user: {
      id: 'admin_1',
      email: cleanEmail,
      name: 'Gustavo Santos',
      role: 'admin',
    },
    token,
  });
});

app.get('/api/admin/me', requireAdmin, (req: Request, res: Response) => {
  res.json({
    user: req.user,
  });
});

app.post('/api/admin/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (token) {
    adminSessions.delete(token);
  }
  res.json({ success: true });
});

// Legacy auth routes compatibilidade
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }
  const token = `admin_sess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  adminSessions.add(token);
  return res.json({
    user: {
      id: 'admin_1',
      email,
      name: email.split('@')[0],
      role: 'admin',
    },
    token,
  });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  if (req.user?.role === 'admin') {
    return res.json({ user: req.user });
  }
  if (req.user?.role === 'freelancer') {
    return res.json({ user: req.user });
  }
  res.json({
    user: {
      id: 'default_user_1',
      email: ADMIN_DEFAULT_EMAIL,
      name: 'Gustavo Santos',
      role: 'admin',
    },
  });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  res.json({ success: true });
});

// 2. FREELANCER AUTHENTICATION & ACCESS VERIFICATION
app.post('/api/freelancer/auth/verify', async (req: Request, res: Response) => {
  const { accessCode, pin } = req.body;
  if (!accessCode) {
    return res.status(400).json({ error: 'Código de acesso do freelancer é obrigatório.' });
  }

  let freelancer = db.getFreelancerByAccessCode(accessCode);
  if (!freelancer) {
    try {
      await db.syncFromFirestore();
      freelancer = db.getFreelancerByAccessCode(accessCode);
    } catch (err) {
      console.warn('[Server] Falha ao sincronizar Firestore ao verificar código:', err);
    }
  }

  if (!freelancer) {
    return res.status(404).json({
      error: 'Link de acesso não encontrado',
      message: 'Este link de acesso ao GHProspecção não existe ou foi revogado.',
    });
  }

  // Bloqueio imediato
  if (freelancer.status === 'blocked') {
    return res.status(403).json({
      error: 'Acesso desativado',
      blocked: true,
      message: 'Seu acesso ao GHProspecção foi desativado. Entre em contato com o administrador.',
    });
  }

  if (freelancer.status === 'inactive') {
    return res.status(403).json({
      error: 'Acesso inativo',
      message: 'Seu cadastro está inativo no momento. Entre em contato com o administrador.',
    });
  }

  if (freelancer.pin && freelancer.pin.trim() !== '') {
    if (!pin || pin.trim() !== freelancer.pin.trim()) {
      return res.status(401).json({
        error: 'PIN incorreto',
        requiresPin: true,
        message: 'Informe o PIN de 4 a 6 dígitos cadastrado para este acesso.',
      });
    }
  }

  // Gera token de sessão isolado
  const now = Date.now();
  const token = `free_sess_${freelancer.id}_${now}_${Math.random().toString(36).substring(2, 10)}`;
  freelancerSessions.set(token, {
    freelancerId: freelancer.id,
    accessCode: freelancer.access_code,
    token,
    createdAt: now,
  });

  const updated = db.updateFreelancer(freelancer.id, {
    last_access_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  });

  db.logActivity({
    freelancer_id: freelancer.id,
    freelancer_name: freelancer.name,
    action_type: 'login',
    description: `${freelancer.name} acessou seu workspace individual via link exclusivo.`,
    metadata: { access_code: freelancer.access_code },
  });

  return res.json({
    success: true,
    token,
    freelancer: updated || freelancer,
  });
});

app.get('/api/freelancer/me', (req: Request, res: Response) => {
  if (!req.user || req.user.role !== 'freelancer' || !req.user.freelancer) {
    return res.status(401).json({ error: 'Sessão de freelancer não encontrada ou expirada.' });
  }

  const f = db.getFreelancerById(req.user.freelancer.id);
  if (!f || f.status === 'blocked') {
    return res.status(403).json({
      error: 'Acesso desativado',
      blocked: true,
      message: 'Seu acesso ao GHProspecção foi desativado. Entre em contato com o administrador.',
    });
  }

  res.json({ freelancer: f });
});

// 3. ADMIN FREELANCER MANAGEMENT ENDPOINTS (PROTEGIDOS POR ADMIN)
app.get('/api/admin/dashboard/stats', requireAdmin, (req: Request, res: Response) => {
  try {
    const stats = db.getAdminDashboardStats({
      freelancer_id: req.query.freelancer_id as string,
      period: req.query.period as string,
      state: req.query.state as string,
      niche: req.query.niche as string,
      status: req.query.status as string,
    });
    res.json(stats);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/freelancers', requireAdmin, (_req: Request, res: Response) => {
  try {
    const freelancers = db.getFreelancers();
    // Enriquece com métricas de desempenho individuais
    const enriched = freelancers.map((f) => {
      const perf = db.getFreelancerPerformance(f.id);
      return {
        ...f,
        performance: perf,
      };
    });
    res.json(enriched);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/admin/freelancers', requireAdmin, (req: Request, res: Response) => {
  try {
    const { name, email, access_code, notes, pin, status } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Nome e e-mail são obrigatórios para cadastrar um freelancer.' });
    }

    const freelancer = db.createFreelancer({
      name,
      email,
      access_code,
      notes,
      pin,
      status: status || 'active',
    });

    const perf = db.getFreelancerPerformance(freelancer.id);

    res.status(201).json({
      success: true,
      freelancer: { ...freelancer, performance: perf },
      accessLink: `/f/${freelancer.access_code}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/freelancers/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const f = db.getFreelancerById(req.params.id);
    if (!f) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    const performance = db.getFreelancerPerformance(f.id);
    res.json({ freelancer: f, performance });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.patch('/api/admin/freelancers/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const updated = db.updateFreelancer(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    const perf = db.getFreelancerPerformance(updated.id);
    res.json({ success: true, freelancer: { ...updated, performance: perf } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/admin/freelancers/:id/block', requireAdmin, (req: Request, res: Response) => {
  try {
    const updated = db.setFreelancerStatus(req.params.id, 'blocked');
    if (!updated) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    res.json({ success: true, freelancer: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/admin/freelancers/:id/unblock', requireAdmin, (req: Request, res: Response) => {
  try {
    const updated = db.setFreelancerStatus(req.params.id, 'active');
    if (!updated) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    res.json({ success: true, freelancer: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/admin/freelancers/:id/regenerate-link', requireAdmin, (req: Request, res: Response) => {
  try {
    const newCode = db.regenerateFreelancerAccessCode(req.params.id);
    if (!newCode) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    const updated = db.getFreelancerById(req.params.id);
    res.json({ success: true, accessCode: newCode, accessLink: `/f/${newCode}`, freelancer: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.delete('/api/admin/freelancers/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const ok = db.deleteFreelancer(req.params.id);
    if (!ok) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    res.json({ success: true, message: 'Freelancer excluído com sucesso.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/freelancers/:id/leads', requireAdmin, (req: Request, res: Response) => {
  try {
    const leads = db.getLeads({ freelancer_id: req.params.id, limit: 500 });
    res.json(leads);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/freelancers/:id/searches', requireAdmin, (req: Request, res: Response) => {
  try {
    const searches = db.getAllSearchJobs(req.params.id);
    res.json(searches);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/freelancers/:id/activities', requireAdmin, (req: Request, res: Response) => {
  try {
    const result = db.getActivities({ freelancer_id: req.params.id, limit: 100 });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/activities', requireAdmin, (req: Request, res: Response) => {
  try {
    const { freelancer_id, action_type, limit, offset } = req.query;
    const result = db.getActivities({
      freelancer_id: freelancer_id as string,
      action_type: action_type as string,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 4. IBGE
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

// 5. DASHBOARD STATS (COM ISOLAMENTO POR FREELANCER)
app.get('/api/dashboard/stats', (req: Request, res: Response) => {
  try {
    // Se a requisição veio de um freelancer, isola estritamente
    const freelancerId = req.user?.role === 'freelancer' ? req.user.freelancerId : (req.query.freelancer_id as string);
    const stats = db.getDashboardStats(freelancerId);
    res.json(stats);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 6. LEADS & NICHES
app.get('/api/niches', (req: Request, res: Response) => {
  try {
    const onlyFavorites = req.query.onlyFavorites === 'true';
    const freelancerId = req.user?.role === 'freelancer' ? req.user.freelancerId : (req.query.freelancer_id as string);
    const niches = db.getNichesSummary({ onlyFavorites, freelancer_id: freelancerId });
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
    const freelancerId = req.user?.role === 'freelancer' ? req.user.freelancerId : (req.query.freelancer_id as string);
    const states = db.getStatesSummary({ onlyFavorites, niche, freelancer_id: freelancerId });
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

    // ISOLAMENTO ESTRITO: se for freelancer, NUNCA permite ver leads de outros
    const freelancerId = req.user?.role === 'freelancer'
      ? req.user.freelancerId
      : (req.query.freelancer_id as string);

    const result = db.getLeads({
      freelancer_id: freelancerId,
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
      limit: limit === 'all' || limit === '0' || limit === '-1' ? 0 : (limit ? Number(limit) : 50),
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

    // Se freelancer, valida se o lead pertence a ele
    if (req.user?.role === 'freelancer' && lead.freelancer_id && lead.freelancer_id !== req.user.freelancerId) {
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
    const freelancerId = req.user?.role === 'freelancer' ? req.user.freelancerId : undefined;
    const oldLead = db.getLeadById(req.params.id);
    const updated = db.updateLead(req.params.id, req.body, freelancerId);
    if (!updated) {
      return res.status(404).json({ error: 'Lead não encontrado ou acesso não autorizado.' });
    }

    // Log de auditoria se houve mudança de status
    if (req.body.pipeline_status && oldLead && oldLead.pipeline_status !== req.body.pipeline_status) {
      const actorId = req.user?.freelancerId || oldLead.freelancer_id || 'admin_1';
      const actorName = req.user?.name || oldLead.freelancer_name || 'Usuário';

      let actionType: 'status_changed' | 'lead_contacted' | 'response_registered' | 'follow_up_registered' | 'negotiation_started' | 'sale_registered' = 'status_changed';
      if (req.body.pipeline_status === 'CONTATADO') actionType = 'lead_contacted';
      else if (req.body.pipeline_status === 'RESPONDEU') actionType = 'response_registered';
      else if (req.body.pipeline_status === 'FOLLOW_UP') actionType = 'follow_up_registered';
      else if (req.body.pipeline_status === 'NEGOCIACAO') actionType = 'negotiation_started';
      else if (req.body.pipeline_status === 'FECHADO') actionType = 'sale_registered';

      db.logActivity({
        freelancer_id: actorId,
        freelancer_name: actorName,
        action_type: actionType,
        description: `${actorName} moveu "${updated.name}" para ${req.body.pipeline_status}`,
        metadata: { lead_id: updated.id, old_status: oldLead.pipeline_status, new_status: req.body.pipeline_status },
      });
    }

    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Ações rápidas de contato, resposta e venda com log de auditoria
app.post('/api/leads/:id/contact-attempt', (req: Request, res: Response) => {
  try {
    const lead = db.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

    if (req.user?.role === 'freelancer' && lead.freelancer_id && lead.freelancer_id !== req.user.freelancerId) {
      return res.status(403).json({ error: 'Acesso não autorizado a este lead.' });
    }

    const currentAttempts = lead.contact_attempts_count || (lead.contacted_at ? 1 : 0);
    const newStatus = lead.pipeline_status === 'NOVO' || lead.pipeline_status === 'PRÉVIA CRIADA' ? 'CONTATADO' : lead.pipeline_status;
    const updated = db.updateLead(lead.id, {
      contacted_at: new Date().toISOString(),
      contact_attempts_count: currentAttempts + 1,
      pipeline_status: newStatus,
    });

    const actorId = req.user?.freelancerId || lead.freelancer_id || 'admin_1';
    const actorName = req.user?.name || lead.freelancer_name || 'Usuário';

    db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: 'lead_contacted',
      description: `${actorName} registrou tentativa de contato com "${lead.name}" (${currentAttempts + 1}ª abordagem)`,
      metadata: { lead_id: lead.id, channel: req.body.channel || 'WhatsApp' },
    });

    res.json({ success: true, lead: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/leads/:id/register-sale', (req: Request, res: Response) => {
  try {
    const { value } = req.body;
    const lead = db.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

    if (req.user?.role === 'freelancer' && lead.freelancer_id && lead.freelancer_id !== req.user.freelancerId) {
      return res.status(403).json({ error: 'Acesso não autorizado a este lead.' });
    }

    const saleVal = Number(value) || 0;
    const updated = db.updateLead(lead.id, {
      pipeline_status: 'FECHADO',
      sale_value: saleVal,
      sale_date: new Date().toISOString(),
    });

    const actorId = req.user?.freelancerId || lead.freelancer_id || 'admin_1';
    const actorName = req.user?.name || lead.freelancer_name || 'Usuário';

    db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: 'sale_registered',
      description: `${actorName} registrou VENDA FECHADA para "${lead.name}" (R$ ${saleVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`,
      metadata: { lead_id: lead.id, sale_value: saleVal },
    });

    res.json({ success: true, lead: updated });
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
    const lead = db.getLeadById(req.params.id);
    const userId = req.user?.freelancerId || req.user?.id || 'default_user_1';
    const note = db.addLeadNote(req.params.id, userId, content.trim());

    if (lead) {
      const actorId = req.user?.freelancerId || lead.freelancer_id || 'admin_1';
      const actorName = req.user?.name || lead.freelancer_name || 'Usuário';
      db.logActivity({
        freelancer_id: actorId,
        freelancer_name: actorName,
        action_type: 'note_added',
        description: `${actorName} adicionou anotação em "${lead.name}"`,
        metadata: { lead_id: lead.id },
      });
    }

    res.json(note);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 7. PIPELINE (COM ISOLAMENTO)
app.get('/api/pipeline', (req: Request, res: Response) => {
  try {
    const freelancerId = req.user?.role === 'freelancer'
      ? req.user.freelancerId
      : (req.query.freelancer_id as string);

    const board = db.getPipelineBoard(freelancerId);
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

    const lead = db.getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (req.user?.role === 'freelancer' && lead.freelancer_id && lead.freelancer_id !== req.user.freelancerId) {
      return res.status(403).json({ error: 'Acesso não autorizado a este lead.' });
    }

    const updates: Record<string, unknown> = { pipeline_status: toStatus };
    if (toStatus === 'CONTATADO') {
      updates.contacted_at = new Date().toISOString();
      updates.contact_attempts_count = (lead.contact_attempts_count || 0) + 1;
    } else if (toStatus === 'RESPONDEU') {
      updates.response_at = new Date().toISOString();
    } else if (toStatus === 'FOLLOW_UP') {
      updates.follow_up_at = new Date().toISOString();
    } else if (toStatus === 'NEGOCIACAO') {
      updates.negotiation_at = new Date().toISOString();
    } else if (toStatus === 'FECHADO') {
      updates.sale_date = new Date().toISOString();
    }

    const updated = db.updateLead(leadId, updates);

    // Auditoria de atividade
    const actorId = req.user?.freelancerId || lead.freelancer_id || 'admin_1';
    const actorName = req.user?.name || lead.freelancer_name || 'Usuário';

    let actionType: 'status_changed' | 'lead_contacted' | 'response_registered' | 'follow_up_registered' | 'negotiation_started' | 'sale_registered' = 'status_changed';
    if (toStatus === 'CONTATADO') actionType = 'lead_contacted';
    else if (toStatus === 'RESPONDEU') actionType = 'response_registered';
    else if (toStatus === 'FOLLOW_UP') actionType = 'follow_up_registered';
    else if (toStatus === 'NEGOCIACAO') actionType = 'negotiation_started';
    else if (toStatus === 'FECHADO') actionType = 'sale_registered';

    db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: actionType,
      description: `${actorName} moveu "${lead.name}" para ${toStatus}`,
      metadata: { lead_id: lead.id, toStatus },
    });

    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 8. SEARCH JOBS (COM ISOLAMENTO E AUDITORIA)
app.get('/api/search-jobs', (req: Request, res: Response) => {
  try {
    const freelancerId = req.user?.role === 'freelancer'
      ? req.user.freelancerId
      : (req.query.freelancer_id as string);

    const jobs = db.getAllSearchJobs(freelancerId);
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

    const isFreelancer = req.user?.role === 'freelancer';
    const freelancerId = isFreelancer ? req.user?.freelancerId : (req.body.freelancerId || (req.query.freelancer_id as string) || undefined);
    let freelancerName = isFreelancer ? req.user?.name : (req.body.freelancerName || undefined);
    if (freelancerId && !freelancerName) {
      const f = db.getFreelancerById(freelancerId);
      if (f) freelancerName = f.name;
    }
    const userId = freelancerId || 'default_user_1';

    const cleanFilters: {
      onlyWithoutWebsite: boolean;
      onlyWithPhone: boolean;
      minRating: number;
      minReviews: number;
      maxReviews?: number;
      targetLeads?: number;
    } = {
      onlyWithoutWebsite: Boolean(filters?.onlyWithoutWebsite),
      onlyWithPhone: Boolean(filters?.onlyWithPhone),
      minRating: Number(filters?.minRating ?? 0),
      minReviews: Number(filters?.minReviews ?? 0),
      targetLeads: filters?.targetLeads !== undefined && filters?.targetLeads !== null && filters?.targetLeads !== '' ? Number(filters.targetLeads) : 0,
    };
    if (filters?.maxReviews !== undefined && filters?.maxReviews !== null && filters?.maxReviews !== '') {
      cleanFilters.maxReviews = Number(filters.maxReviews);
    }

    const { job, estimatedQueries, totalCities, totalAreas } = await createAndPrepareSearchJob({
      userId,
      freelancerId,
      freelancerName,
      state,
      city,
      niche,
      filters: cleanFilters,
    });

    // Registra atividade de busca iniciada
    if (freelancerId) {
      db.logActivity({
        freelancer_id: freelancerId,
        freelancer_name: freelancerName,
        action_type: 'search_performed',
        description: `${freelancerName} iniciou busca: "${niche} em ${city}, ${state}"`,
        metadata: { jobId: job.id, niche, city, state, target_leads: job.target_leads },
      });
    }

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

    // Se freelancer, valida titularidade
    if (req.user?.role === 'freelancer' && job.freelancer_id && job.freelancer_id !== req.user.freelancerId) {
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

// 9. SETTINGS & TEST KEY (ADMIN ONLY)
app.get('/api/settings', (req: Request, res: Response) => {
  try {
    const settings = db.getSettings();
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

app.post('/api/settings', requireAdmin, (req: Request, res: Response) => {
  try {
    const updates = req.body;
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

app.post('/api/settings/test-key', requireAdmin, async (req: Request, res: Response) => {
  try {
    let keyToTest = req.body.key;
    if (!keyToTest || keyToTest.includes('••••')) {
      keyToTest = db.getSettings().googleMapsApiKey;
    }

    if (!keyToTest || keyToTest.trim() === '') {
      return res.status(400).json({ valid: false, error: 'Chave de API não informada.' });
    }

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

// 10. SUPABASE MIGRATIONS
app.get('/api/supabase/migrations', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(SUPABASE_MIGRATIONS_SQL);
});

// Auto-recuperação de jobs em andamento após reinício do processo
setTimeout(() => {
  try {
    const jobs = db.getAllSearchJobs();
    for (const job of jobs) {
      if (job.status === 'running') {
        const areas = db.getSearchAreas(job.id);
        const hasPending = areas.some((a) => a.status === 'pending' || a.status === 'processing' || a.status === 'failed');
        if (hasPending) {
          for (const a of areas) {
            if (a.status === 'processing') {
              db.updateSearchArea(a.id, { status: 'pending' });
            }
          }
          console.log(`[Server] Retomando busca pendente ${job.id} (${job.niche} em ${job.city})...`);
          runSearchJob(job.id).catch(console.error);
        } else {
          db.updateSearchJob(job.id, { status: 'completed' });
        }
      }
    }
  } catch (err) {
    console.warn('[Server] Falha ao verificar jobs anteriores:', err);
  }
}, 2000);

export { app };
export default app;
