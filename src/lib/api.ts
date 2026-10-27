import {
  DashboardStats,
  Lead,
  LeadNote,
  Place,
  SearchJob,
  SearchArea,
  SearchQueryLog,
  AppSettings,
  IBGEState,
  IBGECity,
  PipelineStatus,
  Freelancer,
  Activity,
  AdminDashboardStats,
  FreelancerPerformance,
} from '../types';
import { BRAZILIAN_STATES, POPULAR_CITIES_BY_STATE } from './ibge/ibgeService';

// API responses are intentionally not persisted in the browser; Supabase remains authoritative.
export function invalidateLeadsCache(): void {}

export function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (typeof window === 'undefined') return headers;

  const adminToken = localStorage.getItem('gh_admin_token');
  const freelancerToken = localStorage.getItem('gh_freelancer_token');
  const pathname = window.location.pathname || '';

  // Se rota ou contexto for administrativo, usa adminToken estritamente
  if (pathname.startsWith('/admin') || (!freelancerToken && adminToken)) {
    if (adminToken && adminToken !== 'admin_master_session_token') {
      headers['Authorization'] = `Bearer ${adminToken}`;
    }
    return headers;
  }

  // Se estiver em modo freelancer, usa freelancerToken exclusivamente
  if (freelancerToken && freelancerToken.includes('.')) {
    headers['Authorization'] = `Bearer ${freelancerToken}`;
    return headers;
  }

  // Se houver adminToken válido
  if (adminToken && adminToken !== 'admin_master_session_token') {
    headers['Authorization'] = `Bearer ${adminToken}`;
    return headers;
  }

  return headers;
}

export function isFreelancerMode(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(localStorage.getItem('gh_freelancer_token'));
}

export function getActiveFreelancerSession(): { token: string; freelancer: Freelancer } | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('gh_freelancer_session');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const api = {
  // Admin Authentication
  async adminLogin(email: string, pass: string) {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao autenticar administrador.');
    }
    const data = await res.json();
    if (data.token) {
      localStorage.setItem('gh_admin_token', data.token);
      localStorage.setItem('gh_admin_user', JSON.stringify(data.user));
      // Garante remoção absoluta de qualquer resíduo de sessão de freelancer
      localStorage.removeItem('gh_freelancer_token');
      localStorage.removeItem('gh_freelancer_session');
      invalidateLeadsCache();
    }
    return data;
  },

  async adminGetMe() {
    const res = await fetch('/api/admin/me', {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Não autenticado como administrador.');
    return res.json();
  },

  async adminLogout() {
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    } catch {}
    localStorage.removeItem('gh_admin_token');
    localStorage.removeItem('gh_admin_user');
    localStorage.removeItem('gh_freelancer_token');
    localStorage.removeItem('gh_freelancer_session');
    invalidateLeadsCache();
    return { success: true };
  },

  // Freelancer Authentication & Workspace Access
  async verifyFreelancerLink(accessCode: string, pin?: string) {
    let res: Response;
    try {
      res = await fetch('/api/freelancer/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode, pin }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err: unknown) {
      if (err instanceof Error && ['AbortError', 'TimeoutError'].includes(err.name)) {
        throw new Error('O servidor demorou a responder. Tente acessar o workspace novamente.');
      }
      throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 403 && err.blocked) {
        const error = new Error(err.message || 'Seu acesso ao GHProspecção foi desativado. Entre em contato com o administrador.');
        (error as any).blocked = true;
        throw error;
      }
      const error = new Error(err.message || err.error || 'Código ou link de acesso inválido.');
      (error as any).status = res.status;
      (error as any).requiresPin = err.requiresPin;
      throw error;
    }

    const data = await res.json();
    if (data.token && data.freelancer) {
      localStorage.setItem('gh_freelancer_token', data.token);
      localStorage.setItem('gh_freelancer_session', JSON.stringify({ token: data.token, freelancer: data.freelancer }));
      // Garante remoção de credenciais administrativas no workspace de freelancer
      localStorage.removeItem('gh_admin_token');
      localStorage.removeItem('gh_admin_user');
      invalidateLeadsCache();
    }
    return data;
  },

  async getFreelancerMe(): Promise<{ freelancer: Freelancer }> {
    const res = await fetch('/api/freelancer/me', {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 403 && err.blocked) {
        const error = new Error(err.message || 'Seu acesso ao GHProspecção foi desativado. Entre em contato com o administrador.');
        (error as any).blocked = true;
        throw error;
      }
      throw new Error(err.error || 'Sessão do freelancer expirada.');
    }
    return res.json();
  },

  async freelancerLogout() {
    try {
      await fetch('/api/freelancer/logout', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    } catch {}
    localStorage.removeItem('gh_freelancer_token');
    localStorage.removeItem('gh_freelancer_session');
    localStorage.removeItem('gh_admin_token');
    localStorage.removeItem('gh_admin_user');
    invalidateLeadsCache();
  },

  async resetFreelancerWorkspace(freelancerId?: string): Promise<{ success: boolean; leadsRemoved: number; message: string }> {
    invalidateLeadsCache();
    const res = await fetch('/api/freelancer/workspace/reset', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ freelancerId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao zerar workspace.');
    }
    invalidateLeadsCache();
    return res.json();
  },

  // Admin: Gestão de Freelancers
  async adminGetDashboardStats(filters?: {
    freelancer_id?: string;
    period?: string;
    state?: string;
    niche?: string;
    status?: string;
  }): Promise<AdminDashboardStats> {
    const query = new URLSearchParams();
    if (filters?.freelancer_id) query.set('freelancer_id', filters.freelancer_id);
    if (filters?.period) query.set('period', filters.period);
    if (filters?.state) query.set('state', filters.state);
    if (filters?.niche) query.set('niche', filters.niche);
    if (filters?.status) query.set('status', filters.status);

    const res = await fetch(`/api/admin/dashboard/stats?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Falha ao carregar métricas operacionais do painel admin.');
    }
    return res.json();
  },

  async adminGetFreelancers(): Promise<(Freelancer & { performance?: FreelancerPerformance })[]> {
    const res = await fetch('/api/admin/freelancers', {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha ao carregar lista de freelancers.');
    return res.json();
  },

  async adminCreateFreelancer(data: {
    name: string;
    email: string;
    access_code?: string;
    notes?: string;
    pin?: string;
    status?: 'active' | 'blocked' | 'inactive';
  }): Promise<{ success: boolean; freelancer: Freelancer; accessLink: string }> {
    invalidateLeadsCache();
    const res = await fetch('/api/admin/freelancers', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao cadastrar freelancer.');
    }
    invalidateLeadsCache();
    return res.json();
  },

  async adminGetFreelancerById(id: string): Promise<{ freelancer: Freelancer; performance?: FreelancerPerformance }> {
    const res = await fetch(`/api/admin/freelancers/${id}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Freelancer não encontrado.');
    return res.json();
  },

  async adminUpdateFreelancer(id: string, updates: Partial<Freelancer>): Promise<{ success: boolean; freelancer: Freelancer }> {
    const res = await fetch(`/api/admin/freelancers/${id}`, {
      method: 'PATCH',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Falha ao atualizar dados do freelancer.');
    return res.json();
  },

  async adminBlockFreelancer(id: string): Promise<{ success: boolean; freelancer: Freelancer }> {
    const res = await fetch(`/api/admin/freelancers/${id}/block`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha ao bloquear freelancer.');
    return res.json();
  },

  async adminUnblockFreelancer(id: string): Promise<{ success: boolean; freelancer: Freelancer }> {
    const res = await fetch(`/api/admin/freelancers/${id}/unblock`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha ao desbloquear freelancer.');
    return res.json();
  },

  async adminRegenerateLink(id: string): Promise<{ success: boolean; accessCode: string; accessLink: string; freelancer: Freelancer }> {
    const res = await fetch(`/api/admin/freelancers/${id}/regenerate-link`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha ao regenerar link do freelancer.');
    return res.json();
  },

  async adminDeleteFreelancer(id: string): Promise<{ success: boolean; message?: string }> {
    // Somente a API autenticada pode apagar um freelancer e seus dados.
    // Não executar operações destrutivas diretamente no navegador.
    const res = await fetch(`/api/admin/freelancers/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    invalidateLeadsCache();

    // Se a sessão local pertencia a esse freelancer, encerra-a
    const session = getActiveFreelancerSession();
    if (session && (session.freelancer.id === id || session.freelancer.access_code === id)) {
      this.freelancerLogout();
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao excluir freelancer.');
    }
    return res.json();
  },

  async deleteLead(id: string): Promise<{ success: boolean }> {
    invalidateLeadsCache();
    const res = await fetch(`/api/leads/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao excluir lead.');
    }
    const data = await res.json();
    invalidateLeadsCache();
    return data;
  },

  async adminPurgeGlobalLeads(confirmation: string = 'ZERAR_TODOS_OS_LEADS'): Promise<{
    success: boolean;
    deletedCount: number;
    jobsCancelled: number;
    supabaseDeletedCount: number;
    message: string;
  }> {
    invalidateLeadsCache();
    const res = await fetch('/api/admin/leads/purge-global', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ confirmation }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Falha ao executar limpeza global de leads.');
    }
    const data = await res.json();
    invalidateLeadsCache();
    return data;
  },

  async deleteAllLeads(freelancer_id?: string, isGlobal = false): Promise<{ success: boolean; deletedCount: number; message: string }> {
    invalidateLeadsCache();
    const session = getActiveFreelancerSession();
    const targetFreelancerId = freelancer_id || session?.freelancer?.id;
    const isGlobalPurge = isGlobal || targetFreelancerId === 'ALL';

    // Constrói URL com parâmetros
    const queryParams = new URLSearchParams();
    if (isGlobalPurge) {
      queryParams.set('global', 'true');
      queryParams.set('freelancer_id', 'ALL');
    } else if (targetFreelancerId) {
      queryParams.set('freelancer_id', targetFreelancerId);
    }

    const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const res = await fetch(`/api/leads/all${queryStr}`, {
      method: 'DELETE',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        global: isGlobalPurge,
        freelancer_id: isGlobalPurge ? 'ALL' : targetFreelancerId,
        workspace_id: isGlobalPurge ? 'ALL' : targetFreelancerId,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao excluir todos os leads.');
    }
    const data = await res.json();
    invalidateLeadsCache();
    return data;
  },

  async adminGetFreelancerLeads(id: string): Promise<{ leads: Lead[]; total: number }> {
    const res = await fetch(`/api/admin/freelancers/${id}/leads`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Falha ao carregar os leads deste freelancer.');
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.leads) || typeof data.total !== 'number') {
      throw new Error('Resposta inválida ao carregar os leads do freelancer.');
    }
    return data;
  },

  async adminGetFreelancerSearches(id: string): Promise<SearchJob[]> {
    const res = await fetch(`/api/admin/freelancers/${id}/searches`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha ao carregar buscas do freelancer.');
    return res.json();
  },

  async adminGetFreelancerActivities(id: string): Promise<{ activities: Activity[]; total: number }> {
    const res = await fetch(`/api/admin/freelancers/${id}/activities`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha ao carregar atividades do freelancer.');
    return res.json();
  },

  async adminGetActivities(params?: {
    freelancer_id?: string;
    action_type?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ activities: Activity[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.freelancer_id) query.set('freelancer_id', params.freelancer_id);
    if (params?.action_type) query.set('action_type', params.action_type);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    const res = await fetch(`/api/admin/activities?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha ao carregar registro de auditoria.');
    return res.json();
  },

  // Auth legacy
  async login(email: string, pass: string) {
    return this.adminLogin(email, pass);
  },

  async getMe() {
    const res = await fetch('/api/auth/me', {
      headers: getAuthHeaders(),
    });
    return res.json();
  },

  // Ações Comerciais com Auditoria
  async recordContactAttempt(leadId: string, channel = 'WhatsApp') {
    const res = await fetch(`/api/leads/${leadId}/contact-attempt`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ channel }),
    });
    if (!res.ok) throw new Error('Falha ao registrar tentativa de contato.');
    return res.json();
  },

  async recordSale(leadId: string, value: number) {
    const res = await fetch(`/api/leads/${leadId}/register-sale`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ value }),
    });
    if (!res.ok) throw new Error('Falha ao registrar venda.');
    return res.json();
  },

  // Dashboard
  async getDashboardStats(freelancer_id?: string): Promise<DashboardStats> {
    const session = getActiveFreelancerSession();
    const targetFreelancerId = freelancer_id || session?.freelancer?.id;
    const url = targetFreelancerId && targetFreelancerId !== 'ALL'
      ? `/api/dashboard/stats?freelancer_id=${encodeURIComponent(targetFreelancerId)}`
      : '/api/dashboard/stats';
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Não foi possível carregar as estatísticas do dashboard.');
    }
    const data = await res.json();
    if (!data || typeof data.totalLeads !== 'number') {
      throw new Error('O servidor retornou estatísticas inválidas.');
    }
    return data;
  },

  // IBGE
  async getStates(): Promise<IBGEState[]> {
    try {
      const res = await fetch('/api/ibge/states');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
      }
    } catch {
      // Fallback
    }

    try {
      const ibgeRes = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome', {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3000),
      });
      if (ibgeRes.ok) {
        const data = (await ibgeRes.json()) as IBGEState[];
        if (Array.isArray(data) && data.length > 0) return data;
      }
    } catch {
      // Fallback
    }

    return BRAZILIAN_STATES;
  },

  async getCities(uf: string): Promise<IBGECity[]> {
    const cleanUf = (uf || 'SP').toUpperCase().trim();
    try {
      const res = await fetch(`/api/ibge/cities/${cleanUf}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
      }
    } catch {
      // Fallback
    }

    try {
      const ibgeRes = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${cleanUf}/municipios`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3000),
      });
      if (ibgeRes.ok) {
        const data = (await ibgeRes.json()) as IBGECity[];
        if (Array.isArray(data) && data.length > 0) {
          data.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
          return data;
        }
      }
    } catch {
      // Fallback
    }

    const popular = POPULAR_CITIES_BY_STATE[cleanUf] || ['Capital', 'Região Central', 'Interior'];
    return popular.map((nome, id) => ({ id: 1000 + id, nome }));
  },

  // Leads & Niches
  async getNiches(params?: { onlyFavorites?: boolean; freelancer_id?: string }): Promise<{ niche: string; count: number }[]> {
    try {
      const session = getActiveFreelancerSession();
      const targetFreelancerId = params?.freelancer_id || session?.freelancer?.id;
      const query = new URLSearchParams();
      if (params?.onlyFavorites) query.set('onlyFavorites', 'true');
      if (targetFreelancerId && targetFreelancerId !== 'ALL') query.set('freelancer_id', targetFreelancerId);
      const url = `/api/niches${query.toString() ? '?' + query.toString() : ''}`;
      const res = await fetch(url, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data;
        }
      }
    } catch (err) {
      console.warn('[API] /api/niches erro:', err);
    }
    return [];
  },

  async getStatesSummary(params?: { onlyFavorites?: boolean; niche?: string; freelancer_id?: string }): Promise<{ state: string; count: number }[]> {
    try {
      const session = getActiveFreelancerSession();
      const targetFreelancerId = params?.freelancer_id || session?.freelancer?.id;
      const query = new URLSearchParams();
      if (params?.onlyFavorites) query.set('onlyFavorites', 'true');
      if (params?.niche && params.niche !== 'ALL') query.set('niche', params.niche);
      if (targetFreelancerId && targetFreelancerId !== 'ALL') query.set('freelancer_id', targetFreelancerId);
      const url = `/api/states-summary${query.toString() ? '?' + query.toString() : ''}`;
      const res = await fetch(url, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data;
        }
      }
    } catch (err) {
      console.warn('[API] /api/states-summary erro:', err);
    }
    return [];
  },

  async getLeads(params: {
    search_job_id?: string;
    freelancer_id?: string;
    state?: string;
    city?: string;
    niche?: string;
    onlyWithoutWebsite?: boolean;
    onlyWithPhone?: boolean;
    onlyFavorites?: boolean;
    excludeHidden?: boolean;
    onlyHidden?: boolean;
    minRating?: number;
    maxRating?: number;
    minReviews?: number;
    minScore?: number;
    status?: string;
    search?: string;
    sortBy?: 'score' | 'reviews' | 'rating' | 'recent';
    page?: number;
    limit?: number;
  }): Promise<{ leads: Lead[]; total: number; page: number; totalPages: number }> {
    const session = getActiveFreelancerSession();
    const targetFreelancerId = params.freelancer_id || session?.freelancer?.id;
    const query = new URLSearchParams();
    if (params.search_job_id) query.set('search_job_id', params.search_job_id);
    if (params.state) query.set('state', params.state);
    if (params.city) query.set('city', params.city);
    if (params.niche) query.set('niche', params.niche);
    if (targetFreelancerId && targetFreelancerId !== 'ALL') query.set('freelancer_id', targetFreelancerId);
    if (params.onlyWithoutWebsite) query.set('onlyWithoutWebsite', 'true');
    if (params.onlyWithPhone) query.set('onlyWithPhone', 'true');
    if (params.onlyFavorites) query.set('onlyFavorites', 'true');
    if (params.excludeHidden) query.set('excludeHidden', 'true');
    if (params.onlyHidden) query.set('onlyHidden', 'true');
    if (params.minRating !== undefined && params.minRating !== null) query.set('minRating', String(params.minRating));
    if (params.maxRating !== undefined && params.maxRating !== null) query.set('maxRating', String(params.maxRating));
    if (params.minReviews) query.set('minReviews', String(params.minReviews));
    if (params.minScore) query.set('minScore', String(params.minScore));
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.page) query.set('page', String(params.page));
    if (params.limit !== undefined) query.set('limit', String(params.limit));

    // Evita respostas antigas após F5 e limita tempo de espera sem fingir lista vazia.
    const res = await fetch(`/api/leads?${query.toString()}`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || body.error || `Não foi possível buscar leads (HTTP ${res.status}).`);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.leads) || typeof data.total !== 'number') {
      throw new Error('O servidor retornou uma resposta inválida para a listagem de leads.');
    }
    // Falha na API nunca é substituída por persistência local.
    // Isso evita resultados divergentes e bypass do isolamento do workspace.
    return data;
  },

  async getLeadById(id: string): Promise<{ lead: Lead; notes: LeadNote[]; place?: Place }> {
    const res = await fetch(`/api/leads/${id}`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (res.ok) {
      return await res.json();
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Lead não encontrado.');
  },

  async updateLead(id: string, updates: Partial<Lead>): Promise<Lead> {
    const res = await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao atualizar lead.');
    }
    invalidateLeadsCache();
    return res.json();
  },

  async registerContactAttempt(id: string, channel: string = 'WhatsApp'): Promise<{ success: boolean; lead: Lead }> {
    const res = await fetch(`/api/leads/${id}/contact-attempt`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ channel }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao registrar tentativa de contato.');
    }
    invalidateLeadsCache();
    return res.json();
  },

  async registerSale(id: string, value: number): Promise<{ success: boolean; lead: Lead }> {
    const res = await fetch(`/api/leads/${id}/register-sale`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao registrar venda.');
    }
    invalidateLeadsCache();
    return res.json();
  },

  async toggleLeadFavorite(id: string): Promise<Lead> {
    const res = await fetch(`/api/leads/${id}/favorite`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao alterar favorito.');
    }
    invalidateLeadsCache();
    return res.json();
  },

  async toggleLeadHide(id: string, explicitValue?: boolean): Promise<Lead & { is_hidden: boolean }> {
    const res = await fetch(`/api/leads/${id}/hide`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(explicitValue !== undefined ? { is_hidden: explicitValue } : {}),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Não foi possível salvar a ocultação do lead. Tente novamente.');
    }
    const updated = await res.json() as Lead | null;
    if (!updated || updated.id !== id || typeof updated.is_hidden !== 'boolean' ||
      (explicitValue !== undefined && updated.is_hidden !== explicitValue)) {
      throw new Error('O servidor não confirmou a ocultação do lead. Atualize a lista e tente novamente.');
    }
    invalidateLeadsCache();
    return { ...updated, is_hidden: updated.is_hidden };
  },

  async addLeadNote(id: string, content: string): Promise<LeadNote> {
    const res = await fetch(`/api/leads/${id}/notes`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao salvar nota.');
    }
    return res.json();
  },

  // Pipeline
  async getPipeline(freelancer_id?: string): Promise<Record<PipelineStatus, Lead[]>> {
    const session = getActiveFreelancerSession();
    const targetFreelancerId = freelancer_id || session?.freelancer?.id;
    const url = targetFreelancerId && targetFreelancerId !== 'ALL'
      ? `/api/pipeline?freelancer_id=${encodeURIComponent(targetFreelancerId)}`
      : '/api/pipeline';
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || body.error || `Falha ao carregar pipeline (HTTP ${res.status}).`);
    }
    // Pipeline vazio é um estado válido. Não substituir por dados do navegador.
    return res.json();
  },

  async movePipelineLead(leadId: string, toStatus: PipelineStatus): Promise<Lead> {
    const res = await fetch('/api/pipeline/move', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ leadId, toStatus }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || body.error || 'Não foi possível alterar o estágio do lead.');
    }
    invalidateLeadsCache();
    return res.json();
  },

  invalidateLeadsCache() {
    invalidateLeadsCache();
  },

  // Search Jobs
  async createSearchJob(payload: {
    state: string;
    city: string;
    niche: string;
    freelancerId?: string;
    freelancerName?: string;
    filters: {
      onlyWithoutWebsite: boolean;
      onlyWithPhone: boolean;
      minRating: number;
      maxRating?: number;
      minReviews: number;
      maxReviews?: number;
      targetLeads?: number;
    };
  }): Promise<{ job: SearchJob; estimatedQueries: number; totalCities: number; totalAreas: number }> {
    const res = await fetch('/api/search-jobs', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || 'Falha ao iniciar busca.');
    }
    invalidateLeadsCache();
    return res.json();
  },

  async getSearchJobs(): Promise<SearchJob[]> {
    const res = await fetch('/api/search-jobs', { headers: getAuthHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Falha ao buscar o histórico de buscas.');
    }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('O servidor retornou buscas em formato inválido.');
    return data;
  },

  async getSearchJob(id: string): Promise<{ job: SearchJob; areas: SearchArea[]; queries: SearchQueryLog[] }> {
    const res = await fetch(`/api/search-jobs/${id}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha ao carregar busca.');
    return res.json();
  },

  async stepSearchJob(id: string): Promise<SearchJob> {
    const response = await fetch(`/api/search-jobs/${encodeURIComponent(id)}/step`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Não foi possível continuar a varredura.');
    }
    const data = await response.json();
    return data.job as SearchJob;
  },

  async pauseSearchJob(id: string): Promise<boolean> {
    const res = await fetch(`/api/search-jobs/${id}/pause`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return res.ok;
  },

  async resumeSearchJob(id: string): Promise<boolean> {
    const res = await fetch(`/api/search-jobs/${id}/resume`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return res.ok;
  },

  async cancelSearchJob(id: string): Promise<boolean> {
    const res = await fetch(`/api/search-jobs/${id}/cancel`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return res.ok;
  },

  // Settings
  async getSettings(): Promise<AppSettings & { maskedKey: string }> {
    try {
      const res = await fetch('/api/settings', {
        headers: getAuthHeaders(),
      });
      if (res.ok) return await res.json();
    } catch (err) {
      console.warn('[API] Falha ao buscar settings via API:', err);
    }
    return {
      googleMapsApiKey: '',
      hasCustomKey: true,
      maxResultsPerJob: 100,
      maxCitiesPerJob: 15,
      requestDelayMs: 600,
      scoringWeights: {
        noWebsite: 40,
        withPhone: 10,
        highRating: 20,
        reviewsOver50: 15,
        reviewsOver200: 10,
        activeProfile: 5,
      },
      maskedKey: 'AIzaSy...ec4',
    };
  },

  async updateSettings(settings: Partial<AppSettings>): Promise<{ success: boolean; settings: AppSettings }> {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('Falha ao salvar configurações.');
    return res.json();
  },

  async testApiKey(key: string): Promise<{ valid: boolean; error?: string; placesFound?: number; samplePlace?: string }> {
    const res = await fetch('/api/settings/test-key', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ key }),
    });
    return res.json();
  },

  async syncSupabase(): Promise<{ success: boolean; leadsCount: number; message: string }> {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha na sincronização.');
    return res.json();
  },
};
