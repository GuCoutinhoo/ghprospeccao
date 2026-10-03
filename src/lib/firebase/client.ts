import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../../firebase-applet-config.json';
import { DashboardStats, Lead, PipelineStatus } from '../../types';

let firestoreInstance: Firestore | null = null;

export function getClientFirestore(): Firestore | null {
  if (firestoreInstance) return firestoreInstance;
  try {
    const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    const databaseId =
      firebaseConfig.firestoreDatabaseId ||
      'ai-studio-prospectaplacesb-a0f0acf2-92de-4dc6-84d3-27efdba900e9';
    firestoreInstance = getFirestore(app, databaseId);
    return firestoreInstance;
  } catch (err) {
    console.warn('[Firebase Client] Falha ao inicializar Firestore no cliente:', err);
    return null;
  }
}

let cachedLeads: Lead[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 15000; // 15 segundos de cache em memória para navegação rápida

export function invalidateLeadsCache() {
  cachedLeads = null;
  lastFetchTime = 0;
}

function normalizeStr(str?: string | null): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export async function fetchAllLeadsFromFirestore(forceRefresh = false): Promise<Lead[]> {
  const now = Date.now();
  if (!forceRefresh && cachedLeads && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedLeads;
  }

  const db = getClientFirestore();
  if (!db) return cachedLeads || [];

  try {
    const snap = await getDocs(collection(db, 'leads'));
    const leads: Lead[] = [];
    snap.forEach((d) => {
      const data = d.data() as Lead;
      if (data && data.name) {
        leads.push(data);
      }
    });

    if (leads.length > 0) {
      cachedLeads = leads;
      lastFetchTime = now;
    }
    return cachedLeads || leads;
  } catch (err) {
    console.warn('[Firebase Client] Erro ao carregar leads do Firestore:', err);
    return cachedLeads || [];
  }
}

export function computeStatsFromLeads(leads: Lead[]): DashboardStats {
  const totalLeads = leads.length;
  let newLeads = 0;
  let contactedLeads = 0;
  let interestedLeads = 0;
  let closedLeads = 0;
  let noWebsiteLeads = 0;
  let withPhoneLeads = 0;

  const nicheMap: Record<string, number> = {};
  const stateMap: Record<string, number> = {};
  const statusCounts: Record<PipelineStatus, number> = {
    'NOVO': 0,
    'PRÉVIA CRIADA': 0,
    'CONTATADO': 0,
    'RESPONDEU': 0,
    'INTERESSADO': 0,
    'REUNIÃO': 0,
    'PROPOSTA': 0,
    'FECHADO': 0,
    'PERDIDO': 0,
  };

  const dayMap: Record<string, number> = {};
  // Inicializa últimos 7 dias
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    dayMap[dayStr] = 0;
  }

  for (const lead of leads) {
    const status = lead.pipeline_status || 'NOVO';
    if (statusCounts[status] !== undefined) {
      statusCounts[status]++;
    } else {
      statusCounts['NOVO']++;
    }

    if (status === 'NOVO') newLeads++;
    if (status === 'CONTATADO') contactedLeads++;
    if (status === 'INTERESSADO') interestedLeads++;
    if (status === 'FECHADO') closedLeads++;

    if (lead.website_status === 'no_website' || !lead.website) {
      noWebsiteLeads++;
    }
    if (lead.phone && lead.phone.trim().length >= 8) {
      withPhoneLeads++;
    }

    const niche = lead.niche || 'Geral';
    nicheMap[niche] = (nicheMap[niche] || 0) + 1;

    const state = (lead.state || 'OUTRO').toUpperCase();
    stateMap[state] = (stateMap[state] || 0) + 1;

    if (lead.created_at) {
      const createdDate = new Date(lead.created_at);
      const dayStr = `${String(createdDate.getDate()).padStart(2, '0')}/${String(createdDate.getMonth() + 1).padStart(2, '0')}`;
      if (dayMap[dayStr] !== undefined) {
        dayMap[dayStr]++;
      }
    }
  }

  const responseRate = contactedLeads > 0 ? Math.round(((statusCounts['RESPONDEU'] + interestedLeads + closedLeads) / contactedLeads) * 100) : 0;
  const closingRate = contactedLeads > 0 ? Math.round((closedLeads / contactedLeads) * 100) : 0;

  const leadsByNiche = Object.entries(nicheMap)
    .map(([niche, count]) => ({ niche, count }))
    .sort((a, b) => b.count - a.count);

  const leadsByState = Object.entries(stateMap)
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count);

  const leadsByDay = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

  const pipelineDistribution = Object.entries(statusCounts).map(([status, count]) => ({
    status: status as PipelineStatus,
    count,
  }));

  const topOpportunities = [...leads]
    .sort((a, b) => (b.lead_score || 0) - (a.lead_score || 0))
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
    leadsByDay,
    leadsByNiche,
    leadsByState,
    pipelineDistribution,
    topOpportunities,
  };
}

export function filterLeadsList(
  leads: Lead[],
  params: {
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
  }
): { leads: Lead[]; total: number; page: number; totalPages: number } {
  let filtered = [...leads];

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
    filtered = filtered.filter((l) => (l.rating || 0) >= params.minRating!);
  }

  if (params.minReviews) {
    filtered = filtered.filter((l) => (l.reviews_count || 0) >= params.minReviews!);
  }

  if (params.minScore) {
    filtered = filtered.filter((l) => (l.lead_score || 0) >= params.minScore!);
  }

  if (params.search && params.search.trim() !== '') {
    const q = normalizeStr(params.search);
    filtered = filtered.filter(
      (l) =>
        normalizeStr(l.name).includes(q) ||
        normalizeStr(l.city).includes(q) ||
        (l.phone && l.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '')))
    );
  }

  const sortBy = params.sortBy || 'score';
  filtered.sort((a, b) => {
    if (sortBy === 'score') return (b.lead_score || 0) - (a.lead_score || 0);
    if (sortBy === 'reviews') return (b.reviews_count || 0) - (a.reviews_count || 0);
    if (sortBy === 'rating') return (b.rating || 0) - (a.rating || 0);
    if (sortBy === 'recent') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return (b.lead_score || 0) - (a.lead_score || 0);
  });

  const total = filtered.length;
  const page = Math.max(1, params.page || 1);
  const limit = Math.max(1, Math.min(params.limit || 50, 100));
  const totalPages = Math.ceil(total / limit) || 1;
  const offset = (page - 1) * limit;
  const paginated = filtered.slice(offset, offset + limit);

  return { leads: paginated, total, page, totalPages };
}

export async function syncLeadUpdateToFirestoreDirect(
  leadId: string,
  updates: Partial<Lead>
): Promise<void> {
  const db = getClientFirestore();
  if (!db || !leadId) return;

  const cleanUpdates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) {
      cleanUpdates[k] = v;
    }
  }

  // Atualiza cache em memória local
  if (cachedLeads) {
    const idx = cachedLeads.findIndex((l) => l.id === leadId);
    if (idx !== -1) {
      cachedLeads[idx] = { ...cachedLeads[idx], ...cleanUpdates, updated_at: new Date().toISOString() };
    }
  }

  try {
    await setDoc(doc(db, 'leads', leadId), cleanUpdates, { merge: true });
  } catch (err) {
    console.warn(`[Firebase Client] Falha ao sincronizar lead ${leadId} no Firestore:`, err);
  }
}
