import fs from 'fs';
import path from 'path';
import {
  Place,
  Lead,
  LeadNote,
  SearchJob,
  SearchArea,
  SearchQueryLog,
  AppSettings,
  DashboardStats,
  PipelineStatus,
} from '../../types';
import { calculateLeadScore, DEFAULT_SCORING_WEIGHTS } from '../scoring/leadScore';
import {
  fetchAllFromFirestore,
  syncLeadToFirestore,
  syncPlaceToFirestore,
  syncJobToFirestore,
  syncSettingsToFirestore,
} from '../firebase/sync';

interface DbSchema {
  places: Place[];
  leads: Lead[];
  lead_notes: LeadNote[];
  search_jobs: SearchJob[];
  search_areas: SearchArea[];
  search_queries: SearchQueryLog[];
  settings: AppSettings;
}

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const BUNDLED_DB_FILE = path.resolve(process.cwd(), '.data', 'db.json');
const DATA_DIR = isVercel ? path.join('/tmp', '.data') : path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const INITIAL_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_PLACES_API_KEY ||
  process.env.VITE_GOOGLE_MAPS_API_KEY ||
  'AIzaSyBjXeqBW89Kdk_s6oxccrGLJvRtcTP1ec4';

const INITIAL_SETTINGS: AppSettings = {
  googleMapsApiKey: INITIAL_KEY,
  hasCustomKey: Boolean(INITIAL_KEY && INITIAL_KEY.trim().length > 10),
  maxResultsPerJob: 100,
  maxCitiesPerJob: 15,
  requestDelayMs: 600,
  scoringWeights: DEFAULT_SCORING_WEIGHTS,
};

const SEED_PLACES: Place[] = [];

class Database {
  private data: DbSchema = {
    places: [],
    leads: [],
    lead_notes: [],
    search_jobs: [],
    search_areas: [],
    search_queries: [],
    settings: INITIAL_SETTINGS,
  };

  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.init();
  }

  private init() {
    try {
      // 1. Tentar ler do DB_FILE ativo (ou /tmp/.data/db.json na Vercel)
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        this.data.settings = { ...INITIAL_SETTINGS, ...(this.data.settings || {}) };
        this.initialized = true;
        return;
      }

      // 2. Se na Vercel /tmp ainda não tiver o arquivo, tentar copiar do bundle do projeto
      if (isVercel && fs.existsSync(BUNDLED_DB_FILE)) {
        try {
          if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
          }
          const bundledRaw = fs.readFileSync(BUNDLED_DB_FILE, 'utf-8');
          this.data = JSON.parse(bundledRaw);
          this.data.settings = { ...INITIAL_SETTINGS, ...(this.data.settings || {}) };
          fs.writeFileSync(DB_FILE, bundledRaw, 'utf-8');
          this.initialized = true;
          return;
        } catch (copyErr) {
          console.warn('[DB] Erro ao copiar DB inicial para /tmp:', copyErr);
        }
      }

      // 3. Fallback: criar diretório e inicializar
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      this.seedInitialData();
      this.save();
    } catch (err) {
      console.warn('[DB] Erro durante inicialização do banco, usando dados em memória:', err);
      this.seedInitialData();
    }
    this.initialized = true;

    // Sincroniza em background com o Google Cloud Firestore
    this.syncFromFirestore().catch(() => {});
  }

  public async ensureInitialized(): Promise<void> {
    if (this.initialized && this.data.leads && this.data.leads.length > 0) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      if (!this.initialized) {
        this.init();
      }
      // Se a base local estiver vazia (ex: na Vercel em cold start sem arquivo persistido),
      // busca imediatamente do Firestore em nuvem
      if (!this.data.leads || this.data.leads.length === 0) {
        console.log('[DB] Base local sem dados. Conectando e sincronizando com o Google Firestore...');
        await this.syncFromFirestore();
        console.log(`[DB] Firestore sincronizado: ${this.data.leads.length} leads carregados.`);
      }
    })().finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  public async syncFromFirestore(): Promise<{ leadsCount: number; placesCount: number }> {
    try {
      const remote = await fetchAllFromFirestore();
      if (remote) {
        if (remote.leads && remote.leads.length > 0) {
          this.data.leads = remote.leads;
        } else if (this.data.leads && this.data.leads.length > 0) {
          // Se nuvem estiver vazia, sincroniza dados locais para o Firestore
          for (const l of this.data.leads) {
            syncLeadToFirestore(l).catch(() => {});
          }
        }

        if (remote.places && remote.places.length > 0) {
          this.data.places = remote.places;
        } else if (this.data.places && this.data.places.length > 0) {
          for (const p of this.data.places) {
            syncPlaceToFirestore(p).catch(() => {});
          }
        }

        if (remote.jobs && remote.jobs.length > 0) {
          this.data.search_jobs = remote.jobs;
        }
        if (remote.settings) {
          this.data.settings = { ...this.data.settings, ...remote.settings };
        }
        this.save();
      }
      return {
        leadsCount: this.data.leads.length,
        placesCount: this.data.places.length,
      };
    } catch (err) {
      console.warn('[DB] Falha na sincronização inicial do Firestore:', err);
      return {
        leadsCount: this.data.leads.length,
        placesCount: this.data.places.length,
      };
    }
  }

  private seedInitialData() {
    this.data.places = [];
    this.data.leads = [];
    this.data.lead_notes = [];
    this.data.search_jobs = [];
    this.data.search_areas = [];
    this.data.search_queries = [];
    this.data.settings = INITIAL_SETTINGS;
  }

  private save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[DB] Não foi possível persistir no disco (ambiente somente leitura/serverless). Mantendo dados na memória:', err);
    }
  }

  // --- PLACES ---
  public upsertPlace(place: Place): { place: Place; isNew: boolean } {
    const existingIndex = this.data.places.findIndex((p) => p.place_id === place.place_id);
    if (existingIndex >= 0) {
      // Atualiza mantendo id e campos existentes
      this.data.places[existingIndex] = {
        ...this.data.places[existingIndex],
        ...place,
        updated_at: new Date().toISOString(),
      };
      this.save();
      syncPlaceToFirestore(this.data.places[existingIndex]).catch(() => {});
      return { place: this.data.places[existingIndex], isNew: false };
    } else {
      this.data.places.push(place);
      this.save();
      syncPlaceToFirestore(place).catch(() => {});
      return { place, isNew: true };
    }
  }

  public getPlaceByPlaceId(placeId: string): Place | undefined {
    return this.data.places.find((p) => p.place_id === placeId);
  }

  // --- LEADS ---
  public createLead(lead: Lead): { lead: Lead; created: boolean } {
    // Deduplicação comercial: único por user_id + place_id + niche
    const exists = this.data.leads.some(
      (l) => l.user_id === lead.user_id && l.place_id === lead.place_id && l.niche.toLowerCase() === lead.niche.toLowerCase()
    );
    if (exists) {
      return { lead, created: false };
    }

    this.data.leads.unshift(lead);
    this.save();
    syncLeadToFirestore(lead).catch(() => {});
    return { lead, created: true };
  }

  public getLeads(params: {
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
  }): { leads: Lead[]; total: number; page: number; totalPages: number } {
    let filtered = [...this.data.leads];

    if (params.state && params.state !== 'ALL') {
      const targetState = params.state.toUpperCase().trim();
      filtered = filtered.filter((l) => {
        const ls = (l.state || '').toUpperCase().trim();
        if (ls === targetState) return true;
        if (targetState === 'SP' && (ls.includes('SÃO PAULO') || ls.includes('SAO PAULO'))) return true;
        if (targetState === 'RJ' && ls.includes('RIO DE JANEIRO')) return true;
        if (targetState === 'MG' && ls.includes('MINAS GERAIS')) return true;
        if (targetState === 'ES' && (ls.includes('ESPÍRITO SANTO') || ls.includes('ESPIRITO SANTO'))) return true;
        if (targetState === 'PR' && (ls.includes('PARANÁ') || ls.includes('PARANA'))) return true;
        if (targetState === 'SC' && ls.includes('SANTA CATARINA')) return true;
        if (targetState === 'RS' && ls.includes('RIO GRANDE DO SUL')) return true;
        return false;
      });
    }

    if (params.city && params.city !== 'ALL') {
      filtered = filtered.filter((l) => l.city.toLowerCase() === params.city!.toLowerCase());
    }

    if (params.niche && params.niche !== 'ALL') {
      filtered = filtered.filter((l) => l.niche.toLowerCase().includes(params.niche!.toLowerCase()));
    }

    if (params.status && params.status !== 'ALL') {
      filtered = filtered.filter((l) => l.pipeline_status === params.status);
    }

    if (params.onlyWithoutWebsite) {
      filtered = filtered.filter((l) => l.website_status === 'no_website' || !l.website);
    }

    if (params.onlyWithPhone) {
      filtered = filtered.filter((l) => Boolean(l.phone && l.phone.trim().length >= 8));
    }

    if (params.onlyFavorites) {
      filtered = filtered.filter((l) => l.is_favorite === true);
    }

    if (params.minRating) {
      filtered = filtered.filter((l) => l.rating >= params.minRating!);
    }

    if (params.minReviews) {
      filtered = filtered.filter((l) => l.reviews_count >= params.minReviews!);
    }

    if (params.minScore) {
      filtered = filtered.filter((l) => l.lead_score >= params.minScore!);
    }

    if (params.search && params.search.trim() !== '') {
      const q = params.search.toLowerCase().trim();
      filtered = filtered.filter((l) =>
        l.name.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q) ||
        (l.phone && l.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '')))
      );
    }

    // Ordenação
    const sortBy = params.sortBy || 'score';
    filtered.sort((a, b) => {
      if (sortBy === 'score') return b.lead_score - a.lead_score;
      if (sortBy === 'reviews') return b.reviews_count - a.reviews_count;
      if (sortBy === 'rating') return b.rating - a.rating;
      if (sortBy === 'recent') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return b.lead_score - a.lead_score;
    });

    const total = filtered.length;
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(params.limit || 50, 100));
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit);

    return { leads: paginated, total, page, totalPages };
  }

  public getNichesSummary(params?: { onlyFavorites?: boolean }): { niche: string; count: number }[] {
    const counts: Record<string, number> = {};
    let leads = this.data.leads;
    if (params?.onlyFavorites) {
      leads = leads.filter((l) => l.is_favorite === true);
    }
    for (const lead of leads) {
      const n = lead.niche || 'Geral';
      counts[n] = (counts[n] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([niche, count]) => ({ niche, count }))
      .sort((a, b) => b.count - a.count);
  }

  public getStatesSummary(params?: { onlyFavorites?: boolean; niche?: string }): { state: string; count: number }[] {
    const counts: Record<string, number> = {};
    let leads = this.data.leads;
    if (params?.onlyFavorites) {
      leads = leads.filter((l) => l.is_favorite === true);
    }
    if (params?.niche && params.niche !== 'ALL') {
      leads = leads.filter((l) => (l.niche || '').toLowerCase().includes(params.niche!.toLowerCase()));
    }
    for (const lead of leads) {
      const s = (lead.state || '').toUpperCase().trim();
      if (s) {
        counts[s] = (counts[s] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count);
  }

  public getLeadById(id: string): Lead | undefined {
    return this.data.leads.find((l) => l.id === id);
  }

  public updateLead(id: string, updates: Partial<Lead>): Lead | undefined {
    const idx = this.data.leads.findIndex((l) => l.id === id);
    if (idx === -1) return undefined;

    this.data.leads[idx] = {
      ...this.data.leads[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save();
    syncLeadToFirestore(this.data.leads[idx]).catch(() => {});
    return this.data.leads[idx];
  }

  public toggleFavoriteLead(id: string): Lead | undefined {
    const idx = this.data.leads.findIndex((l) => l.id === id);
    if (idx === -1) return undefined;

    const current = Boolean(this.data.leads[idx].is_favorite);
    this.data.leads[idx].is_favorite = !current;
    this.data.leads[idx].updated_at = new Date().toISOString();
    this.save();
    syncLeadToFirestore(this.data.leads[idx]).catch(() => {});
    return this.data.leads[idx];
  }

  public addLeadNote(leadId: string, userId: string, content: string): LeadNote {
    const note: LeadNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      lead_id: leadId,
      user_id: userId,
      content,
      created_at: new Date().toISOString(),
    };
    this.data.lead_notes.unshift(note);
    this.save();
    return note;
  }

  public getLeadNotes(leadId: string): LeadNote[] {
    return this.data.lead_notes.filter((n) => n.lead_id === leadId);
  }

  // --- PIPELINE ---
  public getPipelineBoard(): Record<PipelineStatus, Lead[]> {
    const columns: Record<PipelineStatus, Lead[]> = {
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

    // Ordenar leads por score decrescente dentro de cada coluna
    for (const lead of this.data.leads) {
      if (columns[lead.pipeline_status]) {
        columns[lead.pipeline_status].push(lead);
      } else {
        columns['NOVO'].push(lead);
      }
    }

    for (const key of Object.keys(columns) as PipelineStatus[]) {
      columns[key].sort((a, b) => b.lead_score - a.lead_score);
    }

    return columns;
  }

  // --- DASHBOARD ---
  public getDashboardStats(): DashboardStats {
    const leads = this.data.leads;
    const totalLeads = leads.length;
    const newLeads = leads.filter((l) => l.pipeline_status === 'NOVO').length;
    const contactedLeads = leads.filter((l) => l.pipeline_status === 'CONTATADO').length;
    const interestedLeads = leads.filter((l) => l.pipeline_status === 'INTERESSADO').length;
    const closedLeads = leads.filter((l) => l.pipeline_status === 'FECHADO').length;
    const noWebsiteLeads = leads.filter((l) => l.website_status === 'no_website' || !l.website).length;
    const withPhoneLeads = leads.filter((l) => Boolean(l.phone && l.phone.trim().length >= 8)).length;

    const contactedOrMore = leads.filter((l) => ['CONTATADO', 'RESPONDEU', 'INTERESSADO', 'REUNIÃO', 'PROPOSTA', 'FECHADO'].includes(l.pipeline_status)).length;
    const respondedOrMore = leads.filter((l) => ['RESPONDEU', 'INTERESSADO', 'REUNIÃO', 'PROPOSTA', 'FECHADO'].includes(l.pipeline_status)).length;

    const responseRate = contactedOrMore > 0 ? Math.round((respondedOrMore / contactedOrMore) * 100) : 0;
    const closingRate = totalLeads > 0 ? Math.round((closedLeads / totalLeads) * 100) : 0;

    // Leads por nicho
    const nicheCount: Record<string, number> = {};
    for (const l of leads) {
      nicheCount[l.niche] = (nicheCount[l.niche] || 0) + 1;
    }
    const leadsByNiche = Object.entries(nicheCount)
      .map(([niche, count]) => ({ niche, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Leads por estado
    const stateCount: Record<string, number> = {};
    for (const l of leads) {
      stateCount[l.state] = (stateCount[l.state] || 0) + 1;
    }
    const leadsByState = Object.entries(stateCount)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Leads por dia (últimos 7 dias)
    const days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const str = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      days.push({ date: str, count: 0 });
    }
    for (const l of leads) {
      const lDate = new Date(l.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const found = days.find((d) => d.date === lDate);
      if (found) {
        found.count += 1;
      }
    }

    const pipelineStatuses: PipelineStatus[] = ['NOVO', 'PRÉVIA CRIADA', 'CONTATADO', 'RESPONDEU', 'INTERESSADO', 'REUNIÃO', 'PROPOSTA', 'FECHADO', 'PERDIDO'];
    const pipelineDistribution = pipelineStatuses.map((st) => ({
      status: st,
      count: leads.filter((l) => l.pipeline_status === st).length,
    }));

    // Melhores oportunidades recentes (alta prioridade, score >= 70)
    const topOpportunities = [...leads]
      .filter((l) => l.pipeline_status === 'NOVO' || l.pipeline_status === 'PRÉVIA CRIADA')
      .sort((a, b) => b.lead_score - a.lead_score)
      .slice(0, 5);

    return {
      totalLeads,
      newLeads,
      contactedLeads,
      interestedLeads,
      closedLeads,
      noWebsiteLeads,
      withPhoneLeads,
      responseRate,
      closingRate,
      leadsByDay: days,
      leadsByNiche,
      leadsByState,
      pipelineDistribution,
      topOpportunities,
    };
  }

  // --- SEARCH JOBS ---
  public createSearchJob(job: SearchJob): SearchJob {
    this.data.search_jobs.unshift(job);
    this.save();
    syncJobToFirestore(job).catch(() => {});
    return job;
  }

  public getSearchJob(id: string): SearchJob | undefined {
    return this.data.search_jobs.find((j) => j.id === id);
  }

  public getAllSearchJobs(): SearchJob[] {
    return [...this.data.search_jobs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  public updateSearchJob(id: string, updates: Partial<SearchJob>): SearchJob | undefined {
    const idx = this.data.search_jobs.findIndex((j) => j.id === id);
    if (idx === -1) return undefined;

    this.data.search_jobs[idx] = {
      ...this.data.search_jobs[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.save();
    syncJobToFirestore(this.data.search_jobs[idx]).catch(() => {});
    return this.data.search_jobs[idx];
  }

  public addSearchAreas(areas: SearchArea[]) {
    this.data.search_areas.push(...areas);
    this.save();
  }

  public getSearchAreas(jobId: string): SearchArea[] {
    return this.data.search_areas.filter((a) => a.search_job_id === jobId);
  }

  public updateSearchArea(id: string, updates: Partial<SearchArea>) {
    const idx = this.data.search_areas.findIndex((a) => a.id === id);
    if (idx !== -1) {
      this.data.search_areas[idx] = { ...this.data.search_areas[idx], ...updates };
      this.save();
    }
  }

  public logSearchQuery(queryLog: SearchQueryLog) {
    this.data.search_queries.unshift(queryLog);
    // Limita log a 500 registros para economizar memória
    if (this.data.search_queries.length > 500) {
      this.data.search_queries.pop();
    }
    this.save();
  }

  public getSearchQueries(jobId: string): SearchQueryLog[] {
    return this.data.search_queries.filter((q) => q.search_job_id === jobId);
  }

  // --- SETTINGS ---
  public getSettings(): AppSettings {
    const currentApiKey =
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_PLACES_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      this.data.settings.googleMapsApiKey;
    return {
      ...this.data.settings,
      googleMapsApiKey: currentApiKey,
      hasCustomKey: Boolean(currentApiKey && currentApiKey.trim() !== ''),
    };
  }

  public updateSettings(updates: Partial<AppSettings>): AppSettings {
    const key = updates.googleMapsApiKey !== undefined ? updates.googleMapsApiKey : this.data.settings.googleMapsApiKey;
    this.data.settings = {
      ...this.data.settings,
      ...updates,
      hasCustomKey: Boolean(key && key.trim() !== ''),
    };
    if (updates.googleMapsApiKey !== undefined) {
      process.env.GOOGLE_MAPS_API_KEY = updates.googleMapsApiKey;
      process.env.GOOGLE_PLACES_API_KEY = updates.googleMapsApiKey;
    }
    this.save();
    syncSettingsToFirestore(this.data.settings).catch(() => {});
    return this.getSettings();
  }
}

export const db = new Database();
