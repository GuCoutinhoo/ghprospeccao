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
import {
  fetchAllLeadsFromFirestore,
  computeStatsFromLeads,
  filterLeadsList,
  syncLeadUpdateToFirestoreDirect,
  invalidateLeadsCache,
} from './firebase/client';

export function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (typeof window === 'undefined') return headers;

  const adminToken = localStorage.getItem('gh_admin_token');
  const adminUser = localStorage.getItem('gh_admin_user');
  const freelancerToken = localStorage.getItem('gh_freelancer_token');

  // Se o usuário está autenticado como administrador mestre, sempre prioriza token de admin
  if (adminToken && adminUser) {
    headers['Authorization'] = `Bearer ${adminToken}`;
    return headers;
  }

  if (freelancerToken) {
    headers['Authorization'] = `Bearer ${freelancerToken}`;
    return headers;
  }

  headers['Authorization'] = `Bearer ${adminToken || 'admin_master_session_token'}`;
  return headers;
}

export function isFreelancerMode(): boolean {
  if (typeof window === 'undefined') return false;
  const adminUser = localStorage.getItem('gh_admin_user');
  if (adminUser) return false;
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
    } finally {
      localStorage.removeItem('gh_admin_token');
      localStorage.removeItem('gh_admin_user');
    }
    return { success: true };
  },

  // Freelancer Authentication & Workspace Access
  async verifyFreelancerLink(accessCode: string, pin?: string) {
    const res = await fetch('/api/freelancer/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessCode, pin }),
    });

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

  freelancerLogout() {
    localStorage.removeItem('gh_freelancer_token');
    localStorage.removeItem('gh_freelancer_session');
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
    const res = await fetch('/api/admin/freelancers', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao cadastrar freelancer.');
    }
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

  async adminDeleteFreelancer(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/admin/freelancers/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha ao excluir freelancer.');
    return res.json();
  },

  async adminGetFreelancerLeads(id: string): Promise<{ leads: Lead[]; total: number }> {
    const res = await fetch(`/api/admin/freelancers/${id}/leads`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha ao carregar leads do freelancer.');
    return res.json();
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
    try {
      const isFree = isFreelancerMode();
      const session = getActiveFreelancerSession();
      const targetFreelancerId = freelancer_id || (isFree ? session?.freelancer?.id : undefined);
      const url = targetFreelancerId && targetFreelancerId !== 'ALL'
        ? `/api/dashboard/stats?freelancer_id=${encodeURIComponent(targetFreelancerId)}`
        : '/api/dashboard/stats';
      const res = await fetch(url, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.totalLeads === 'number') {
          return data;
        }
      }
    } catch (err) {
      console.warn('[API] /api/dashboard/stats falhou, conectando diretamente ao Google Firestore...', err);
    }

    // Se o backend retornou 0 (ou falhou na Vercel), busca os dados reais diretamente do Firestore
    const allLeads = await fetchAllLeadsFromFirestore();
    let leads = allLeads;
    const isFree = isFreelancerMode();
    const session = getActiveFreelancerSession();
    const targetFreelancerId = freelancer_id || (isFree ? session?.freelancer?.id : undefined);
    if (targetFreelancerId && targetFreelancerId !== 'ALL') {
      leads = leads.filter((l) => l.freelancer_id === targetFreelancerId);
    }
    if (leads && leads.length > 0) {
      return computeStatsFromLeads(leads);
    }

    return {
      totalLeads: 0,
      newLeads: 0,
      contactedLeads: 0,
      interestedLeads: 0,
      closedLeads: 0,
      noWebsiteLeads: 0,
      withPhoneLeads: 0,
      responseRate: 0,
      closingRate: 0,
      leadsByDay: [],
      leadsByNiche: [],
      leadsByState: [],
      pipelineDistribution: [
        { status: 'NOVO', count: 0 },
        { status: 'PRÉVIA CRIADA', count: 0 },
        { status: 'CONTATADO', count: 0 },
        { status: 'RESPONDEU', count: 0 },
        { status: 'INTERESSADO', count: 0 },
        { status: 'REUNIÃO', count: 0 },
        { status: 'PROPOSTA', count: 0 },
        { status: 'FECHADO', count: 0 },
        { status: 'PERDIDO', count: 0 },
      ],
      topOpportunities: [],
    };
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
      const isFree = isFreelancerMode();
      const session = getActiveFreelancerSession();
      const targetFreelancerId = params?.freelancer_id || (isFree ? session?.freelancer?.id : undefined);
      const query = new URLSearchParams();
      if (params?.onlyFavorites) query.set('onlyFavorites', 'true');
      if (targetFreelancerId && targetFreelancerId !== 'ALL') query.set('freelancer_id', targetFreelancerId);
      const url = `/api/niches${query.toString() ? '?' + query.toString() : ''}`;
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
      console.warn('[API] /api/niches falhou, calculando direto do Firestore...', err);
    }

    const allLeads = await fetchAllLeadsFromFirestore();
    let leads = allLeads;
    const isFree = isFreelancerMode();
    const session = getActiveFreelancerSession();
    const targetFreelancerId = params?.freelancer_id || (isFree ? session?.freelancer?.id : undefined);
    if (targetFreelancerId && targetFreelancerId !== 'ALL') {
      leads = leads.filter((l) => l.freelancer_id === targetFreelancerId);
    }
    if (params?.onlyFavorites) {
      leads = leads.filter((l) => l.is_favorite === true);
    }
    const counts: Record<string, number> = {};
    for (const l of leads) {
      const n = l.niche || 'Geral';
      counts[n] = (counts[n] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([niche, count]) => ({ niche, count }))
      .sort((a, b) => b.count - a.count);
  },

  async getStatesSummary(params?: { onlyFavorites?: boolean; niche?: string; freelancer_id?: string }): Promise<{ state: string; count: number }[]> {
    try {
      const isFree = isFreelancerMode();
      const session = getActiveFreelancerSession();
      const targetFreelancerId = params?.freelancer_id || (isFree ? session?.freelancer?.id : undefined);
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
      console.warn('[API] /api/states-summary falhou, calculando direto do Firestore...', err);
    }

    const allLeads = await fetchAllLeadsFromFirestore();
    let leads = allLeads;
    const isFree = isFreelancerMode();
    const session = getActiveFreelancerSession();
    const targetFreelancerId = params?.freelancer_id || (isFree ? session?.freelancer?.id : undefined);
    if (targetFreelancerId && targetFreelancerId !== 'ALL') {
      leads = leads.filter((l) => l.freelancer_id === targetFreelancerId);
    }
    if (params?.onlyFavorites) {
      leads = leads.filter((l) => l.is_favorite === true);
    }
    if (params?.niche && params.niche !== 'ALL') {
      leads = leads.filter((l) => (l.niche || '').toLowerCase().includes(params.niche!.toLowerCase()));
    }
    const counts: Record<string, number> = {};
    for (const l of leads) {
      const s = (l.state || '').toUpperCase().trim();
      if (s) {
        counts[s] = (counts[s] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count);
  },

  async getLeads(params: {
    freelancer_id?: string;
    state?: string;
    city?: string;
    niche?: string;
    onlyWithoutWebsite?: boolean;
    onlyWithPhone?: boolean;
    onlyFavorites?: boolean;
    minRating?: number;
    minReviews?: number;
    minScore?: number;
    status?: string;
    search?: string;
    sortBy?: 'score' | 'reviews' | 'rating' | 'recent';
    page?: number;
    limit?: number;
  }): Promise<{ leads: Lead[]; total: number; page: number; totalPages: number }> {
    try {
      const isFree = isFreelancerMode();
      const session = getActiveFreelancerSession();
      const targetFreelancerId = params.freelancer_id || (isFree ? session?.freelancer?.id : undefined);
      const query = new URLSearchParams();
      if (params.state) query.set('state', params.state);
      if (params.city) query.set('city', params.city);
      if (params.niche) query.set('niche', params.niche);
      if (targetFreelancerId && targetFreelancerId !== 'ALL') query.set('freelancer_id', targetFreelancerId);
      if (params.onlyWithoutWebsite) query.set('onlyWithoutWebsite', 'true');
      if (params.onlyWithPhone) query.set('onlyWithPhone', 'true');
      if (params.onlyFavorites) query.set('onlyFavorites', 'true');
      if (params.minRating) query.set('minRating', String(params.minRating));
      if (params.minReviews) query.set('minReviews', String(params.minReviews));
      if (params.minScore) query.set('minScore', String(params.minScore));
      if (params.status) query.set('status', params.status);
      if (params.search) query.set('search', params.search);
      if (params.sortBy) query.set('sortBy', params.sortBy);
      if (params.page) query.set('page', String(params.page));
      if (params.limit !== undefined) query.set('limit', String(params.limit));

      const res = await fetch(`/api/leads?${query.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.leads) && typeof data.total === 'number') {
          return data;
        }
      }
    } catch (err) {
      console.warn('[API] Falha ao consultar /api/leads, buscando diretamente do Firestore...', err);
    }

    const allLeads = await fetchAllLeadsFromFirestore();
    const isFree = isFreelancerMode();
    const session = getActiveFreelancerSession();
    const effectiveParams = { ...params };
    const targetFreelancerId = effectiveParams.freelancer_id || (isFree ? session?.freelancer?.id : undefined);
    if (targetFreelancerId && targetFreelancerId !== 'ALL') {
      (effectiveParams as any).freelancer_id = targetFreelancerId;
    }
    return filterLeadsList(allLeads, effectiveParams);
  },

  async getLeadById(id: string): Promise<{ lead: Lead; notes: LeadNote[]; place?: Place }> {
    try {
      const res = await fetch(`/api/leads/${id}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('[API] Falha em /api/leads/:id, buscando do cache do Firestore...', err);
    }

    const allLeads = await fetchAllLeadsFromFirestore();
    const lead = allLeads.find((l) => l.id === id);
    if (lead) {
      return { lead, notes: [] };
    }
    throw new Error('Lead não encontrado.');
  },

  async updateLead(id: string, updates: Partial<Lead>): Promise<Lead> {
    syncLeadUpdateToFirestoreDirect(id, updates).catch(() => {});
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('[API] Falha ao atualizar via API, gravado no Firestore:', err);
    }
    return { id, ...updates } as Lead;
  },

  async registerContactAttempt(id: string, channel: string = 'WhatsApp'): Promise<{ success: boolean; lead: Lead }> {
    try {
      const res = await fetch(`/api/leads/${id}/contact-attempt`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ channel }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('[API] Falha em contact-attempt:', err);
    }
    const updated = await this.updateLead(id, {
      pipeline_status: 'CONTATADO',
      contacted_at: new Date().toISOString(),
    });
    return { success: true, lead: updated };
  },

  async registerSale(id: string, value: number): Promise<{ success: boolean; lead: Lead }> {
    try {
      const res = await fetch(`/api/leads/${id}/register-sale`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ value }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('[API] Falha em register-sale:', err);
    }
    const updated = await this.updateLead(id, {
      pipeline_status: 'FECHADO',
      sale_value: value,
      sale_date: new Date().toISOString(),
    });
    return { success: true, lead: updated };
  },

  async toggleLeadFavorite(id: string): Promise<Lead> {
    try {
      const res = await fetch(`/api/leads/${id}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const updated = await res.json();
        syncLeadUpdateToFirestoreDirect(id, { is_favorite: updated.is_favorite }).catch(() => {});
        return updated;
      }
    } catch (err) {
      console.warn('[API] Falha ao favoritar via API:', err);
    }
    syncLeadUpdateToFirestoreDirect(id, { is_favorite: true }).catch(() => {});
    return { id, is_favorite: true } as Lead;
  },

  async addLeadNote(id: string, content: string): Promise<LeadNote> {
    const res = await fetch(`/api/leads/${id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error('Falha ao salvar nota.');
    return res.json();
  },

  // Pipeline
  async getPipeline(freelancer_id?: string): Promise<Record<PipelineStatus, Lead[]>> {
    try {
      const session = getActiveFreelancerSession();
      const targetFreelancerId = freelancer_id || session?.freelancer?.id;
      const url = targetFreelancerId && targetFreelancerId !== 'ALL'
        ? `/api/pipeline?freelancer_id=${encodeURIComponent(targetFreelancerId)}`
        : '/api/pipeline';
      const res = await fetch(url, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const board = await res.json();
        const total = Object.values(board).reduce((acc: number, list: unknown) => acc + ((list as unknown[])?.length || 0), 0);
        if (total > 0) {
          return board;
        }
      }
    } catch (err) {
      console.warn('[API] Falha em /api/pipeline, montando do Firestore...', err);
    }

    const allLeads = await fetchAllLeadsFromFirestore();
    let leads = allLeads;
    const session = getActiveFreelancerSession();
    const targetFreelancerId = freelancer_id || session?.freelancer?.id;
    if (targetFreelancerId && targetFreelancerId !== 'ALL') {
      leads = leads.filter((l) => l.freelancer_id === targetFreelancerId);
    }
    const board: Record<PipelineStatus, Lead[]> = {
      'NOVO': [],
      'PRÉVIA CRIADA': [],
      'CONTATADO': [],
      'RESPONDEU': [],
      'INTERESSADO': [],
      'FOLLOW_UP': [],
      'NEGOCIACAO': [],
      'REUNIÃO': [],
      'PROPOSTA': [],
      'FECHADO': [],
      'PERDIDO': [],
      'NAO_INTERESSADO': [],
      'SEM_RESPOSTA': [],
    };
    for (const l of leads) {
      const st = (l.pipeline_status || 'NOVO') as PipelineStatus;
      if (board[st]) board[st].push(l);
      else board['NOVO'].push(l);
    }
    return board;
  },

  async movePipelineLead(leadId: string, toStatus: PipelineStatus): Promise<Lead> {
    const updates: Partial<Lead> = { pipeline_status: toStatus };
    if (toStatus === 'CONTATADO') {
      updates.contacted_at = new Date().toISOString();
    }
    syncLeadUpdateToFirestoreDirect(leadId, updates).catch(() => {});

    try {
      const res = await fetch('/api/pipeline/move', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ leadId, toStatus }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('[API] Falha ao mover via API, salvo no Firestore:', err);
    }
    return { id: leadId, ...updates } as Lead;
  },

  // Search Jobs
  async createSearchJob(payload: {
    state: string;
    city: string;
    niche: string;
    filters: {
      onlyWithoutWebsite: boolean;
      onlyWithPhone: boolean;
      minRating: number;
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
      throw new Error(err.error || 'Falha ao iniciar busca.');
    }
    invalidateLeadsCache();
    return res.json();
  },

  async getSearchJobs(): Promise<SearchJob[]> {
    try {
      const res = await fetch('/api/search-jobs', {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data;
      }
    } catch (err) {
      console.warn('[API] Falha ao buscar jobs via API:', err);
    }
    return [];
  },

  async getSearchJob(id: string): Promise<{ job: SearchJob; areas: SearchArea[]; queries: SearchQueryLog[] }> {
    const res = await fetch(`/api/search-jobs/${id}`);
    if (!res.ok) throw new Error('Falha ao carregar busca.');
    return res.json();
  },

  async pauseSearchJob(id: string): Promise<boolean> {
    const res = await fetch(`/api/search-jobs/${id}/pause`, { method: 'POST' });
    return res.ok;
  },

  async resumeSearchJob(id: string): Promise<boolean> {
    const res = await fetch(`/api/search-jobs/${id}/resume`, { method: 'POST' });
    return res.ok;
  },

  async cancelSearchJob(id: string): Promise<boolean> {
    const res = await fetch(`/api/search-jobs/${id}/cancel`, { method: 'POST' });
    return res.ok;
  },

  // Settings
  async getSettings(): Promise<AppSettings & { maskedKey: string }> {
    try {
      const res = await fetch('/api/settings');
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('Falha ao salvar configurações.');
    return res.json();
  },

  async testApiKey(key: string): Promise<{ valid: boolean; error?: string; placesFound?: number; samplePlace?: string }> {
    const res = await fetch('/api/settings/test-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    return res.json();
  },

  async getMigrationsSql(): Promise<string> {
    const res = await fetch('/api/supabase/migrations');
    return res.text();
  },

  async syncFirestore(): Promise<{ success: boolean; leadsCount: number; message: string }> {
    const res = await fetch('/api/sync', { method: 'POST' });
    if (!res.ok) throw new Error('Falha na sincronização.');
    return res.json();
  },
};
