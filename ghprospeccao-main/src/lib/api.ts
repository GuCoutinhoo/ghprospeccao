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
import { invalidateLeadsCache } from './firebase/client';

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
  async getPreviewLink(id:string):Promise<{path:string}>{return requestJson(`/api/leads/${encodeURIComponent(id)}/preview-link`,{method:'POST'});},
  async getPublicPreview(id:string,query:string):Promise<{lead:Lead}>{return requestJson(`/api/public-preview/${encodeURIComponent(id)}?${query}`);},
  async processSearchJob(id:string){return requestJson(`/api/search-jobs/${encodeURIComponent(id)}/process`,{method:'POST'});},
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
  }): Promise<{ success: boolean; freelancer: Freelancer; accessLink: string; temporaryPin?: string }> {
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

  async adminUpdateFreelancer(id: string, updates: Partial<Freelancer>): Promise<{ success: boolean; freelancer: Freelancer; temporaryPin?: string }> {
    const res = await fetch(`/api/admin/freelancers/${id}`, {
      method: 'PATCH',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(updates),
    });
    if (!res.ok) { const error = await res.json().catch(() => ({})); throw new Error(error.error || 'Falha ao atualizar dados do freelancer.'); }
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
    if (!res.ok) { const error = await res.json().catch(() => ({})); throw new Error(error.error || 'Falha ao desbloquear freelancer.'); }
    return res.json();
  },

  async adminRegenerateLink(id: string): Promise<{ success: boolean; accessCode: string; accessLink: string; freelancer: Freelancer; temporaryPin?: string }> {
    const res = await fetch(`/api/admin/freelancers/${id}/regenerate-link`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) { const error = await res.json().catch(() => ({})); throw new Error(error.error || 'Falha ao regenerar link do freelancer.'); }
    return res.json();
  },

  async adminDeleteFreelancer(id:string):Promise<{success:boolean;message?:string}>{return requestJson('/api/admin/freelancers/'+encodeURIComponent(id),{method:'DELETE'});},

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
    firestoreDeletedCount: number;
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

  async adminGetFreelancerLeads(id:string):Promise<{leads:Lead[];total:number}>{return requestJson('/api/admin/freelancers/'+encodeURIComponent(id)+'/leads');},

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
  async getDashboardStats(freelancer_id?:string):Promise<DashboardStats>{return requestJson('/api/dashboard/stats'+scopeQuery(freelancer_id));},

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
  async getNiches(params?:{onlyFavorites?:boolean;freelancer_id?:string}){return requestJson('/api/niches?'+new URLSearchParams(Object.entries(params||{}).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])));},

  async getStatesSummary(params?:{onlyFavorites?:boolean;freelancer_id?:string;niche?:string}){return requestJson('/api/states-summary?'+new URLSearchParams(Object.entries(params||{}).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])));},

  async getLeads(params: {freelancer_id?:string;search_job_id?:string;state?:string;city?:string;niche?:string;onlyWithoutWebsite?:boolean;onlyWithPhone?:boolean;onlyFavorites?:boolean;excludeHidden?:boolean;onlyHidden?:boolean;minRating?:number;minReviews?:number;minScore?:number;status?:string;search?:string;sortBy?:'score'|'reviews'|'rating'|'recent';page?:number;limit?:number}, signal?:AbortSignal): Promise<{leads:Lead[];total:number;page:number;totalPages:number}> {
 const query=new URLSearchParams();for(const [k,v] of Object.entries(params))if(v!==undefined)query.set(k,String(v));
 const data=await requestJson('/api/leads?'+query,{signal});
 if(!Array.isArray(data.leads)||!Number.isInteger(data.total)||data.total<0)throw new Error('Resposta de leads inválida.');return data;
 },

  async getLeadById(id: string): Promise<{ lead: Lead; notes: LeadNote[]; place?: Place }> {
    const res = await fetch(`/api/leads/${id}`, {
      headers: getAuthHeaders(),
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

  async toggleLeadHide(id: string, explicitValue?: boolean): Promise<Lead> {
    const res = await fetch(`/api/leads/${id}/hide`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(explicitValue !== undefined ? { is_hidden: explicitValue } : {}),
    });
    if (!res.ok) {
      // Fallback via PATCH
      return this.updateLead(id, { is_hidden: explicitValue !== undefined ? explicitValue : true });
    }
    invalidateLeadsCache();
    return res.json();
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
  async getPipeline(freelancer_id?:string):Promise<Record<PipelineStatus,Lead[]>>{return requestJson('/api/pipeline'+scopeQuery(freelancer_id));},

  async movePipelineLead(leadId:string,toStatus:PipelineStatus):Promise<Lead>{return requestJson('/api/pipeline/move',{method:'POST',body:JSON.stringify({leadId,toStatus})});},

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

  async getSearchJobs():Promise<SearchJob[]>{return requestJson('/api/search-jobs');},

  async getSearchJob(id: string): Promise<{ job: SearchJob; areas: SearchArea[]; queries: SearchQueryLog[] }> {
    const res = await fetch(`/api/search-jobs/${id}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha ao carregar busca.');
    return res.json();
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
  async getSettings():Promise<AppSettings & {maskedKey?:string}>{return requestJson('/api/settings');},

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

  async getMigrationsSql(): Promise<string> {
    const res = await fetch('/api/supabase/migrations',{headers:getAuthHeaders()});
    return res.text();
  },

  async syncFirestore(): Promise<{ success: boolean; leadsCount: number; message: string }> {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Falha na sincronização.');
    return res.json();
  },
};

function scopeQuery(id?:string){return id?'?freelancer_id='+encodeURIComponent(id):'';}
async function requestJson(url:string,options:RequestInit={}){const res=await fetch(url,{...options,cache:'no-store',headers:getAuthHeaders({'Content-Type':'application/json'})});if(!res.ok){const error=await res.json().catch(()=>({}));throw Object.assign(new Error(error.message||error.error||'Falha ao consultar o servidor.'),{status:res.status});}return res.json();}
