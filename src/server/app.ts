import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { actorContext, db, isLeadInWorkspace, matchesFreelancerId } from '../lib/store/db';
import { fetchStates, fetchCitiesByState } from '../lib/ibge/ibgeService';
import {
  createAndPrepareSearchJob,
  runSearchJob,
  pauseSearchJob,
  resumeSearchJob,
  cancelSearchJob,
  cleanupStaleJobs,
} from '../lib/search/searchWorker';
import { searchPlacesOfficial } from '../lib/google/places';
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

// Middleware para normalização de rotas na Vercel (garante que /api/* chegue intacto ao Express)
app.use((req, _res, next) => {
  const matchedPath = req.headers['x-matched-path'] as string | undefined;
  const forwardedUri = req.headers['x-forwarded-uri'] as string | undefined;

  const targetUri = (forwardedUri && forwardedUri.startsWith('/api'))
    ? forwardedUri
    : (matchedPath && matchedPath.startsWith('/api') && !matchedPath.includes('index.js'))
      ? matchedPath
      : undefined;

  if (targetUri) {
    req.url = targetUri;
  } else if (req.url.startsWith('/api/index.js')) {
    const queryIdx = req.url.indexOf('?');
    const queryString = queryIdx !== -1 ? req.url.substring(queryIdx) : '';
    req.url = '/api' + queryString;
  } else if (!req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }
  next();
});

// Falha fechada: nenhuma rota de dados opera sem confirmar a conexão com o Supabase.
app.use('/api', async (req, _res, next) => {
  if (
    req.path === '' ||
    req.path === '/' ||
    req.path === '/health' ||
    req.path.startsWith('/health/') ||
    // O login consulta diretamente a fonte autoritativa do Supabase.
    // Evita uma segunda consulta de "health" antes de cada autenticação.
    (req.method === 'POST' && req.path === '/freelancer/auth/verify')
  ) {
    return next();
  }
  try {
    await db.ensureInitialized();
  } catch (err) {
    console.error('[Server] Falha ao conectar ao Supabase:', err);
    return _res.status(503).json({ error: 'Banco de dados temporariamente indisponível. Tente novamente.' });
  }
  next();
});

// --- GERENCIAMENTO DE SESSÕES & AUTENTICAÇÃO CRIPTOGRÁFICA ---
const ADMIN_DEFAULT_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || '';

export interface AdminSessionPayload {
  role: 'admin';
  id: string;
  email: string;
  exp: number;
}

export interface FreelancerSessionPayload {
  role: 'freelancer';
  freelancerId: string;
  accessCode: string;
  exp: number;
}

export type SessionPayload = AdminSessionPayload | FreelancerSessionPayload;

export function signSession(payload: SessionPayload): string {
  if (SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET ou JWT_SECRET deve conter pelo menos 32 caracteres.');
  }
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export function verifySession(token: string): SessionPayload | null {
  if (SESSION_SECRET.length < 32 || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  if (signature.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.exp && payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

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

// Middleware para resolução de identidade do usuário
app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
  try {
  const authHeader = req.headers.authorization || (req.headers['x-access-token'] as string);
  const token = authHeader ? (authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim()) : '';

  if (!token) {
    req.user = undefined;
    return next();
  }

  const payload = verifySession(token);
  if (!payload || await db.isSessionRevoked(token)) {
    req.user = undefined;
    return next();
  }

  if (payload.role === 'admin') {
    req.user = {
      role: 'admin',
      id: payload.id || 'admin_1',
      email: payload.email || ADMIN_DEFAULT_EMAIL,
      name: 'Gustavo Santos (Admin)',
    };
    return actorContext.run({ role: 'admin' }, next);
  }

  if (payload.role === 'freelancer') {
    let freelancer = await db.getFreelancerById(payload.freelancerId) || await db.getFreelancerByAccessCode(payload.accessCode);
    if (!freelancer) {
      try {
        await db.syncFromSupabase();
        freelancer = await db.getFreelancerById(payload.freelancerId) || await db.getFreelancerByAccessCode(payload.accessCode);
      } catch (syncErr) {
        console.warn('[Server] Falha ao consultar o Supabase na autenticação:', syncErr);
      }
    }

    if (!freelancer) {
      req.user = undefined;
      return next();
    }

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
    // Validar uma sessão deve ser somente leitura. Atualizar o mesmo registro
    // em TODA requisição (inclusive polls simultâneos) causa GH_TX_CONFLICT no
    // Supabase e faz listagens de leads falharem com 503.
    return actorContext.run({ role: 'freelancer', freelancerId: freelancer.id }, next);
  }

  req.user = undefined;
  next();
  } catch (err: unknown) {
    console.error('[Server] Falha ao validar sessão:', err);
    return res.status(503).json({
      error: 'Falha temporária na validação da sessão. Tente novamente.',
      code: 'WORKSPACE_SESSION_UNAVAILABLE',
    });
  }
});

// Middleware de proteção: exige usuário autenticado
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Não autenticado',
      message: 'Sessão necessária para acessar este recurso.',
    });
  }
  if (req.user.role === 'freelancer' && req.user.freelancer?.status === 'blocked') {
    return res.status(403).json({
      error: 'Acesso desativado',
      blocked: true,
      message: 'Seu acesso ao GHProspecção foi desativado.',
    });
  }
  next();
}

// Middleware de proteção: exige papel de Administrador
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Não autenticado',
      message: 'Autenticação de administrador necessária.',
    });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Acesso negado',
      message: 'Apenas administradores podem acessar este recurso.',
    });
  }
  next();
}

// Resolução e validação central de escopo de workspace (Zero vazamento)
export function resolveWorkspaceScope(req: Request): {
  role: 'admin' | 'freelancer';
  workspaceId: string;
  freelancerId: string | undefined;
  isInspectingFreelancer: boolean;
} {
  if (!req.user) {
    const err = new Error('Não autenticado');
    (err as any).status = 401;
    throw err;
  }

  if (req.user.role === 'freelancer') {
    const userFid = req.user.freelancerId!;
    const queryFid = req.query.freelancer_id
      ? String(req.query.freelancer_id).trim()
      : (req.query.workspace_id ? String(req.query.workspace_id).trim() : undefined);
    const bodyFid = req.body?.freelancer_id
      ? String(req.body.freelancer_id).trim()
      : (req.body?.workspace_id ? String(req.body.workspace_id).trim() : undefined);
    const requestedFid = queryFid || bodyFid;

    if (requestedFid) {
      if (requestedFid === 'ALL' || !matchesFreelancerId(userFid, requestedFid)) {
        const err = new Error('Acesso negado: Você não tem permissão para acessar ou modificar dados de outro workspace.');
        (err as any).status = 403;
        throw err;
      }
    }

    return {
      role: 'freelancer',
      workspaceId: userFid,
      freelancerId: userFid,
      isInspectingFreelancer: false,
    };
  }

  // Admin: considera tanto req.query quanto req.body (freelancer_id ou workspace_id)
  const queryFid = req.query.freelancer_id
    ? String(req.query.freelancer_id).trim()
    : (req.query.workspace_id ? String(req.query.workspace_id).trim() : undefined);
  const bodyFid = req.body?.freelancer_id
    ? String(req.body.freelancer_id).trim()
    : (req.body?.workspace_id ? String(req.body.workspace_id).trim() : undefined);
  const targetFid = queryFid || bodyFid;

  if (targetFid === 'ALL') {
    return {
      role: 'admin',
      workspaceId: 'ALL',
      freelancerId: 'ALL',
      isInspectingFreelancer: false,
    };
  }
  if (targetFid && targetFid !== 'admin' && targetFid !== 'administrador' && targetFid !== 'free_admin' && targetFid !== 'free_administrador') {
    return {
      role: 'admin',
      workspaceId: targetFid,
      freelancerId: targetFid,
      isInspectingFreelancer: true,
    };
  }

  // Workspace próprio do administrador geral
  return {
    role: 'admin',
    workspaceId: 'admin',
    freelancerId: 'admin',
    isInspectingFreelancer: false,
  };
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

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await db.ensureInitialized();
    const settings = await db.getSettings();
    const apiKey =
      settings?.googleMapsApiKey ||
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_PLACES_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      '';
    const isGooglePlacesConfigured = Boolean(apiKey && apiKey.trim().length > 10);

    return res.status(200).json({
      status: 'ok',
      storage: 'connected',
      googlePlacesConfigured: isGooglePlacesConfigured,
      timestamp: new Date().toISOString(),
      platform: process.env.VERCEL ? 'vercel' : 'node',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(503).json({
      status: 'error',
      storage: 'disconnected',
      googlePlacesConfigured: false,
      timestamp: new Date().toISOString(),
      error: msg,
    });
  }
});

app.get('/api/health/google-once', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const settings = await db.getSettings();
    const apiKey =
      settings?.googleMapsApiKey ||
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_PLACES_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      '';

    let placesFound = 0;
    if (apiKey && apiKey.trim().length > 10) {
      try {
        const result = await searchPlacesOfficial('padaria', apiKey, { maxResultCount: 1 });
        if (result.places && result.places.length > 0) {
          placesFound = result.places.length;
        }
      } catch (placeErr) {
        console.warn('[Health] Erro ao testar Places na rota de health:', placeErr);
      }
    }

    return res.status(placesFound > 0 ? 200 : 503).json({
      status: 'ok',
      placesFound,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      status: 'error',
      placesFound: 0,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/sync', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await db.syncFromSupabase();
    const stats = await db.getDashboardStats();
    res.json({
      success: true,
      message: 'Conexão e leitura do Supabase confirmadas com sucesso!',
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
  if (!password) {
    return res.status(400).json({ error: 'Senha é obrigatória.' });
  }

  const cleanPass = String(password).trim();
  const cleanEmail = String(email || ADMIN_DEFAULT_EMAIL).trim().toLowerCase();

  // Rejeita senhas inválidas/backdoors
  if (cleanPass === 'Admin@2026!' || cleanPass === 'admin') {
    return res.status(401).json({ error: 'Credenciais de administrador inválidas.' });
  }

  const isValidPass = ADMIN_DEFAULT_PASSWORD.length >= 12 && cleanPass === ADMIN_DEFAULT_PASSWORD;

  const isValidEmail =
    Boolean(ADMIN_DEFAULT_EMAIL) && cleanEmail === ADMIN_DEFAULT_EMAIL.toLowerCase();

  if (!isValidPass || !isValidEmail) {
    return res.status(401).json({ error: 'Credenciais de administrador inválidas.' });
  }

  const token = signSession({
    role: 'admin',
    id: 'admin_1',
    email: ADMIN_DEFAULT_EMAIL,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  return res.json({
    success: true,
    user: {
      id: 'admin_1',
      email: ADMIN_DEFAULT_EMAIL,
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

app.post('/api/admin/logout', requireAdmin, async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (token) {
    await db.revokeSession(token);
  }
  res.json({ success: true });
});

// Rota legada desativada: não aceitar credenciais ou backdoors históricos.
app.post('/api/auth/login', (_req: Request, res: Response) => {
  return res.status(410).json({ error: 'Rota desativada. Use /api/admin/login.' });
});

app.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (token) {
    if (verifySession(token)) await db.revokeSession(token);
  }
  res.json({ success: true });
});

// 2. FREELANCER AUTHENTICATION & ACCESS VERIFICATION
app.post('/api/freelancer/auth/verify', async (req: Request, res: Response) => {
  try {
  const { accessCode, pin } = req.body || {};
  if (!accessCode) {
    return res.status(400).json({ error: 'Código de acesso do freelancer é obrigatório.' });
  }

  // A primeira consulta já é feita no Supabase; não é necessário varrer
  // leads e lugares de TODOS os workspaces caso o código não exista.
  const freelancer = await db.getFreelancerByAccessCode(String(accessCode)) ||
    await db.getFreelancerById(String(accessCode));

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

  // Acesso direto sem exigência de PIN para workspaces de freelancers
  // Gera token de sessão isolado e assinado
  const token = signSession({
    role: 'freelancer',
    freelancerId: freelancer.id,
    accessCode: freelancer.access_code,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  // Sessões são autenticação, não mutação. Evita tempestade de transações
  // concorrentes em 'freelancers' e 'activities' durante os logins.
  // Dados de login, leads, ocultações e workspaces permanecem inalterados.
  return res.json({
    success: true,
    token,
    freelancer,
  });
  } catch (err: unknown) {
    console.error('[Server] Falha ao autenticar workspace de freelancer:', err);
    return res.status(503).json({
      error: 'Não foi possível abrir este workspace. Tente novamente em instantes.',
      code: 'WORKSPACE_LOGIN_FAILED',
    });
  }
});

app.post('/api/freelancer/logout', requireAuth, async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (token) {
    await db.revokeSession(token);
  }
  res.json({ success: true });
});

app.get('/api/freelancer/me', async (req: Request, res: Response) => {
  if (!req.user || req.user.role !== 'freelancer' || !req.user.freelancer) {
    return res.status(401).json({ error: 'Sessão de freelancer não encontrada ou expirada.' });
  }

  const f = await db.getFreelancerById(req.user.freelancer.id);
  if (!f || f.status === 'blocked') {
    return res.status(403).json({
      error: 'Acesso desativado',
      blocked: true,
      message: 'Seu acesso ao GHProspecção foi desativado. Entre em contato com o administrador.',
    });
  }

  res.json({ freelancer: f });
});

// ZERAR WORKSPACE DO FREELANCER (LIMPEZA TOTAL DE LEADS E BUSCAS DO WORKSPACE)
app.post('/api/freelancer/workspace/reset', requireAuth, async (req: Request, res: Response) => {
  try {
    let freelancerId: string | undefined;
    if (req.user!.role === 'freelancer') {
      freelancerId = req.user!.freelancerId;
    } else {
      freelancerId = req.body?.freelancerId || (req.query.freelancer_id as string);
    }
    if (!freelancerId) {
      return res.status(400).json({ error: 'Identificação do freelancer é obrigatória para zerar o workspace.' });
    }
    const result = await db.cleanFreelancerWorkspace(freelancerId);
    res.json({
      success: true,
      leadsRemoved: result.leadsRemoved,
      message: `Workspace zerado com sucesso! ${result.leadsRemoved} leads foram removidos.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 3. ADMIN FREELANCER MANAGEMENT ENDPOINTS (PROTEGIDOS POR ADMIN)
app.get('/api/admin/dashboard/stats', requireAdmin, async (req: Request, res: Response) => {
  try {
    const stats = await db.getAdminDashboardStats({
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

app.get('/api/admin/freelancers', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const freelancers = await db.getFreelancers();
    // Enriquece com métricas de desempenho individuais
    const enriched = await Promise.all(freelancers.map(async (f) => {
      const perf = await db.getFreelancerPerformance(f.id);
      return {
        ...f,
        performance: perf,
      };
    }));
    res.json(enriched);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/admin/freelancers', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, email, access_code, notes, pin, status } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Nome e e-mail são obrigatórios para cadastrar um freelancer.' });
    }

    const freelancer = await db.createFreelancer({
      name,
      email,
      access_code,
      notes,
      pin,
      status: status || 'active',
    });

    const perf = await db.getFreelancerPerformance(freelancer.id);

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

app.get('/api/admin/freelancers/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const f = await db.getFreelancerById(req.params.id);
    if (!f) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    const performance = await db.getFreelancerPerformance(f.id);
    res.json({ freelancer: f, performance });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.patch('/api/admin/freelancers/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = await db.updateFreelancer(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    const perf = await db.getFreelancerPerformance(updated.id);
    res.json({ success: true, freelancer: { ...updated, performance: perf } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/admin/freelancers/:id/block', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = await db.setFreelancerStatus(req.params.id, 'blocked');
    if (!updated) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    res.json({ success: true, freelancer: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/admin/freelancers/:id/unblock', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = await db.setFreelancerStatus(req.params.id, 'active');
    if (!updated) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    res.json({ success: true, freelancer: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/admin/freelancers/:id/regenerate-link', requireAdmin, async (req: Request, res: Response) => {
  try {
    const newCode = await db.regenerateFreelancerAccessCode(req.params.id);
    if (!newCode) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    const updated = await db.getFreelancerById(req.params.id);
    res.json({ success: true, accessCode: newCode, accessLink: `/f/${newCode}`, freelancer: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.delete('/api/admin/freelancers/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await db.deleteFreelancer(req.params.id);
    if (!result.success) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    res.json({
      success: true,
      message: `O acesso ao workspace "${result.name || req.params.id}" foi desativado. Leads e históricos foram preservados; ${result.jobsRemoved} busca(s) ativa(s) foram canceladas.`,
      details: result,
    });
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/admin/freelancers/:id/reset', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await db.cleanFreelancerWorkspace(req.params.id);
    res.json({
      success: true,
      leadsRemoved: result.leadsRemoved,
      message: `Workspace zerado com sucesso! ${result.leadsRemoved} leads foram removidos.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ROTA ADMINISTRATIVA DE LIMPEZA GLOBAL DE LEADS (TODOS OS WORKSPACES) COM CONFIRMAÇÃO EXPLÍCITA
app.post('/api/admin/leads/purge-global', requireAdmin, async (req: Request, res: Response) => {
  try {
    const confirmation = (req.body?.confirmation || '').toString().trim().toUpperCase();
    const validConfirmations = ['ZERAR_TODOS_OS_LEADS', 'ZERAR TUDO', 'CONFIRMAR', 'EXCLUIR_TODOS_OS_LEADS'];
    
    if (!validConfirmations.includes(confirmation)) {
      return res.status(400).json({
        error: 'Confirmação inválida',
        message: 'Para zerar permanentemente todos os leads de todos os workspaces, confirme enviando "ZERAR_TODOS_OS_LEADS" ou "ZERAR TUDO".',
      });
    }

    const result = await db.purgeAllLeadsGlobal();

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      jobsCancelled: result.jobsCancelled,
      supabaseDeletedCount: result.supabaseDeletedCount,
      message: `Operação concluída com sucesso: ${result.deletedCount} leads foram permanentemente removidos de todos os workspaces (Admin e Freelancers).`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.delete('/api/leads/all', requireAuth, async (req: Request, res: Response) => {
  try {
    const isGlobalRequested = req.query.global === 'true' || req.body?.global === true || req.query.freelancer_id === 'ALL' || req.body?.freelancer_id === 'ALL';
    
    if (isGlobalRequested) {
      if (req.user!.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas administradores podem executar a limpeza global de todos os workspaces.' });
      }
      const result = await db.purgeAllLeadsGlobal();
      return res.json({
        success: true,
        deletedCount: result.deletedCount,
        jobsCancelled: result.jobsCancelled,
        supabaseDeletedCount: result.supabaseDeletedCount,
        message: `Todos os leads de TODOS os workspaces foram excluídos permanentemente (${result.deletedCount} estabelecimentos removidos).`,
      });
    }

    const scope = resolveWorkspaceScope(req);
    const targetFreelancerId = scope.role === 'freelancer' ? scope.freelancerId : (scope.isInspectingFreelancer ? scope.freelancerId : 'admin');

    const result = await db.deleteAllLeads({
      freelancerId: targetFreelancerId,
      role: req.user!.role,
    });

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `${result.deletedCount} leads excluídos com sucesso do workspace.`,
    });
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/leads/delete-all', requireAuth, async (req: Request, res: Response) => {
  try {
    const isGlobalRequested = req.query.global === 'true' || req.body?.global === true || req.query.freelancer_id === 'ALL' || req.body?.freelancer_id === 'ALL';
    
    if (isGlobalRequested) {
      if (req.user!.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas administradores podem executar a limpeza global de todos os workspaces.' });
      }
      const result = await db.purgeAllLeadsGlobal();
      return res.json({
        success: true,
        deletedCount: result.deletedCount,
        jobsCancelled: result.jobsCancelled,
        supabaseDeletedCount: result.supabaseDeletedCount,
        message: `Todos os leads de TODOS os workspaces foram excluídos permanentemente (${result.deletedCount} estabelecimentos removidos).`,
      });
    }

    const scope = resolveWorkspaceScope(req);
    const targetFreelancerId = scope.role === 'freelancer' ? scope.freelancerId : (scope.isInspectingFreelancer ? scope.freelancerId : 'admin');

    const result = await db.deleteAllLeads({
      freelancerId: targetFreelancerId,
      role: req.user!.role,
    });

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `${result.deletedCount} leads excluídos com sucesso do workspace.`,
    });
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/leads/batch-delete', requireAuth, async (req: Request, res: Response) => {
  try {
    const { leadIds } = req.body;
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: 'leadIds deve ser um array com os IDs dos leads.' });
    }

    if (req.user!.role === 'freelancer') {
      for (const id of leadIds) {
        const lead = await db.getLeadById(id);
        if (lead && !isLeadInWorkspace(lead, req.user!.freelancerId)) {
          return res.status(403).json({ error: 'Acesso negado: um ou mais leads pertencem a outro workspace.' });
        }
      }
    }

    const deletedCount = await db.deleteMultipleLeads(leadIds, req.user?.freelancerId);

    res.json({ success: true, deletedCount });
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.delete('/api/leads/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const leadId = req.params.id;
    const lead = await db.getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(lead, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso negado: este lead não pertence ao seu workspace.' });
    }

    await db.deleteLead(leadId, req.user?.freelancerId);
    res.json({ success: true, message: 'Lead excluído com sucesso.' });
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/leads/:id/delete', requireAuth, async (req: Request, res: Response) => {
  try {
    const leadId = req.params.id;
    const lead = await db.getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(lead, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso negado: este lead não pertence ao seu workspace.' });
    }

    await db.deleteLead(leadId, req.user?.freelancerId);
    res.json({ success: true, message: 'Lead excluído com sucesso.' });
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.get('/api/admin/freelancers/:id/leads', requireAdmin, async (req: Request, res: Response) => {
  try {
    const leads = await db.getLeads({ freelancer_id: req.params.id, limit: 500 });
    res.json(leads);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/freelancers/:id/searches', requireAdmin, async (req: Request, res: Response) => {
  try {
    const searches = await db.getAllSearchJobs(req.params.id);
    res.json(searches);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/freelancers/:id/activities', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await db.getActivities({ freelancer_id: req.params.id, limit: 100 });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/activities', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { freelancer_id, action_type, limit, offset } = req.query;
    const result = await db.getActivities({
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

// 5. DASHBOARD STATS (COM ISOLAMENTO ESTRITO POR WORKSPACE)
app.get('/api/dashboard/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const scope = resolveWorkspaceScope(req);
    const stats = await db.getDashboardStats(scope.freelancerId);
    res.json(stats);
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

// 6. LEADS & NICHES
app.get('/api/niches', requireAuth, async (req: Request, res: Response) => {
  try {
    const onlyFavorites = req.query.onlyFavorites === 'true';
    const scope = resolveWorkspaceScope(req);
    const niches = await db.getNichesSummary({ onlyFavorites, freelancer_id: scope.freelancerId });
    res.json(niches);
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.get('/api/states-summary', requireAuth, async (req: Request, res: Response) => {
  try {
    const onlyFavorites = req.query.onlyFavorites === 'true';
    const niche = req.query.niche as string;
    const scope = resolveWorkspaceScope(req);
    const states = await db.getStatesSummary({ onlyFavorites, niche, freelancer_id: scope.freelancerId });
    res.json(states);
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.get('/api/leads', requireAuth, async (req: Request, res: Response) => {
  try {
    await db.ensureInitialized();
    const {
      state,
      city,
      niche,
      onlyWithoutWebsite,
      onlyWithPhone,
      onlyFavorites,
      minRating,
      maxRating,
      minReviews,
      maxReviews,
      minScore,
      status,
      search,
      sortBy,
      page,
      limit,
    } = req.query;

    const scope = resolveWorkspaceScope(req);

    const result = await db.getLeads({
      search_job_id: typeof req.query.search_job_id === 'string' ? req.query.search_job_id : undefined,
      freelancer_id: scope.freelancerId,
      state: state as string,
      city: city as string,
      niche: niche as string,
      onlyWithoutWebsite: onlyWithoutWebsite === 'true',
      onlyWithPhone: onlyWithPhone === 'true',
      onlyFavorites: onlyFavorites === 'true',
      excludeHidden: req.query.excludeHidden === undefined ? undefined : req.query.excludeHidden === 'true',
      onlyHidden: req.query.onlyHidden === 'true',
      minRating: minRating ? Number(minRating) : undefined,
      maxRating: maxRating !== undefined && maxRating !== '' ? Number(maxRating) : undefined,
      minReviews: minReviews ? Number(minReviews) : undefined,
      maxReviews: maxReviews ? Number(maxReviews) : undefined,
      minScore: minScore ? Number(minScore) : undefined,
      status: status as string,
      search: search as string,
      sortBy: sortBy as 'score' | 'reviews' | 'rating' | 'recent',
      page: page ? Number(page) : 1,
      limit: limit === 'all' || limit === '0' || limit === '-1' ? 0 : (limit ? Number(limit) : 50),
    });

    res.json(result);
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.get('/api/leads/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(lead, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso negado: este lead não pertence ao seu workspace.' });
    }

    const [notes, place] = await Promise.all([db.getLeadNotes(lead.id), db.getPlaceByPlaceId(lead.place_id)]);
    res.json({ lead, notes, place });
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.patch('/api/leads/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const oldLead = await db.getLeadById(req.params.id);
    if (!oldLead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(oldLead, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso negado: este lead não pertence ao seu workspace.' });
    }

    // Não permite mutação de campos de titularidade/workspace pelo cliente
    const safeUpdates = { ...req.body };
    delete safeUpdates.workspace_id;
    delete safeUpdates.freelancer_id;
    delete safeUpdates.user_id;

    const freelancerId = req.user!.role === 'freelancer' ? req.user!.freelancerId : undefined;
    const updated = await db.updateLead(req.params.id, safeUpdates, freelancerId);
    if (!updated) {
      return res.status(404).json({ error: 'Lead não encontrado ou acesso não autorizado.' });
    }

    // Log de auditoria se houve mudança de status
    if (safeUpdates.pipeline_status && oldLead.pipeline_status !== safeUpdates.pipeline_status) {
      const actorId = req.user!.freelancerId || oldLead.freelancer_id || 'admin_1';
      const actorName = req.user!.name || oldLead.freelancer_name || 'Usuário';

      let actionType: 'status_changed' | 'lead_contacted' | 'response_registered' | 'follow_up_registered' | 'negotiation_started' | 'sale_registered' = 'status_changed';
      if (safeUpdates.pipeline_status === 'CONTATADO') actionType = 'lead_contacted';
      else if (safeUpdates.pipeline_status === 'RESPONDEU') actionType = 'response_registered';
      else if (safeUpdates.pipeline_status === 'FOLLOW_UP') actionType = 'follow_up_registered';
      else if (safeUpdates.pipeline_status === 'NEGOCIACAO') actionType = 'negotiation_started';
      else if (safeUpdates.pipeline_status === 'FECHADO') actionType = 'sale_registered';

      await db.logActivity({
        freelancer_id: actorId,
        freelancer_name: actorName,
        action_type: actionType,
        description: `${actorName} moveu "${updated.name}" para ${safeUpdates.pipeline_status}`,
        metadata: { lead_id: updated.id, old_status: oldLead.pipeline_status, new_status: safeUpdates.pipeline_status },
      });
    }

    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Ações rápidas de contato, resposta e venda com log de auditoria
app.post('/api/leads/:id/contact-attempt', requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(lead, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso não autorizado a este lead.' });
    }

    const currentAttempts = lead.contact_attempts_count || (lead.contacted_at ? 1 : 0);
    const newStatus = lead.pipeline_status === 'NOVO' || lead.pipeline_status === 'PRÉVIA CRIADA' ? 'CONTATADO' : lead.pipeline_status;
    const updated = await db.updateLead(lead.id, {
      contacted_at: new Date().toISOString(),
      contact_attempts_count: currentAttempts + 1,
      pipeline_status: newStatus,
    });

    const actorId = req.user!.freelancerId || lead.freelancer_id || 'admin_1';
    const actorName = req.user!.name || lead.freelancer_name || 'Usuário';

    await db.logActivity({
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

app.post('/api/leads/:id/register-sale', requireAuth, async (req: Request, res: Response) => {
  try {
    const { value } = req.body;
    const lead = await db.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(lead, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso não autorizado a este lead.' });
    }

    const saleVal = Number(value) || 0;
    const updated = await db.updateLead(lead.id, {
      pipeline_status: 'FECHADO',
      sale_value: saleVal,
      sale_date: new Date().toISOString(),
    });

    const actorId = req.user!.freelancerId || lead.freelancer_id || 'admin_1';
    const actorName = req.user!.name || lead.freelancer_name || 'Usuário';

    await db.logActivity({
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

app.post('/api/leads/:id/favorite', requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(lead, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso negado: este lead pertence a outro workspace.' });
    }

    const updated = await db.toggleFavoriteLead(req.params.id);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/leads/:id/hide', requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(lead, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso negado: este lead pertence a outro workspace.' });
    }

    const explicitValue = typeof req.body?.is_hidden === 'boolean' ? req.body.is_hidden : undefined;
    const updated = await db.toggleHideLead(req.params.id, explicitValue);
    if (!updated) {
      return res.status(404).json({ error: 'Lead não encontrado. Recarregue a lista.' });
    }
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/leads/:id/notes', requireAuth, async (req: Request, res: Response) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Conteúdo da observação não pode ser vazio.' });
    }
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(lead, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso negado: este lead pertence a outro workspace.' });
    }

    const userId = req.user!.role === 'freelancer' ? req.user!.freelancerId! : req.user!.id;
    const note = await db.addLeadNote(req.params.id, userId, content.trim());

    const actorId = req.user!.freelancerId || lead.freelancer_id || 'admin_1';
    const actorName = req.user!.name || lead.freelancer_name || 'Usuário';
    await db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: 'note_added',
      description: `${actorName} adicionou anotação em "${lead.name}"`,
      metadata: { lead_id: lead.id },
    });

    res.json(note);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 7. PIPELINE (COM ISOLAMENTO)
app.get('/api/pipeline', requireAuth, async (req: Request, res: Response) => {
  try {
    const scope = resolveWorkspaceScope(req);
    const board = await db.getPipelineBoard(scope.freelancerId);
    res.json(board);
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/pipeline/move', requireAuth, async (req: Request, res: Response) => {
  try {
    const { leadId, toStatus } = req.body;
    if (!leadId || !toStatus) {
      return res.status(400).json({ error: 'leadId e toStatus são obrigatórios.' });
    }

    const lead = await db.getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(lead, req.user!.freelancerId)
    ) {
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

    const updated = await db.updateLead(leadId, updates);

    // Auditoria de atividade
    const actorId = req.user!.freelancerId || lead.freelancer_id || 'admin_1';
    const actorName = req.user!.name || lead.freelancer_name || 'Usuário';

    let actionType: 'status_changed' | 'lead_contacted' | 'response_registered' | 'follow_up_registered' | 'negotiation_started' | 'sale_registered' = 'status_changed';
    if (toStatus === 'CONTATADO') actionType = 'lead_contacted';
    else if (toStatus === 'RESPONDEU') actionType = 'response_registered';
    else if (toStatus === 'FOLLOW_UP') actionType = 'follow_up_registered';
    else if (toStatus === 'NEGOCIACAO') actionType = 'negotiation_started';
    else if (toStatus === 'FECHADO') actionType = 'sale_registered';

    await db.logActivity({
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

// 8. SEARCH JOBS (COM ISOLAMENTO POR WORKSPACE)
app.get('/api/search-jobs', requireAuth, async (req: Request, res: Response) => {
  try {
    await cleanupStaleJobs();
    const scope = resolveWorkspaceScope(req);
    const jobs = await db.getAllSearchJobs(scope.freelancerId);
    res.json(jobs.map(({ area_plan, ...summary }) => summary));
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/search-jobs', requireAuth, async (req: Request, res: Response) => {
  try {
    const { state, city, niche, filters } = req.body;
    if (!state || !city || !niche) {
      return res.status(400).json({ error: 'Estado, cidade e nicho são obrigatórios.' });
    }

    let jobFreelancerId: string | undefined = undefined;
    let jobFreelancerName: string | undefined = undefined;
    let jobWorkspaceId = 'admin';

    if (req.user!.role === 'freelancer') {
      const userFid = req.user!.freelancerId!;
      const requestedFid = req.body.freelancerId || req.query.freelancer_id;
      if (requestedFid && !matchesFreelancerId(userFid, String(requestedFid))) {
        return res.status(403).json({
          error: 'Acesso negado',
          message: 'Você não pode criar buscas no workspace de outro usuário.',
        });
      }
      jobFreelancerId = userFid;
      jobFreelancerName = req.user!.name;
      jobWorkspaceId = userFid;
    } else {
      // Admin: busca normal realizada no Admin sempre pertence ao workspace Admin!
      if (req.body.targetFreelancerId) {
        const targetF = await db.getFreelancerById(req.body.targetFreelancerId);
        if (targetF) {
          jobFreelancerId = targetF.id;
          jobFreelancerName = targetF.name;
          jobWorkspaceId = targetF.id;
        }
      } else {
        jobFreelancerId = undefined;
        jobFreelancerName = undefined;
        jobWorkspaceId = 'admin';
      }
    }

    const userId = jobFreelancerId || 'admin_1';

    const minRatingValue = Number(filters?.minRating ?? 0);
    const hasMaxRating = filters?.maxRating !== undefined && filters?.maxRating !== null && filters?.maxRating !== '';
    const maxRatingValue = hasMaxRating ? Number(filters.maxRating) : undefined;
    if (!Number.isFinite(minRatingValue) || minRatingValue < 0 || minRatingValue > 5 ||
        (maxRatingValue !== undefined && (!Number.isFinite(maxRatingValue) || maxRatingValue <= 0 || maxRatingValue > 5 || maxRatingValue < minRatingValue))) {
      return res.status(400).json({ error: 'Faixa de notas inválida: a nota máxima deve ser maior ou igual à mínima, com valores entre 0 e 5.' });
    }
    const minReviewsValue=Number(filters?.minReviews ?? 0);
    const maxReviewsValue=filters?.maxReviews !== undefined && filters?.maxReviews !== null && filters?.maxReviews !== '' ? Number(filters.maxReviews) : undefined;
    const targetLeadsValue=filters?.targetLeads !== undefined && filters?.targetLeads !== null && filters?.targetLeads !== '' ? Number(filters.targetLeads) : 0;
    if(!Number.isInteger(minReviewsValue) || minReviewsValue<0 || (maxReviewsValue!==undefined && (!Number.isInteger(maxReviewsValue) || maxReviewsValue<minReviewsValue)) || !Number.isInteger(targetLeadsValue) || targetLeadsValue<0) {
      return res.status(400).json({error:'Filtros de quantidade devem ser números inteiros não negativos; o máximo de avaliações deve ser maior ou igual ao mínimo.'});
    }

    const cleanFilters: {
      onlyWithoutWebsite: boolean;
      onlyWithPhone: boolean;
      minRating: number;
      maxRating?: number;
      minReviews: number;
      maxReviews?: number;
      targetLeads?: number;
    } = {
      onlyWithoutWebsite: Boolean(filters?.onlyWithoutWebsite),
      onlyWithPhone: Boolean(filters?.onlyWithPhone),
      minRating: minRatingValue,
      minReviews: minReviewsValue,
      targetLeads: targetLeadsValue,
    };
    if (maxRatingValue !== undefined) {
      cleanFilters.maxRating = maxRatingValue;
    }
    if (maxReviewsValue !== undefined) {
      cleanFilters.maxReviews = maxReviewsValue;
    }

    const { job, estimatedQueries, totalCities, totalAreas } = await createAndPrepareSearchJob({
      userId,
      freelancerId: jobFreelancerId,
      freelancerName: jobFreelancerName,
      state,
      city,
      niche,
      filters: cleanFilters,
    });

    job.workspace_id = jobWorkspaceId;

    // Registra atividade de busca iniciada
    if (jobFreelancerId) {
      await db.logActivity({
        freelancer_id: jobFreelancerId,
        freelancer_name: jobFreelancerName,
        action_type: 'search_performed',
        description: `${jobFreelancerName} iniciou busca: "${niche} em ${city}, ${state}"`,
        metadata: { jobId: job.id, niche, city, state, target_leads: job.target_leads },
      });
    }

    // Serverless: do not abandon an asynchronous search after returning HTTP 200.
    const { area_plan, ...summary } = job;
    res.json({ job: summary, estimatedQueries, totalCities, totalAreas });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/search-jobs/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Search Job não encontrado.' });
    }

    // Se freelancer, valida titularidade
    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(job, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso negado: esta busca pertence a outro workspace.' });
    }

    const [areas, queries] = await Promise.all([db.getSearchAreas(job.id), db.getSearchQueries(job.id)]);
    const { area_plan, ...summary } = job;
    const activeAreas = areas.filter(a => a.status !== 'pending').slice(-80);
    const nextAreas = areas.filter(a => a.status === 'pending').slice(0, 20);
    res.json({ job: summary, areas: [...activeAreas,...nextAreas], queries: queries.slice(-30) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/search-jobs/:id/step', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Busca não encontrada.' });
    if (req.user!.role === 'freelancer' && !isLeadInWorkspace(job, req.user!.freelancerId)) {
      return res.status(403).json({ error: 'Acesso negado ao workspace.' });
    }
    if (job.status === 'pending' || job.status === 'running') {
      await runSearchJob(job.id, 1);
    }
    const fresh = await db.getSearchJob(job.id);
    if (!fresh) return res.status(404).json({ error: 'Busca não encontrada.' });
    const { area_plan, ...summary } = fresh;
    res.json({ job: summary });
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/search-jobs/:id/pause', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Search Job não encontrado.' });
    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(job, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso negado: esta busca pertence a outro workspace.' });
    }
    const ok = await pauseSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/search-jobs/:id/resume', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Search Job não encontrado.' });
    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(job, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso negado: esta busca pertence a outro workspace.' });
    }
    const ok = await resumeSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/search-jobs/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Search Job não encontrado.' });
    if (
      req.user!.role === 'freelancer' &&
      !isLeadInWorkspace(job, req.user!.freelancerId)
    ) {
      return res.status(403).json({ error: 'Acesso negado: esta busca pertence a outro workspace.' });
    }
    const ok = await cancelSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// 9. SETTINGS & TEST KEY (ADMIN ONLY)
app.get('/api/settings', requireAdmin, async (req: Request, res: Response) => {
  try {
    const settings = await db.getSettings();
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

app.post('/api/settings', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    if (updates.googleMapsApiKey && updates.googleMapsApiKey.includes('••••')) {
      delete updates.googleMapsApiKey;
    }
    const updated = await db.updateSettings(updates);
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
      keyToTest = (await db.getSettings()).googleMapsApiKey;
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

// Search slices are explicitly awaited by HTTP requests; no orphaned startup workers.

export { app };
export default app;
