import { DashboardStats, Lead, LeadNote, Place, SearchJob, SearchArea, SearchQueryLog, AppSettings, IBGEState, IBGECity, PipelineStatus } from '../types';

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
    const res = await fetch('/api/dashboard/stats');
    if (!res.ok) throw new Error('Falha ao carregar métricas.');
    return res.json();
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
    const query = new URLSearchParams();
    if (params?.onlyFavorites) query.set('onlyFavorites', 'true');
    const url = `/api/niches${query.toString() ? '?' + query.toString() : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Falha ao carregar nichos.');
    return res.json();
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
    if (!res.ok) throw new Error('Falha ao carregar leads.');
    return res.json();
  },

  async getLeadById(id: string): Promise<{ lead: Lead; notes: LeadNote[]; place?: Place }> {
    const res = await fetch(`/api/leads/${id}`);
    if (!res.ok) throw new Error('Lead não encontrado.');
    return res.json();
  },

  async updateLead(id: string, updates: Partial<Lead>): Promise<Lead> {
    const res = await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Falha ao atualizar lead.');
    return res.json();
  },

  async toggleLeadFavorite(id: string): Promise<Lead> {
    const res = await fetch(`/api/leads/${id}/favorite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Falha ao favoritar lead.');
    return res.json();
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
    const res = await fetch('/api/pipeline');
    if (!res.ok) throw new Error('Falha ao carregar pipeline.');
    return res.json();
  },

  async movePipelineLead(leadId: string, toStatus: PipelineStatus): Promise<Lead> {
    const res = await fetch('/api/pipeline/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, toStatus }),
    });
    if (!res.ok) throw new Error('Falha ao mover lead.');
    return res.json();
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
};
