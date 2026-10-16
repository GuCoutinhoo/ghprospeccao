import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { db, matchesFreelancerId, isLeadInWorkspace, actorContext } from '../lib/store/db';
import { storageErrorCode } from '../lib/firebase/admin';
import { digest } from '../lib/store/repository';
import { shouldUseSupabase } from '../lib/supabase/admin';
import { dispatchSearchJobs } from '../lib/search/searchWorker';
import { verifyPin } from './security';
import { z } from 'zod';
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
import { SUPABASE_MIGRATIONS_SQL } from '../lib/supabase/migrations';
import { Freelancer } from '../types';

dotenv.config();

const app = express();
app.set('json replacer',(key:string,value:unknown)=>['pin','pin_hash'].includes(key)?undefined:value);

app.use(express.json({limit:'256kb'}));
app.use('/api', (_req,res,next)=>{res.setHeader('Cache-Control','no-store, private');next();});

// CORS & Headers para produção e Vercel
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-matched-path, x-forwarded-uri');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// --- GERENCIAMENTO DE SESSÕES & AUTENTICAÇÃO CRIPTOGRÁFICA ---
const ADMIN_DEFAULT_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || '';
function sessionSecret() {
  const secret=process.env.SESSION_SECRET;
  if(!secret || secret.length<32)throw new Error('SESSION_SECRET must contain at least 32 random characters.');
  return secret;
}

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

const revokedTokens = { async add(token:string) {await db.firestore.collection('revoked_sessions').doc(digest(token)).set({revoked_at:new Date().toISOString()});} };

export function signSession(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify({...payload,sid:crypto.randomUUID()})).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export function verifySession(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
  if (signature.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionPayload;
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now() || !['admin','freelancer'].includes(payload.role)) {
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
  const authHeader = req.headers.authorization || (req.headers['x-access-token'] as string);
  const token = authHeader ? (authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim()) : '';

  if (!token) {
    req.user = undefined;
    return next();
  }

  const payload = verifySession(token);
  if (!payload || await db.get('revoked_sessions',digest(token))) {
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
    return next();
  }

  if (payload.role === 'freelancer') {
    const freelancer = await db.getFreelancerById(payload.freelancerId);

    if (!freelancer) {
      req.user = undefined;
      return next();
    }

    if (freelancer.status !== 'active' || freelancer.access_code !== payload.accessCode) {
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
    return next();
  }

  req.user = undefined;
  next();
});

// Middleware de proteção: exige usuário autenticado
app.use('/api', (req,res,next) => actorContext.run(req.user ? {role:req.user.role,freelancerId:req.user.freelancerId} : {role:'anonymous'},next));

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
app.use(['/api/admin/login','/api/freelancer/auth/verify'],async(req,res,next)=>{
  if(req.method!=='POST' || req.path==='/api/admin/login')return next();
  const key=digest(`${req.ip}:${String(req.body.email || req.body.accessCode || '').toLowerCase()}`);
  const allowed=await db.firestore.runTransaction(async tx=>{
    const ref=db.firestore.collection('auth_attempts').doc(key);const snap=await tx.get(ref);const data=snap.data();
    const reset=!data || data.until<Date.now();const count=reset?0:data.count;
    if(count>=20)return false;
    tx.set(ref,{count:count+1,until:reset?Date.now()+15*60*1000:data!.until});return true;
  });
  if(!allowed)return res.status(429).json({error:'Muitas tentativas. Aguarde antes de tentar novamente.'});next();
});

// Deployment readiness: safe, read-only check against the actual configured database.
app.get('/api/health', async (_req:Request,res:Response) => {
  if(!shouldUseSupabase())return res.status(503).json({status:'not_ready'});
  try {
    await db.ensureInitialized();
    return res.json({status:'ok',storage:'connected',googlePlacesConfigured:Boolean(process.env.GOOGLE_MAPS_API_KEY)});
  } catch {
    return res.status(503).json({status:'degraded',storage:'unavailable'});
  }
});

// Single-use real Google Places connectivity probe; no credentials or Places data are returned.
// The atomic marker prevents repeated paid requests. Remove this diagnostic after validation.
app.get('/api/health/google-once', async (_req:Request,res:Response) => {
  if(process.env.GH_LIVE_GOOGLE_SMOKE_TEST!=='enabled' && !(process.env.NODE_ENV==='production' && process.env.GH_SUPABASE_SECRET_KEY && process.env.GOOGLE_MAPS_API_KEY))return res.sendStatus(404);
  if(!shouldUseSupabase())return res.sendStatus(503);
  try {
    await db.ensureInitialized();
    const ref=db.firestore.collection('settings').doc('google_smoke_check_20261015');
    try {
      await ref.create({status:'running',started_at:new Date().toISOString()});
    } catch (err) {
      const previous=await ref.get();
      if(!previous.exists)throw err;
      const stored=previous.data() || {};
      return res.status(stored.status==='passed'?200:stored.status==='running'?202:503)
        .json({status:stored.status==='passed'?'ok':stored.status==='running'?'pending':'failed',
          placesFound:stored.placesFound || 0,alreadyRun:true});
    }
    const key=process.env.GOOGLE_MAPS_API_KEY||'';
    const response=await searchPlacesOfficial('Barbearia em São Paulo SP',key,{maxResultCount:1},1);
    const success=!response.error && response.places.length>0;
    const placesFound=response.places.length;
    await ref.update({status:success?'passed':'failed',placesFound,finished_at:new Date().toISOString(),
      error_code:success?'':response.error?'GOOGLE_API_ERROR':'NO_RESULTS'});
    return res.status(success?200:503).json({status:success?'ok':'failed',placesFound});
  } catch {
    return res.status(503).json({status:'unavailable'});
  }
});

// 0. HEALTH CHECK & SYNC
app.get('/api', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'ProspectaPlaces B2B Engine API',
    time: new Date().toISOString(),
  });
});

app.post('/api/sync', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await db.syncFromFirestore();
    const stats = (await db.getDashboardStats());
    res.json({
      success: true,
      message: 'Sincronização com o Firestore concluída com sucesso!',
      leadsCount: result.leadsCount,
      placesCount: result.placesCount,
      stats,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
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
    Boolean(ADMIN_DEFAULT_EMAIL && ADMIN_DEFAULT_PASSWORD.length>=12) &&
    cleanEmail === ADMIN_DEFAULT_EMAIL.toLowerCase() &&
    crypto.timingSafeEqual(crypto.createHash('sha256').update(cleanPass).digest(),crypto.createHash('sha256').update(ADMIN_DEFAULT_PASSWORD).digest());

  if (!isValidAdmin) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.', code: 'INVALID_ADMIN_CREDENTIALS' });
  }

  const token = signSession({
    role: 'admin',
    id: 'admin_1',
    email: cleanEmail,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

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

app.post('/api/admin/logout', requireAdmin, async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (token) {
    await revokedTokens.add(token);
  }
  res.json({ success: true });
});

// Legacy auth routes compatibilidade
app.post('/api/auth/login', (_req, res) => res.status(410).json({error:'Use /api/admin/login.'}));

app.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (token) {
    await revokedTokens.add(token);
  }
  res.json({ success: true });
});

// 2. FREELANCER AUTHENTICATION & ACCESS VERIFICATION
app.post('/api/freelancer/auth/verify', async (req: Request, res: Response) => {
  const { accessCode, pin } = req.body;
  if (!accessCode) {
    return res.status(400).json({ error: 'Código de acesso do freelancer é obrigatório.' });
  }

  const freelancer = await db.getFreelancerByAccessCode(String(accessCode));

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

  // Human-readable URLs may be guessed; never allow passwordless access to a friendly slug.
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(freelancer.access_code) && !freelancer.pin_hash && !freelancer.pin) {
    return res.status(403).json({error:'PIN obrigatório',message:'O administrador precisa configurar o PIN de segurança deste acesso.'});
  }
  if (freelancer.pin_hash || freelancer.pin) {
    if (typeof pin!=='string' || !verifyPin(pin.trim(),freelancer.pin_hash || freelancer.pin!,!freelancer.pin_hash)) {
      return res.status(401).json({
        error: 'PIN incorreto',
        requiresPin: true,
        message: 'Informe o PIN de 4 a 6 dígitos cadastrado para este acesso.',
      });
    }
  }

  // Gera token de sessão isolado e assinado
  const token = signSession({
    role: 'freelancer',
    freelancerId: freelancer.id,
    accessCode: freelancer.access_code,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  const updated = (await db.updateFreelancer(freelancer.id, {
    last_access_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  }));

  (await db.logActivity({
    freelancer_id: freelancer.id,
    freelancer_name: freelancer.name,
    action_type: 'login',
    description: `${freelancer.name} acessou seu workspace individual via link exclusivo.`,
    metadata: { access_code: freelancer.access_code },
  }));

  return res.json({
    success: true,
    token,
    freelancer: updated || freelancer,
  });
});

app.post('/api/freelancer/logout', requireAuth, async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (token) {
    await revokedTokens.add(token);
  }
  res.json({ success: true });
});

app.get('/api/freelancer/me', async (req: Request, res: Response) => {
  if (!req.user || req.user.role !== 'freelancer' || !req.user.freelancer) {
    return res.status(401).json({ error: 'Sessão de freelancer não encontrada ou expirada.' });
  }

  const f = (await db.getFreelancerById(req.user.freelancer.id));
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
      if(req.body?.freelancerId && !matchesFreelancerId(req.body.freelancerId,req.user!.freelancerId))return res.status(403).json({error:'Acesso negado.'});
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
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

// 3. ADMIN FREELANCER MANAGEMENT ENDPOINTS (PROTEGIDOS POR ADMIN)
app.get('/api/admin/dashboard/stats', requireAdmin, async (req: Request, res: Response) => {
  try {
    const stats = (await db.getAdminDashboardStats({
      freelancer_id: req.query.freelancer_id as string,
      period: req.query.period as string,
      state: req.query.state as string,
      niche: req.query.niche as string,
      status: req.query.status as string,
    }));
    res.json(stats);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.get('/api/admin/freelancers', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const freelancers = (await db.getFreelancers());
    // Enriquece com métricas de desempenho individuais
    const enriched = freelancers.map(async (f) => {
      const perf = (await db.getFreelancerPerformance(f.id));
      return {
        ...f,
        performance: perf,
      };
    });
    res.json(await Promise.all(enriched));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
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

    const perf = (await db.getFreelancerPerformance(freelancer.id));

    res.status(201).json({
      success: true,
      freelancer: { ...freelancer, performance: perf },
      accessLink: `/f/${freelancer.access_code}`,
      temporaryPin: freelancer.temporaryPin,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: [400,409].includes((err as any)?.status) ? message : (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.get('/api/admin/freelancers/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const f = (await db.getFreelancerById(req.params.id));
    if (!f) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    const performance = (await db.getFreelancerPerformance(f.id));
    res.json({ freelancer: f, performance });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.patch('/api/admin/freelancers/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = (await db.updateFreelancer(req.params.id, req.body));
    if (!updated) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    const perf = (await db.getFreelancerPerformance(updated.id));
    res.json({ success: true, freelancer: { ...updated, performance: perf }, temporaryPin: updated.temporaryPin });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: [400,409].includes((err as any)?.status) ? message : (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.post('/api/admin/freelancers/:id/block', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = (await db.setFreelancerStatus(req.params.id, 'blocked'));
    if (!updated) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    res.json({ success: true, freelancer: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.post('/api/admin/freelancers/:id/unblock', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = (await db.setFreelancerStatus(req.params.id, 'active'));
    if (!updated) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    res.json({ success: true, freelancer: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: [400,409].includes((err as any)?.status) ? message : (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.post('/api/admin/freelancers/:id/regenerate-link', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await db.regenerateFreelancerAccessCode(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Freelancer não encontrado.' });
    }
    const updated = await db.getFreelancerById(req.params.id);
    res.json({ success: true, accessCode: result.accessCode, accessLink: `/f/${result.accessCode}`,
      freelancer: updated, temporaryPin: result.temporaryPin });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: [400,409].includes((err as any)?.status) ? message : (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
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
      message: `Workspace "${result.name || req.params.id}" e todos os dados associados (${result.leadsRemoved} leads, ${result.jobsRemoved} buscas e ${result.activitiesRemoved} atividades) foram excluídos permanentemente.`,
      details: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
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
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
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
      firestoreDeletedCount: result.firestoreDeletedCount,
      message: `Operação concluída com sucesso: ${result.deletedCount} leads foram permanentemente removidos de todos os workspaces (Admin e Freelancers).`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
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
        firestoreDeletedCount: result.firestoreDeletedCount,
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
        firestoreDeletedCount: result.firestoreDeletedCount,
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
        const lead = (await db.getLeadById(id));
        if (lead && !matchesFreelancerId(lead.freelancer_id, req.user!.freelancerId) && lead.workspace_id !== req.user!.freelancerId) {
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
    const lead = (await db.getLeadById(leadId));
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(lead.freelancer_id, req.user!.freelancerId) &&
      lead.workspace_id !== req.user!.freelancerId
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
    const lead = (await db.getLeadById(leadId));
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(lead.freelancer_id, req.user!.freelancerId) &&
      lead.workspace_id !== req.user!.freelancerId
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
    const leads = (await db.getLeads({ freelancer_id: req.params.id, limit: 500 }));
    res.json(leads);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.get('/api/admin/freelancers/:id/searches', requireAdmin, async (req: Request, res: Response) => {
  try {
    const searches = (await db.getAllSearchJobs(req.params.id));
    res.json(searches);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.get('/api/admin/freelancers/:id/activities', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = (await db.getActivities({ freelancer_id: req.params.id, limit: 100 }));
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.get('/api/admin/activities', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { freelancer_id, action_type, limit, offset } = req.query;
    const result = (await db.getActivities({
      freelancer_id: freelancer_id as string,
      action_type: action_type as string,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    }));
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

// 4. IBGE
app.get('/api/ibge/states', async (_req: Request, res: Response) => {
  try {
    const states = await fetchStates();
    res.json(states);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.get('/api/ibge/cities', async (req: Request, res: Response) => {
  try {
    const uf = (req.query.uf as string) || 'SP';
    const cities = await fetchCitiesByState(uf);
    res.json(cities);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.get('/api/ibge/cities/:uf', async (req: Request, res: Response) => {
  try {
    const uf = req.params.uf;
    const cities = await fetchCitiesByState(uf);
    res.json(cities);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

// 5. DASHBOARD STATS (COM ISOLAMENTO ESTRITO POR WORKSPACE)
app.get('/api/dashboard/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const scope = resolveWorkspaceScope(req);
    const stats = (await db.getDashboardStats(scope.freelancerId));
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
    const niches = (await db.getNichesSummary({ onlyFavorites, freelancer_id: scope.freelancerId }));
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
    const states = (await db.getStatesSummary({ onlyFavorites, niche, freelancer_id: scope.freelancerId }));
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
      minReviews,
      minScore,
      status,
      search,
      sortBy,
      page,
      limit,
    } = req.query;

    const scope = resolveWorkspaceScope(req);

    const result = (await db.getLeads({
      search_job_id: req.query.search_job_id as string | undefined,
      freelancer_id: scope.freelancerId,
      state: state as string,
      city: city as string,
      niche: niche as string,
      onlyWithoutWebsite: onlyWithoutWebsite === 'true',
      onlyWithPhone: onlyWithPhone === 'true',
      onlyFavorites: onlyFavorites === 'true',
      excludeHidden: req.query.excludeHidden === 'true',
      onlyHidden: req.query.onlyHidden === 'true',
      minRating: minRating ? Number(minRating) : undefined,
      minReviews: minReviews ? Number(minReviews) : undefined,
      minScore: minScore ? Number(minScore) : undefined,
      status: status as string,
      search: search as string,
      sortBy: sortBy as 'score' | 'reviews' | 'rating' | 'recent',
      page: page ? Number(page) : 1,
      limit: limit === 'all' || limit === '0' || limit === '-1' ? 0 : (limit ? Number(limit) : 50),
    }));

    res.json(result);
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.get('/api/leads/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = (await db.getLeadById(req.params.id));
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(lead.freelancer_id, req.user!.freelancerId) &&
      lead.workspace_id !== req.user!.freelancerId
    ) {
      return res.status(403).json({ error: 'Acesso negado: este lead não pertence ao seu workspace.' });
    }

    const notes = (await db.getLeadNotes(lead.id));
    const place = (await db.getPlaceByPlaceId(lead.place_id));
    res.json({ lead, notes, place });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.patch('/api/leads/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const oldLead = (await db.getLeadById(req.params.id));
    if (!oldLead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(oldLead.freelancer_id, req.user!.freelancerId) &&
      oldLead.workspace_id !== req.user!.freelancerId
    ) {
      return res.status(403).json({ error: 'Acesso negado: este lead não pertence ao seu workspace.' });
    }

    // Não permite mutação de campos de titularidade/workspace pelo cliente
    const safeUpdates = { ...req.body };
    delete safeUpdates.workspace_id;
    delete safeUpdates.freelancer_id;
    delete safeUpdates.user_id;

    const freelancerId = req.user!.role === 'freelancer' ? req.user!.freelancerId : undefined;
    const updated = (await db.updateLead(req.params.id, safeUpdates, freelancerId));
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

      (await db.logActivity({
        freelancer_id: actorId,
        freelancer_name: actorName,
        action_type: actionType,
        description: `${actorName} moveu "${updated.name}" para ${safeUpdates.pipeline_status}`,
        metadata: { lead_id: updated.id, old_status: oldLead.pipeline_status, new_status: safeUpdates.pipeline_status },
      }));
    }

    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

// Ações rápidas de contato, resposta e venda com log de auditoria
app.post('/api/leads/:id/contact-attempt', requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = (await db.getLeadById(req.params.id));
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(lead.freelancer_id, req.user!.freelancerId) &&
      lead.workspace_id !== req.user!.freelancerId
    ) {
      return res.status(403).json({ error: 'Acesso não autorizado a este lead.' });
    }

    const currentAttempts = lead.contact_attempts_count || (lead.contacted_at ? 1 : 0);
    const newStatus = lead.pipeline_status === 'NOVO' || lead.pipeline_status === 'PRÉVIA CRIADA' ? 'CONTATADO' : lead.pipeline_status;
    const updated = await db.contactLead(lead.id);

    const actorId = req.user!.freelancerId || lead.freelancer_id || 'admin_1';
    const actorName = req.user!.name || lead.freelancer_name || 'Usuário';

    (await db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: 'lead_contacted',
      description: `${actorName} registrou tentativa de contato com "${lead.name}" (${currentAttempts + 1}ª abordagem)`,
      metadata: { lead_id: lead.id, channel: req.body.channel || 'WhatsApp' },
    }));

    res.json({ success: true, lead: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.post('/api/leads/:id/register-sale', requireAuth, async (req: Request, res: Response) => {
  try {
    const { value } = req.body;
    const lead = (await db.getLeadById(req.params.id));
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(lead.freelancer_id, req.user!.freelancerId) &&
      lead.workspace_id !== req.user!.freelancerId
    ) {
      return res.status(403).json({ error: 'Acesso não autorizado a este lead.' });
    }

    const saleVal = Number(value) || 0;
    const updated = (await db.updateLead(lead.id, {
      pipeline_status: 'FECHADO',
      sale_value: saleVal,
      sale_date: new Date().toISOString(),
    }));

    const actorId = req.user!.freelancerId || lead.freelancer_id || 'admin_1';
    const actorName = req.user!.name || lead.freelancer_name || 'Usuário';

    (await db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: 'sale_registered',
      description: `${actorName} registrou VENDA FECHADA para "${lead.name}" (R$ ${saleVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`,
      metadata: { lead_id: lead.id, sale_value: saleVal },
    }));

    res.json({ success: true, lead: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.post('/api/leads/:id/favorite', requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = (await db.getLeadById(req.params.id));
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(lead.freelancer_id, req.user!.freelancerId) &&
      lead.workspace_id !== req.user!.freelancerId
    ) {
      return res.status(403).json({ error: 'Acesso negado: este lead pertence a outro workspace.' });
    }

    const updated = (await db.toggleFavoriteLead(req.params.id));
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.post('/api/leads/:id/hide', requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = (await db.getLeadById(req.params.id));
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(lead.freelancer_id, req.user!.freelancerId) &&
      lead.workspace_id !== req.user!.freelancerId
    ) {
      return res.status(403).json({ error: 'Acesso negado: este lead pertence a outro workspace.' });
    }

    const explicitValue = typeof req.body?.is_hidden === 'boolean' ? req.body.is_hidden : undefined;
    const updated = (await db.toggleHideLead(req.params.id, explicitValue));
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.post('/api/leads/:id/notes', requireAuth, async (req: Request, res: Response) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Conteúdo da observação não pode ser vazio.' });
    }
    const lead = (await db.getLeadById(req.params.id));
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(lead.freelancer_id, req.user!.freelancerId) &&
      lead.workspace_id !== req.user!.freelancerId
    ) {
      return res.status(403).json({ error: 'Acesso negado: este lead pertence a outro workspace.' });
    }

    const userId = req.user!.role === 'freelancer' ? req.user!.freelancerId! : req.user!.id;
    const note = (await db.addLeadNote(req.params.id, userId, content.trim()));

    const actorId = req.user!.freelancerId || lead.freelancer_id || 'admin_1';
    const actorName = req.user!.name || lead.freelancer_name || 'Usuário';
    (await db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: 'note_added',
      description: `${actorName} adicionou anotação em "${lead.name}"`,
      metadata: { lead_id: lead.id },
    }));

    res.json(note);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

// 7. PIPELINE (COM ISOLAMENTO)
app.get('/api/pipeline', requireAuth, async (req: Request, res: Response) => {
  try {
    const scope = resolveWorkspaceScope(req);
    const board = (await db.getPipelineBoard(scope.freelancerId));
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

    const lead = (await db.getLeadById(leadId));
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(lead.freelancer_id, req.user!.freelancerId) &&
      lead.workspace_id !== req.user!.freelancerId
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

    const updated = toStatus==='CONTATADO' ? await db.contactLead(leadId) : await db.updateLead(leadId, updates);

    // Auditoria de atividade
    const actorId = req.user!.freelancerId || lead.freelancer_id || 'admin_1';
    const actorName = req.user!.name || lead.freelancer_name || 'Usuário';

    let actionType: 'status_changed' | 'lead_contacted' | 'response_registered' | 'follow_up_registered' | 'negotiation_started' | 'sale_registered' = 'status_changed';
    if (toStatus === 'CONTATADO') actionType = 'lead_contacted';
    else if (toStatus === 'RESPONDEU') actionType = 'response_registered';
    else if (toStatus === 'FOLLOW_UP') actionType = 'follow_up_registered';
    else if (toStatus === 'NEGOCIACAO') actionType = 'negotiation_started';
    else if (toStatus === 'FECHADO') actionType = 'sale_registered';

    (await db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: actionType,
      description: `${actorName} moveu "${lead.name}" para ${toStatus}`,
      metadata: { lead_id: lead.id, toStatus },
    }));

    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

// 8. SEARCH JOBS (COM ISOLAMENTO POR WORKSPACE)
app.get('/api/search-jobs', requireAuth, async (req: Request, res: Response) => {
  try {
    cleanupStaleJobs();
    const scope = resolveWorkspaceScope(req);
    const jobs = (await db.getAllSearchJobs(scope.freelancerId));
    res.json(jobs);
  } catch (err: unknown) {
    const status = (err as any)?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/search-jobs', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed=z.object({state:z.string().regex(/^[A-Z]{2}$/),city:z.string().trim().min(1).max(100),niche:z.string().trim().min(2).max(120),filters:z.object({onlyWithoutWebsite:z.boolean(),onlyWithPhone:z.boolean(),minRating:z.number().min(0).max(5),minReviews:z.number().int().min(0),maxReviews:z.number().int().min(0).optional(),targetLeads:z.number().int().min(0).max(10000).optional()})}).safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:'Parâmetros de busca inválidos.'});
    const { state, city, niche, filters } = parsed.data;
    if (filters.maxReviews !== undefined && filters.maxReviews < filters.minReviews) {
      return res.status(400).json({error:'O máximo de avaliações não pode ser menor que o mínimo.'});
    }
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
        const targetF = (await db.getFreelancerById(req.body.targetFreelancerId));
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
      targetLeads: filters.targetLeads ?? 0,
    };
    if (filters.maxReviews !== undefined) {
      cleanFilters.maxReviews = Number(filters.maxReviews);
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
      (await db.logActivity({
        freelancer_id: jobFreelancerId,
        freelancer_name: jobFreelancerName,
        action_type: 'search_performed',
        description: `${jobFreelancerName} iniciou busca: "${niche} em ${city}, ${state}"`,
        metadata: { jobId: job.id, niche, city, state, target_leads: job.target_leads },
      }));
    }

    // Inicia worker em segundo plano
    // Job is committed; the durable dispatcher will claim it.

    res.json({ job, estimatedQueries, totalCities, totalAreas });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.get('/api/search-jobs/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = (await db.getSearchJob(req.params.id));
    if (!job) {
      return res.status(404).json({ error: 'Search Job não encontrado.' });
    }

    // Se freelancer, valida titularidade
    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(job.freelancer_id, req.user!.freelancerId) &&
      job.workspace_id !== req.user!.freelancerId
    ) {
      return res.status(403).json({ error: 'Acesso negado: esta busca pertence a outro workspace.' });
    }

    const areas = (await db.getSearchAreas(job.id));
    const queries = (await db.getSearchQueries(job.id));
    res.json({ job, areas, queries });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.post('/api/search-jobs/:id/pause', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = (await db.getSearchJob(req.params.id));
    if (!job) return res.status(404).json({ error: 'Search Job não encontrado.' });
    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(job.freelancer_id, req.user!.freelancerId) &&
      job.workspace_id !== req.user!.freelancerId
    ) {
      return res.status(403).json({ error: 'Acesso negado: esta busca pertence a outro workspace.' });
    }
    const ok = await pauseSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.post('/api/search-jobs/:id/resume', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = (await db.getSearchJob(req.params.id));
    if (!job) return res.status(404).json({ error: 'Search Job não encontrado.' });
    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(job.freelancer_id, req.user!.freelancerId) &&
      job.workspace_id !== req.user!.freelancerId
    ) {
      return res.status(403).json({ error: 'Acesso negado: esta busca pertence a outro workspace.' });
    }
    const ok = await resumeSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.post('/api/search-jobs/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = (await db.getSearchJob(req.params.id));
    if (!job) return res.status(404).json({ error: 'Search Job não encontrado.' });
    if (
      req.user!.role === 'freelancer' &&
      !matchesFreelancerId(job.freelancer_id, req.user!.freelancerId) &&
      job.workspace_id !== req.user!.freelancerId
    ) {
      return res.status(403).json({ error: 'Acesso negado: esta busca pertence a outro workspace.' });
    }
    const ok = await cancelSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

// 9. SETTINGS & TEST KEY (ADMIN ONLY)
app.get('/api/settings', requireAdmin, async (req: Request, res: Response) => {
  try {
    const settings = (await db.getSettings());
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
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
  }
});

app.post('/api/settings', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    if (updates.googleMapsApiKey && updates.googleMapsApiKey.includes('••••')) {
      delete updates.googleMapsApiKey;
    }
    const updated = (await db.updateSettings(updates));
    res.json({ success: true, settings: {...updated,googleMapsApiKey:updated.googleMapsApiKey?'••••••••••••••••':''} });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status((err as any)?.status || 503).json({ error: (err as any)?.status === 403 ? 'Acesso negado.' : 'Operação não confirmada. Tente novamente.', code: storageErrorCode(err) });
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

// 10. SUPABASE MIGRATIONS
app.get('/api/supabase/migrations', requireAdmin, (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(SUPABASE_MIGRATIONS_SQL);
});


app.post('/api/search-jobs/:id/process', requireAuth, async(req,res)=>{
  const job=await db.getSearchJob(req.params.id);
  if(!job)return res.status(404).json({error:'Busca não encontrada.'});
  if(req.user!.role==='freelancer' && !isLeadInWorkspace(job,req.user!.freelancerId)){
    return res.status(403).json({error:'Acesso negado: esta busca pertence a outro workspace.'});
  }
  await runSearchJob(job.id);
  res.json({success:true});
});
app.post('/api/leads/:id/preview-link',requireAuth,async(req,res)=>{
  const lead=await db.getLeadById(req.params.id);if(!lead)return res.sendStatus(404);
  if(req.user!.role==='freelancer' && !isLeadInWorkspace(lead,req.user!.freelancerId))return res.sendStatus(403);
  const expires=String(Date.now()+7*24*3600*1000);
  const signature=crypto.createHmac('sha256',sessionSecret()).update(`preview:${lead.id}:${expires}`).digest('hex');
  res.json({path:`/preview?leadId=${encodeURIComponent(lead.id)}&expires=${expires}&signature=${signature}`});
});
app.get('/api/public-preview/:id',async(req,res)=>{
  const {expires,signature}=req.query;
  if(typeof expires!=='string'||typeof signature!=='string'||!/^\d+$/.test(expires)||Number(expires)<=Date.now())return res.sendStatus(403);
  const expected=crypto.createHmac('sha256',sessionSecret()).update(`preview:${req.params.id}:${expires}`).digest('hex');
  if(signature.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.sendStatus(403);
  const lead=await db.getLeadById(req.params.id);if(!lead)return res.sendStatus(404);
  const fields=['id','name','niche','city','state','address','phone','rating','reviews_count','maps_url'];
  res.json({lead:Object.fromEntries(Object.entries(lead).filter(([k])=>fields.includes(k)))});
});
app.get('/api/internal/search-dispatch', async(req,res)=>{
  const expected=process.env.CRON_SECRET;
  if(!expected || expected.length<32 || req.headers.authorization!==`Bearer ${expected}`)return res.sendStatus(401);
  const jobId=await dispatchSearchJobs();res.json({jobId});
});
app.use((err:any,_req:Request,res:Response,_next:NextFunction)=>{
  res.status(err.status>=400 && err.status<500 ? err.status : 503).json({error:'Operação não confirmada. Tente novamente.',code:storageErrorCode(err)});
});
export { app };
export default app;
