import { DashboardStats, Lead, LeadNote, Place, SearchJob, SearchArea, SearchQueryLog, AppSettings, IBGEState, IBGECity, PipelineStatus } from '../types';
import {
  fetchAllLeadsFromFirestore,
  computeStatsFromLeads,
  filterLeadsList,
  syncLeadUpdateToFirestoreDirect,
} from './firebase/client';

export const api = {
  // Auth
  async login(email: string, pass: string) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao autenticar.');
    }
    return res.json();
  },

  async getMe() {
    const res = await fetch('/api/auth/me');
    return res.json();
  },

  // Dashboard
  async getDashboardStats(): Promise<DashboardStats> {
    try {
      const res = await fetch('/api/dashboard/stats');
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.totalLeads === 'number' && data.totalLeads > 0) {
          return data;
        }
      }
    } catch (err) {
      console.warn('[API] /api/dashboard/stats falhou, conectando diretamente ao Google Firestore...', err);
    }

    // Se o backend retornou 0 (ou falhou na Vercel), busca os dados reais diretamente do Firestore
    const leads = await fetchAllLeadsFromFirestore();
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
    const res = await fetch('/api/ibge/states');
    if (!res.ok) throw new Error('Falha ao carregar estados.');
    return res.json();
  },

  async getCities(uf: string): Promise<IBGECity[]> {
    const res = await fetch(`/api/ibge/cities/${uf}`);
    if (!res.ok) throw new Error('Falha ao carregar cidades.');
    return res.json();
  },

  // Leads & Niches
  async getNiches(params?: { onlyFavorites?: boolean }): Promise<{ niche: string; count: number }[]> {
    try {
      const query = new URLSearchParams();
      if (params?.onlyFavorites) query.set('onlyFavorites', 'true');
      const url = `/api/niches${query.toString() ? '?' + query.toString() : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data;
        }
      }
    } catch (err) {
      console.warn('[API] /api/niches falhou, calculando direto do Firestore...', err);
    }

    const allLeads = await fetchAllLeadsFromFirestore();
    let leads = allLeads;
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

  async getLeads(params: {
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
      const query = new URLSearchParams();
      if (params.state) query.set('state', params.state);
      if (params.city) query.set('city', params.city);
      if (params.niche) query.set('niche', params.niche);
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
      if (params.limit) query.set('limit', String(params.limit));

      const res = await fetch(`/api/leads?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.total === 'number' && data.total > 0) {
          return data;
        }
      }
    } catch (err) {
      console.warn('[API] Falha ao consultar /api/leads, buscando diretamente do Firestore...', err);
    }

    const allLeads = await fetchAllLeadsFromFirestore();
    return filterLeadsList(allLeads, params);
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
  async getPipeline(): Promise<Record<PipelineStatus, Lead[]>> {
    try {
      const res = await fetch('/api/pipeline');
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
    const board: Record<PipelineStatus, Lead[]> = {
      'NOVO': [],
      'PRÉVIA CRIADA': [],
      'CONTATADO': [],
      'RESPONDEU': [],
      'INTERESSADO': [],
      'REUNIÃO': [],
      'PROPOSTA': [],
      'FECHADO': [],
      'PERDIDO': [],
    };
    for (const l of allLeads) {
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
        headers: { 'Content-Type': 'application/json' },
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
    };
  }): Promise<{ job: SearchJob; estimatedQueries: number; totalCities: number; totalAreas: number }> {
    const res = await fetch('/api/search-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha ao iniciar busca.');
    }
    return res.json();
  },

  async getSearchJobs(): Promise<SearchJob[]> {
    const res = await fetch('/api/search-jobs');
    if (!res.ok) throw new Error('Falha ao listar buscas.');
    return res.json();
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
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error('Falha ao carregar configurações.');
    return res.json();
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
