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
import { isLeadInWorkspace, matchesFreelancerId } from './ownership';
import { normalizeStr, matchesNicheSemantics } from '../search/relevance';
export class Projections {
 private deletedLeadIds = new Set<string>();
 constructor(private data: {leads: Lead[]; freelancers: Freelancer[]; activities: Activity[]; search_jobs: SearchJob[]}) {}
  public getLeads(params: {
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
    maxReviews?: number;
    minScore?: number;
    status?: string;
    search?: string;
    sortBy?: 'score' | 'reviews' | 'rating' | 'recent';
    page?: number;
    limit?: number;
  }, snapshots: Map<string, Partial<Lead>> = new Map()): { leads: Lead[]; total: number; page: number; totalPages: number } {
    let filtered = (this.data.leads || []).filter((l) => l && l.id && !this.deletedLeadIds.has(l.id));
    if (params.search_job_id) filtered = filtered.filter(l => l.search_job_ids?.includes(params.search_job_id!));

    if (snapshots.size > 0) {
      filtered = filtered
        .filter(lead => snapshots.has(lead.id))
        .map(lead => ({ ...lead, ...snapshots.get(lead.id) }));
    }

    if (params.freelancer_id !== 'ALL') {
      filtered = filtered.filter((l) => isLeadInWorkspace(l, params.freelancer_id));
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
        return matchesNicheSemantics(ln, targetNiche);
      });
    }

    if (params.status && params.status !== 'ALL') {
      filtered = filtered.filter((l) => l.pipeline_status === params.status);
    }

    if (params.onlyWithoutWebsite) {
      filtered = filtered.filter((l) => (!l.website || l.website.trim() === '') && (l.website_status === 'no_website' || !l.website_status));
    }

    if (params.onlyWithPhone) {
      filtered = filtered.filter((l) => Boolean(l.phone && l.phone.trim().length >= 8));
    }

    if (params.onlyFavorites) {
      filtered = filtered.filter((l) => l.is_favorite === true);
    }

    if (params.excludeHidden) {
      filtered = filtered.filter((l) => !l.is_hidden);
    }

    if (params.onlyHidden) {
      filtered = filtered.filter((l) => Boolean(l.is_hidden));
    }

    if (params.minRating) {
      filtered = filtered.filter((l) => l.rating >= params.minRating!);
    }

    if (params.maxRating) {
      filtered = filtered.filter((l) => l.rating <= params.maxRating!);
    }

    if (params.minReviews) {
      filtered = filtered.filter((l) => l.reviews_count >= params.minReviews!);
    }

    if (params.maxReviews) {
      filtered = filtered.filter((l) => l.reviews_count <= params.maxReviews!);
    }

    if (params.minScore) {
      filtered = filtered.filter((l) => l.lead_score >= params.minScore!);
    }

    if (params.search && params.search.trim() !== '') {
      const q = normalizeStr(params.search);
      const qDigits = q.replace(/\D/g, '');
      filtered = filtered.filter((l) =>
        normalizeStr(l.name).includes(q) ||
        normalizeStr(l.city).includes(q) ||
        (qDigits.length >= 3 && Boolean(l.phone && l.phone.replace(/\D/g, '').includes(qDigits)))
      );
    }

    // Ordenação
    const sortBy = params.sortBy || 'score';
    filtered.sort((a, b) => {
      if (sortBy === 'score') return (b.lead_score || 0) - (a.lead_score || 0) || a.id.localeCompare(b.id);
      if (sortBy === 'reviews') return (b.reviews_count || 0) - (a.reviews_count || 0) || a.id.localeCompare(b.id);
      if (sortBy === 'rating') return (b.rating || 0) - (a.rating || 0) || a.id.localeCompare(b.id);
      if (sortBy === 'recent') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || a.id.localeCompare(b.id);
      return (b.lead_score || 0) - (a.lead_score || 0);
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
    if (params?.freelancer_id !== 'ALL') {
      leads = leads.filter((l) => isLeadInWorkspace(l, params?.freelancer_id));
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
    if (params?.freelancer_id !== 'ALL') {
      leads = leads.filter((l) => isLeadInWorkspace(l, params?.freelancer_id));
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
    if (freelancer_id !== 'ALL') {
      list = list.filter((l) => isLeadInWorkspace(l, freelancer_id));
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

public getDashboardStats(freelancer_id?: string): DashboardStats {
    let leads = this.data.leads;
    if (freelancer_id !== 'ALL') {
      leads = leads.filter((l) => isLeadInWorkspace(l, freelancer_id));
    }
    const totalLeads = leads.length;
    const newLeads = leads.filter((l) => l.pipeline_status === 'NOVO').length;
    const contactedLeads = leads.filter((l) => l.pipeline_status === 'CONTATADO').length;
    const interestedLeads = leads.filter((l) => l.pipeline_status === 'INTERESSADO' || l.pipeline_status === 'NEGOCIACAO').length;
    const closedLeads = leads.filter((l) => l.pipeline_status === 'FECHADO').length;
    const noWebsiteLeads = leads.filter((l) => (!l.website || l.website.trim() === '') && (l.website_status === 'no_website' || !l.website_status)).length;
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

public getFreelancerById(id: string): Freelancer | undefined {
    return (this.data.freelancers || []).find((f) => f.id === id);
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
}
