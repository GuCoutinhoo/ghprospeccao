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
  Freelancer,
  FreelancerStatus,
  Activity,
  FreelancerPerformance,
  AdminDashboardStats,
} from '../../types';
import { calculateLeadScore, DEFAULT_SCORING_WEIGHTS } from '../scoring/leadScore';
import {
  fetchAllFromFirestore,
  syncLeadToFirestore,
  syncPlaceToFirestore,
  syncJobToFirestore,
  syncSettingsToFirestore,
  syncFreelancerToFirestore,
  deleteFreelancerFromFirestore,
  syncActivityToFirestore,
} from '../firebase/sync';

function normalizeStr(str?: string | null): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function slugifyFreelancerName(name?: string | null): string {
  if (!name) return 'freelancer';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'freelancer';
}

function generateAccessCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

interface DbSchema {
  places: Place[];
  leads: Lead[];
  lead_notes: LeadNote[];
  search_jobs: SearchJob[];
  search_areas: SearchArea[];
  search_queries: SearchQueryLog[];
  settings: AppSettings;
  freelancers: Freelancer[];
  activities: Activity[];
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
  maxResultsPerJob: 0, // 0 = Sem limite
  maxCitiesPerJob: 0, // 0 = Sem limite
  requestDelayMs: 400,
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
    freelancers: [],
    activities: [],
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
        if (!this.data.freelancers) this.data.freelancers = [];
        if (!this.data.activities) this.data.activities = [];

        // Filtra apenas freelancers inválidos/sem id se houver
        this.data.freelancers = (this.data.freelancers || []).filter((f) => f && f.id && f.name);
        this.data.activities = (this.data.activities || []).filter((a) => a && a.id);

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
    if (this.initialized && this.data.leads && this.data.leads.length > 0 && this.data.freelancers && this.data.freelancers.length > 1) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      if (!this.initialized) {
        this.init();
      }
      try {
        await this.syncFromFirestore();
      } catch (syncErr) {
        console.warn('[DB] Erro ao sincronizar inicialização com Firestore:', syncErr);
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
        // MERGE LEADS de forma segura (sem sobrescrever leads recém-criados localmente)
        const leadMap = new Map<string, Lead>();
        for (const l of remote.leads || []) {
          if (l && l.id) leadMap.set(l.id, l);
        }
        for (const l of this.data.leads || []) {
          if (!l || !l.id) continue;
          const existing = leadMap.get(l.id);
          if (!existing) {
            leadMap.set(l.id, l);
            syncLeadToFirestore(l).catch(() => {});
          } else {
            const localTime = new Date(l.updated_at || l.created_at || 0).getTime();
            const remoteTime = new Date(existing.updated_at || existing.created_at || 0).getTime();
            if (localTime >= remoteTime) {
              leadMap.set(l.id, l);
            }
          }
        }
        this.data.leads = Array.from(leadMap.values());

        // MERGE PLACES
        const placeMap = new Map<string, Place>();
        for (const p of remote.places || []) {
          if (p && p.id) placeMap.set(p.id, p);
        }
        for (const p of this.data.places || []) {
          if (!p || !p.id) continue;
          if (!placeMap.has(p.id)) {
            placeMap.set(p.id, p);
            syncPlaceToFirestore(p).catch(() => {});
          }
        }
        this.data.places = Array.from(placeMap.values());

        // MERGE JOBS
        const jobMap = new Map<string, SearchJob>();
        for (const j of remote.jobs || []) {
          if (j && j.id) jobMap.set(j.id, j);
        }
        for (const j of this.data.search_jobs || []) {
          if (!j || !j.id) continue;
          const existing = jobMap.get(j.id);
          if (!existing) {
            jobMap.set(j.id, j);
            syncJobToFirestore(j).catch(() => {});
          } else {
            const localTime = new Date(j.updated_at || j.created_at || 0).getTime();
            const remoteTime = new Date(existing.updated_at || existing.created_at || 0).getTime();
            if (localTime >= remoteTime) {
              jobMap.set(j.id, j);
            }
          }
        }
        this.data.search_jobs = Array.from(jobMap.values());

        // MERGE FREELANCERS
        const demoFreeIds = ['free_7F4K92XQ', 'free_8HKS82MD', 'free_9YPL21BZ', 'free_4TRM67KV'];
        if (remote.freelancers && remote.freelancers.length > 0) {
          const freeMap = new Map<string, Freelancer>();
          for (const f of remote.freelancers) {
            if (f && f.id && !demoFreeIds.includes(f.id)) freeMap.set(f.id, f);
            else if (f && f.id && demoFreeIds.includes(f.id)) {
              deleteFreelancerFromFirestore(f.id).catch(() => {});
            }
          }
          for (const f of this.data.freelancers || []) {
            if (!f || !f.id || demoFreeIds.includes(f.id)) continue;
            if (!freeMap.has(f.id)) {
              freeMap.set(f.id, f);
              syncFreelancerToFirestore(f).catch(() => {});
            }
          }
          this.data.freelancers = Array.from(freeMap.values());
        } else {
          this.data.freelancers = (this.data.freelancers || []).filter((f) => !demoFreeIds.includes(f.id));
        }

        // MERGE ACTIVITIES
        if (remote.activities && remote.activities.length > 0) {
          const actMap = new Map<string, Activity>();
          for (const a of remote.activities) {
            if (a && a.id && !demoFreeIds.includes(a.freelancer_id) && !['act_1', 'act_2', 'act_3', 'act_4', 'act_5', 'act_6', 'act_7'].includes(a.id)) {
              actMap.set(a.id, a);
            }
          }
          for (const a of this.data.activities || []) {
            if (!a || !a.id || demoFreeIds.includes(a.freelancer_id) || ['act_1', 'act_2', 'act_3', 'act_4', 'act_5', 'act_6', 'act_7'].includes(a.id)) continue;
            if (!actMap.has(a.id)) {
              actMap.set(a.id, a);
              syncActivityToFirestore(a).catch(() => {});
            }
          }
          this.data.activities = Array.from(actMap.values()).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        } else {
          this.data.activities = (this.data.activities || []).filter(
            (a) => !demoFreeIds.includes(a.freelancer_id) && !['act_1', 'act_2', 'act_3', 'act_4', 'act_5', 'act_6', 'act_7'].includes(a.id)
          );
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
      console.warn('[DB] Falha na sincronização do Firestore:', err);
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
    this.data.freelancers = [];
    this.data.activities = [];
    this.data.settings = INITIAL_SETTINGS;
    this.seedInitialFreelancers();
  }

  private seedInitialFreelancers() {
    this.data.freelancers = [];
    this.data.activities = [];
  }

  public removeAllFreelancers(): void {
    const list = [...(this.data.freelancers || [])];
    for (const f of list) {
      deleteFreelancerFromFirestore(f.id).catch(() => {});
    }
    this.data.freelancers = [];
    this.data.activities = [];

    // Limpa vínculos de leads e jobs com freelancers
    for (const l of this.data.leads || []) {
      delete l.freelancer_id;
      delete l.freelancer_name;
    }
    for (const j of this.data.search_jobs || []) {
      delete j.freelancer_id;
      delete j.freelancer_name;
    }
    this.save();
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
    // Deduplicação comercial: único por place_id + niche + escopo do freelancer
    const normNiche = normalizeStr(lead.niche);
    const scope = lead.freelancer_id || lead.user_id || 'default_user_1';
    const existingIndex = this.data.leads.findIndex(
      (l) => l.place_id === lead.place_id && normalizeStr(l.niche) === normNiche && (l.freelancer_id || l.user_id || 'default_user_1') === scope
    );
    if (existingIndex >= 0) {
      const prev = this.data.leads[existingIndex];
      this.data.leads[existingIndex] = {
        ...prev,
        ...lead,
        pipeline_status: prev.pipeline_status || lead.pipeline_status,
        is_favorite: prev.is_favorite ?? lead.is_favorite,
        updated_at: new Date().toISOString(),
      };
      this.save();
      syncLeadToFirestore(this.data.leads[existingIndex]).catch(() => {});
      return { lead: this.data.leads[existingIndex], created: false };
    }

    this.data.leads.unshift(lead);
    this.save();
    syncLeadToFirestore(lead).catch(() => {});
    return { lead, created: true };
  }

  public getLeads(params: {
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
  }): { leads: Lead[]; total: number; page: number; totalPages: number } {
    let filtered = [...this.data.leads];

    if (params.freelancer_id && params.freelancer_id !== 'ALL') {
      filtered = filtered.filter((l) => l.freelancer_id === params.freelancer_id);
    }

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
      const targetCity = normalizeStr(params.city);
      filtered = filtered.filter((l) => normalizeStr(l.city) === targetCity);
    }

    if (params.niche && params.niche !== 'ALL') {
      const targetNiche = normalizeStr(params.niche);
      filtered = filtered.filter((l) => {
        const ln = normalizeStr(l.niche);
        return ln.includes(targetNiche) || targetNiche.includes(ln);
      });
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
      const q = normalizeStr(params.search);
      filtered = filtered.filter((l) =>
        normalizeStr(l.name).includes(q) ||
        normalizeStr(l.city).includes(q) ||
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
    const isUnlimited = params.limit === 0 || params.limit === -1 || (typeof params.limit === 'string' && (params.limit === 'all' || params.limit === '0'));
    const limit = isUnlimited ? Math.max(1, total) : Math.max(1, params.limit || 50);
    const totalPages = isUnlimited ? 1 : (Math.ceil(total / limit) || 1);
    const offset = isUnlimited ? 0 : (page - 1) * limit;
    const paginated = isUnlimited ? filtered : filtered.slice(offset, offset + limit);

    return { leads: paginated, total, page, totalPages };
  }

  public getNichesSummary(params?: { onlyFavorites?: boolean; freelancer_id?: string }): { niche: string; count: number }[] {
    const counts: Record<string, { display: string; count: number }> = {};
    let leads = this.data.leads;
    if (params?.freelancer_id && params.freelancer_id !== 'ALL') {
      leads = leads.filter((l) => l.freelancer_id === params.freelancer_id);
    }
    if (params?.onlyFavorites) {
      leads = leads.filter((l) => l.is_favorite === true);
    }
    for (const lead of leads) {
      const n = (lead.niche || 'Geral').trim();
      const norm = normalizeStr(n);
      if (!counts[norm]) {
        counts[norm] = { display: n, count: 0 };
      }
      counts[norm].count++;
    }
    return Object.values(counts)
      .map(({ display, count }) => ({ niche: display, count }))
      .sort((a, b) => b.count - a.count);
  }

  public getStatesSummary(params?: { onlyFavorites?: boolean; niche?: string; freelancer_id?: string }): { state: string; count: number }[] {
    const counts: Record<string, number> = {};
    let leads = this.data.leads;
    if (params?.freelancer_id && params.freelancer_id !== 'ALL') {
      leads = leads.filter((l) => l.freelancer_id === params.freelancer_id);
    }
    if (params?.onlyFavorites) {
      leads = leads.filter((l) => l.is_favorite === true);
    }
    if (params?.niche && params.niche !== 'ALL') {
      const targetNiche = normalizeStr(params.niche);
      leads = leads.filter((l) => {
        const ln = normalizeStr(l.niche);
        return ln.includes(targetNiche) || targetNiche.includes(ln);
      });
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

  public updateLead(id: string, updates: Partial<Lead>, freelancer_id?: string): Lead | undefined {
    const idx = this.data.leads.findIndex((l) => l.id === id);
    if (idx === -1) return undefined;

    if (freelancer_id && this.data.leads[idx].freelancer_id && this.data.leads[idx].freelancer_id !== freelancer_id) {
      return undefined;
    }

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
  public getPipelineBoard(freelancer_id?: string): Record<PipelineStatus, Lead[]> {
    const columns: Record<PipelineStatus, Lead[]> = {
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

    let list = this.data.leads;
    if (freelancer_id && freelancer_id !== 'ALL') {
      list = list.filter((l) => l.freelancer_id === freelancer_id);
    }

    // Ordenar leads por score decrescente dentro de cada coluna
    for (const lead of list) {
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
  public getDashboardStats(freelancer_id?: string): DashboardStats {
    let leads = this.data.leads;
    if (freelancer_id && freelancer_id !== 'ALL') {
      leads = leads.filter((l) => l.freelancer_id === freelancer_id);
    }
    const totalLeads = leads.length;
    const newLeads = leads.filter((l) => l.pipeline_status === 'NOVO').length;
    const contactedLeads = leads.filter((l) => l.pipeline_status === 'CONTATADO').length;
    const interestedLeads = leads.filter((l) => l.pipeline_status === 'INTERESSADO' || l.pipeline_status === 'NEGOCIACAO').length;
    const closedLeads = leads.filter((l) => l.pipeline_status === 'FECHADO').length;
    const noWebsiteLeads = leads.filter((l) => l.website_status === 'no_website' || !l.website).length;
    const withPhoneLeads = leads.filter((l) => Boolean(l.phone && l.phone.trim().length >= 8)).length;

    const contactedOrMore = leads.filter((l) => ['CONTATADO', 'RESPONDEU', 'INTERESSADO', 'FOLLOW_UP', 'NEGOCIACAO', 'REUNIÃO', 'PROPOSTA', 'FECHADO'].includes(l.pipeline_status)).length;
    const respondedOrMore = leads.filter((l) => ['RESPONDEU', 'INTERESSADO', 'FOLLOW_UP', 'NEGOCIACAO', 'REUNIÃO', 'PROPOSTA', 'FECHADO'].includes(l.pipeline_status)).length;

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

    const pipelineStatuses: PipelineStatus[] = ['NOVO', 'PRÉVIA CRIADA', 'CONTATADO', 'RESPONDEU', 'INTERESSADO', 'FOLLOW_UP', 'NEGOCIACAO', 'REUNIÃO', 'PROPOSTA', 'FECHADO', 'PERDIDO'];
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

  public getAllSearchJobs(freelancer_id?: string): SearchJob[] {
    let list = [...this.data.search_jobs];
    if (freelancer_id && freelancer_id !== 'ALL') {
      list = list.filter((j) => j.freelancer_id === freelancer_id);
    }
    return list.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  // --- FREELANCERS MANAGEMENT ---
  public getFreelancers(): Freelancer[] {
    return [...(this.data.freelancers || [])];
  }

  public getFreelancerById(id: string): Freelancer | undefined {
    return (this.data.freelancers || []).find((f) => f.id === id);
  }

  public getFreelancerByAccessCode(code: string): Freelancer | undefined {
    if (!code) return undefined;
    const cleanRaw = code
      .trim()
      .replace(/^https?:\/\/[^\/]+\/f\//i, '')
      .replace(/^\/f\//i, '')
      .replace(/\/+$/, '');

    const cleanLower = cleanRaw.toLowerCase();
    const cleanSlug = slugifyFreelancerName(cleanRaw);
    const cleanNorm = normalizeStr(cleanRaw).replace(/[^a-z0-9]/g, '');

    return (this.data.freelancers || []).find((f) => {
      if (!f) return false;
      const fCode = f.access_code || '';
      const fCodeLower = fCode.toLowerCase().trim();
      const fCodeSlug = slugifyFreelancerName(fCode);
      const fNameLower = (f.name || '').toLowerCase().trim();
      const fNameSlug = slugifyFreelancerName(f.name || '');
      const fFirstNameSlug = slugifyFreelancerName((f.name || '').split(' ')[0]);
      const fNameNorm = normalizeStr(f.name || '').replace(/[^a-z0-9]/g, '');
      const fIdLower = (f.id || '').toLowerCase().trim();

      return (
        fCodeLower === cleanLower ||
        fCodeSlug === cleanSlug ||
        fNameSlug === cleanSlug ||
        fFirstNameSlug === cleanSlug ||
        fNameLower === cleanLower ||
        fNameNorm === cleanNorm ||
        fIdLower === cleanLower ||
        fIdLower === `free_${cleanLower}` ||
        fIdLower.replace('free_', '') === cleanLower ||
        fCode.toUpperCase() === cleanRaw.toUpperCase() ||
        (f.email && f.email.toLowerCase() === cleanLower)
      );
    });
  }

  public createFreelancer(data: {
    name: string;
    email: string;
    access_code?: string;
    notes?: string;
    pin?: string;
    status?: FreelancerStatus;
  }): Freelancer {
    const rawName = data.name.trim();

    // 1. Gera código de acesso amigável com base no nome cadastrado
    let preferredCode = data.access_code?.trim()
      ? slugifyFreelancerName(data.access_code)
      : slugifyFreelancerName(rawName.split(' ')[0]) || slugifyFreelancerName(rawName);

    if (!preferredCode) {
      preferredCode = slugifyFreelancerName(rawName) || 'freelancer';
    }

    let code = preferredCode;
    let counter = 2;
    while ((this.data.freelancers || []).some((f) => f.access_code.toLowerCase() === code.toLowerCase())) {
      code = `${preferredCode}-${counter}`;
      counter++;
    }

    const id = `free_${code}`;
    const now = new Date().toISOString();
    const freelancer: Freelancer = {
      id,
      name: rawName,
      email: data.email.trim().toLowerCase(),
      access_code: code,
      status: data.status || 'active',
      notes: data.notes?.trim(),
      pin: data.pin?.trim(),
      created_at: now,
      updated_at: now,
    };

    if (!this.data.freelancers) this.data.freelancers = [];
    this.data.freelancers.unshift(freelancer);
    this.save();
    syncFreelancerToFirestore(freelancer).catch(() => {});

    this.logActivity({
      freelancer_id: freelancer.id,
      freelancer_name: freelancer.name,
      action_type: 'freelancer_created',
      description: `Administrador cadastrou o freelancer "${freelancer.name}" com link de acesso: /f/${freelancer.access_code}`,
      metadata: { freelancer_id: freelancer.id, access_code: freelancer.access_code },
    });

    return freelancer;
  }

  public updateFreelancer(id: string, updates: Partial<Freelancer>): Freelancer | undefined {
    const idx = (this.data.freelancers || []).findIndex((f) => f.id === id);
    if (idx === -1) return undefined;

    const prev = this.data.freelancers[idx];
    const updated: Freelancer = {
      ...prev,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.data.freelancers[idx] = updated;
    this.save();
    syncFreelancerToFirestore(updated).catch(() => {});
    return updated;
  }

  public regenerateFreelancerAccessCode(id: string): string | undefined {
    const f = this.getFreelancerById(id);
    if (!f) return undefined;

    const baseCode = slugifyFreelancerName(f.name.split(' ')[0]) || slugifyFreelancerName(f.name);
    let newCode = baseCode;
    let counter = 2;
    while ((this.data.freelancers || []).some((x) => x.id !== f.id && x.access_code.toLowerCase() === newCode.toLowerCase())) {
      newCode = `${baseCode}-${counter}`;
      counter++;
    }

    f.access_code = newCode;
    f.updated_at = new Date().toISOString();
    this.save();
    syncFreelancerToFirestore(f).catch(() => {});

    this.logActivity({
      freelancer_id: f.id,
      freelancer_name: f.name,
      action_type: 'access_link_regenerated',
      description: `Link de acesso de ${f.name} foi atualizado para /f/${newCode}`,
      metadata: { new_code: newCode },
    });

    return newCode;
  }

  public setFreelancerStatus(id: string, status: FreelancerStatus): Freelancer | undefined {
    const f = this.getFreelancerById(id);
    if (!f) return undefined;

    const oldStatus = f.status;
    f.status = status;
    f.updated_at = new Date().toISOString();
    this.save();
    syncFreelancerToFirestore(f).catch(() => {});

    if (status === 'blocked' && oldStatus !== 'blocked') {
      this.logActivity({
        freelancer_id: f.id,
        freelancer_name: f.name,
        action_type: 'freelancer_blocked',
        description: `Administrador bloqueou o acesso do freelancer "${f.name}"`,
      });
    } else if (status === 'active' && oldStatus === 'blocked') {
      this.logActivity({
        freelancer_id: f.id,
        freelancer_name: f.name,
        action_type: 'freelancer_unblocked',
        description: `Administrador desbloqueou o acesso do freelancer "${f.name}"`,
      });
    }

    return f;
  }

  public deleteFreelancer(id: string): boolean {
    const idx = (this.data.freelancers || []).findIndex((f) => f.id === id);
    if (idx === -1) return false;
    const removed = this.data.freelancers.splice(idx, 1)[0];
    this.save();
    deleteFreelancerFromFirestore(id).catch(() => {});

    this.logActivity({
      freelancer_id: id,
      freelancer_name: removed.name,
      action_type: 'freelancer_blocked',
      description: `Administrador removeu o cadastro do freelancer "${removed.name}"`,
    });
    return true;
  }

  // --- ACTIVITIES AUDIT LOG ---
  public logActivity(activity: Omit<Activity, 'id' | 'created_at'>): Activity {
    const item: Activity = {
      ...activity,
      id: `act_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      created_at: new Date().toISOString(),
    };
    if (!this.data.activities) this.data.activities = [];
    this.data.activities.unshift(item);
    if (this.data.activities.length > 500) {
      this.data.activities = this.data.activities.slice(0, 500);
    }
    this.save();
    syncActivityToFirestore(item).catch(() => {});
    return item;
  }

  public getActivities(params?: {
    freelancer_id?: string;
    limit?: number;
    offset?: number;
    action_type?: string;
  }): { activities: Activity[]; total: number } {
    let list = [...(this.data.activities || [])];
    if (params?.freelancer_id && params.freelancer_id !== 'ALL') {
      list = list.filter((a) => a.freelancer_id === params.freelancer_id);
    }
    if (params?.action_type && params.action_type !== 'ALL') {
      list = list.filter((a) => a.action_type === params.action_type);
    }
    const total = list.length;
    const offset = params?.offset || 0;
    const limit = params?.limit || 50;
    return {
      activities: list.slice(offset, offset + limit),
      total,
    };
  }

  // --- PERFORMANCE METRICS ---
  public getFreelancerPerformance(freelancerId: string): FreelancerPerformance | undefined {
    const f = this.getFreelancerById(freelancerId);
    if (!f) return undefined;

    const leads = (this.data.leads || []).filter((l) => l.freelancer_id === freelancerId);
    const searches = (this.data.search_jobs || []).filter((j) => j.freelancer_id === freelancerId);
    const activities = (this.data.activities || []).filter((a) => a.freelancer_id === freelancerId);

    const leadsFound = leads.length;
    // Diferencia LEADS FOUND de LEADS EFETIVAMENTE CONTATADOS
    const contactedLeads = leads.filter((l) =>
      Boolean(l.contacted_at) ||
      ['CONTATADO', 'RESPONDEU', 'INTERESSADO', 'FOLLOW_UP', 'NEGOCIACAO', 'REUNIÃO', 'PROPOSTA', 'FECHADO', 'PERDIDO', 'NAO_INTERESSADO', 'SEM_RESPOSTA'].includes(l.pipeline_status)
    ).length;

    let contactAttempts = 0;
    for (const l of leads) {
      contactAttempts += l.contact_attempts_count || (l.contacted_at ? 1 : 0);
    }
    if (contactAttempts < contactedLeads) contactAttempts = contactedLeads;

    const responses = leads.filter((l) =>
      Boolean(l.response_at) ||
      ['RESPONDEU', 'INTERESSADO', 'FOLLOW_UP', 'NEGOCIACAO', 'REUNIÃO', 'PROPOSTA', 'FECHADO'].includes(l.pipeline_status)
    ).length;

    const followUps = leads.filter((l) =>
      Boolean(l.follow_up_at) ||
      ['FOLLOW_UP', 'NEGOCIACAO', 'REUNIÃO', 'PROPOSTA', 'FECHADO'].includes(l.pipeline_status)
    ).length;

    const negotiations = leads.filter((l) =>
      Boolean(l.negotiation_at) ||
      ['NEGOCIACAO', 'REUNIÃO', 'PROPOSTA', 'FECHADO'].includes(l.pipeline_status)
    ).length;

    const sales = leads.filter((l) =>
      Boolean(l.sale_date) || l.pipeline_status === 'FECHADO'
    ).length;

    const responseRate = contactedLeads > 0 ? Math.round((responses / contactedLeads) * 100) : 0;
    const conversionRate = contactedLeads > 0 ? Math.round((sales / contactedLeads) * 100) : 0;

    // Contagem de dias ativos
    const activeDaysSet = new Set<string>();
    for (const l of leads) {
      if (l.created_at) activeDaysSet.add(l.created_at.split('T')[0]);
      if (l.contacted_at) activeDaysSet.add(l.contacted_at.split('T')[0]);
    }
    for (const a of activities) {
      if (a.created_at) activeDaysSet.add(a.created_at.split('T')[0]);
    }

    // Tendência por dia (últimos 7 dias)
    const days: { date: string; count: number }[] = [];
    const contactDays: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const str = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      days.push({ date: str, count: 0 });
      contactDays.push({ date: str, count: 0 });
    }

    for (const l of leads) {
      const lDate = new Date(l.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const found = days.find((d) => d.date === lDate);
      if (found) found.count++;

      if (l.contacted_at) {
        const cDate = new Date(l.contacted_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const cFound = contactDays.find((d) => d.date === cDate);
        if (cFound) cFound.count++;
      }
    }

    const lastAct = activities.length > 0 ? activities[0].created_at : f.last_activity_at;

    return {
      freelancer: f,
      leadsFound,
      leadsContacted: contactedLeads,
      contactAttempts,
      responses,
      followUps,
      negotiations,
      sales,
      responseRate,
      conversionRate,
      searchesCount: searches.length,
      activeDays: Math.max(1, activeDaysSet.size),
      lastActivity: lastAct,
      lastAccess: f.last_access_at,
      leadsPerDay: days,
      contactsPerDay: contactDays,
    };
  }

  public getAdminDashboardStats(filter?: {
    freelancer_id?: string;
    period?: string;
    state?: string;
    niche?: string;
    status?: string;
  }): AdminDashboardStats {
    const freelancers = this.data.freelancers || [];
    const totalFreelancers = freelancers.length;
    const activeFreelancers = freelancers.filter((f) => f.status === 'active').length;
    const blockedFreelancers = freelancers.filter((f) => f.status === 'blocked').length;

    let leads = [...(this.data.leads || [])];
    let searches = [...(this.data.search_jobs || [])];
    let activities = [...(this.data.activities || [])];

    // Filtro por Freelancer
    if (filter?.freelancer_id && filter.freelancer_id !== 'ALL') {
      leads = leads.filter((l) => l.freelancer_id === filter.freelancer_id);
      searches = searches.filter((s) => s.freelancer_id === filter.freelancer_id);
      activities = activities.filter((a) => a.freelancer_id === filter.freelancer_id);
    }

    // Filtro por Período
    if (filter?.period && filter.period !== 'ALL') {
      const now = Date.now();
      let msLimit = 0;
      if (filter.period === 'today') msLimit = 24 * 3600 * 1000;
      else if (filter.period === '7d') msLimit = 7 * 24 * 3600 * 1000;
      else if (filter.period === '30d') msLimit = 30 * 24 * 3600 * 1000;

      if (msLimit > 0) {
        leads = leads.filter((l) => now - new Date(l.created_at).getTime() <= msLimit);
        searches = searches.filter((s) => now - new Date(s.created_at).getTime() <= msLimit);
        activities = activities.filter((a) => now - new Date(a.created_at).getTime() <= msLimit);
      }
    }

    // Filtro por Estado
    if (filter?.state && filter.state !== 'ALL') {
      leads = leads.filter((l) => (l.state || '').toUpperCase() === filter.state!.toUpperCase());
    }

    // Filtro por Nicho
    if (filter?.niche && filter.niche !== 'ALL') {
      const normN = normalizeStr(filter.niche);
      leads = leads.filter((l) => normalizeStr(l.niche).includes(normN));
    }

    // Filtro por Status
    if (filter?.status && filter.status !== 'ALL') {
      leads = leads.filter((l) => l.pipeline_status === filter.status);
    }

    const totalLeadsFound = leads.length;
    const totalLeadsContacted = leads.filter((l) =>
      Boolean(l.contacted_at) ||
      ['CONTATADO', 'RESPONDEU', 'INTERESSADO', 'FOLLOW_UP', 'NEGOCIACAO', 'REUNIÃO', 'PROPOSTA', 'FECHADO', 'PERDIDO', 'NAO_INTERESSADO', 'SEM_RESPOSTA'].includes(l.pipeline_status)
    ).length;

    const totalResponses = leads.filter((l) =>
      Boolean(l.response_at) ||
      ['RESPONDEU', 'INTERESSADO', 'FOLLOW_UP', 'NEGOCIACAO', 'REUNIÃO', 'PROPOSTA', 'FECHADO'].includes(l.pipeline_status)
    ).length;

    const totalFollowUps = leads.filter((l) =>
      Boolean(l.follow_up_at) ||
      ['FOLLOW_UP', 'NEGOCIACAO', 'REUNIÃO', 'PROPOSTA', 'FECHADO'].includes(l.pipeline_status)
    ).length;

    const totalNegotiations = leads.filter((l) =>
      Boolean(l.negotiation_at) ||
      ['NEGOCIACAO', 'REUNIÃO', 'PROPOSTA', 'FECHADO'].includes(l.pipeline_status)
    ).length;

    const totalSales = leads.filter((l) =>
      Boolean(l.sale_date) || l.pipeline_status === 'FECHADO'
    ).length;

    let totalSalesValue = 0;
    for (const l of leads) {
      if (l.pipeline_status === 'FECHADO' || l.sale_date) {
        totalSalesValue += l.sale_value || 0;
      }
    }

    const overallResponseRate = totalLeadsContacted > 0
      ? Math.round((totalResponses / totalLeadsContacted) * 100)
      : 0;

    const overallConversionRate = totalLeadsContacted > 0
      ? Math.round((totalSales / totalLeadsContacted) * 100)
      : 0;

    // Desempenho individual por freelancer
    const allPerformances: FreelancerPerformance[] = freelancers.map((f) => {
      return this.getFreelancerPerformance(f.id)!;
    }).filter(Boolean);

    // Freelancers Mais Ativos (ponderado por buscas, contatos e atividades)
    const mostActiveFreelancers = [...allPerformances].sort((a, b) => {
      const scoreA = a.searchesCount * 5 + a.leadsContacted * 2 + a.leadsFound;
      const scoreB = b.searchesCount * 5 + b.leadsContacted * 2 + b.leadsFound;
      return scoreB - scoreA;
    });

    // Melhores Desempenhos (ponderado por vendas, taxa de resposta e contatos)
    const bestPerformingFreelancers = [...allPerformances].sort((a, b) => {
      if (b.sales !== a.sales) return b.sales - a.sales;
      if (b.responseRate !== a.responseRate) return b.responseRate - a.responseRate;
      return b.leadsContacted - a.leadsContacted;
    });

    return {
      totalFreelancers,
      activeFreelancers,
      blockedFreelancers,
      totalSearches: searches.length,
      totalLeadsFound,
      totalLeadsContacted,
      totalResponses,
      totalFollowUps,
      totalNegotiations,
      totalSales,
      totalSalesValue,
      overallResponseRate,
      overallConversionRate,
      recentActivities: activities.slice(0, 30),
      mostActiveFreelancers,
      bestPerformingFreelancers,
    };
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
