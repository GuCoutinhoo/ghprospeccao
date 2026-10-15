// src/server/app.ts
import "express-async-errors";
import express from "express";
import dotenv from "dotenv";
import crypto4 from "node:crypto";

// src/lib/store/repository.ts
import crypto2 from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

// src/lib/firebase/admin.ts
import "dotenv/config";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
var instance;
function getServerFirestore() {
  if (instance) return instance;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (process.env.NODE_ENV === "test" && (!emulator || !projectId?.startsWith("demo-"))) throw new Error("Tests require a demo project and Firestore emulator.");
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID must be configured.");
  if (emulator && !/^(127\.0\.0\.1|localhost):\d+$/.test(emulator)) throw new Error("Emulator must be local.");
  const credentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const app2 = getApps()[0] || initializeApp({ projectId, ...emulator ? {} : { credential: credentials ? cert(JSON.parse(credentials)) : applicationDefault() } });
  instance = getFirestore(app2, process.env.FIRESTORE_DATABASE_ID || "(default)");
  instance.settings({ ignoreUndefinedProperties: true });
  return instance;
}
function storageErrorCode(error) {
  const code = error?.code;
  return { 7: "PERMISSION_DENIED", 8: "QUOTA_EXCEEDED", 4: "DEADLINE_EXCEEDED", 14: "UNAVAILABLE" }[String(code)] || "STORAGE_FAILURE";
}

// src/lib/store/ownership.ts
function canonicalWorkspace(id) {
  const value = (id || "").trim().toLowerCase();
  if (!value || ["admin", "administrador", "default"].includes(value) || value.startsWith("admin_") || value.startsWith("default_user")) return "admin";
  return value.replace(/^free_/, "");
}
function ownerOf(value) {
  const owners = [value.workspace_id, value.freelancer_id].filter(Boolean).map(canonicalWorkspace);
  if (!owners.length) return canonicalWorkspace(value.user_id);
  if (new Set(owners).size !== 1) return "!conflicting-owner";
  return owners[0];
}
function matchesFreelancerId(a, b) {
  return b === "ALL" || canonicalWorkspace(a) === canonicalWorkspace(b);
}
function isLeadInWorkspace(value, target) {
  return target === "ALL" || ownerOf(value) === canonicalWorkspace(target);
}

// src/lib/search/relevance.ts
var normalizeStr = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
var groups = [
  { key: "odontologia", terms: ["odontologia", "odontologica", "odontologicas", "odontologico", "dentista", "dentistas", "dental", "odonto"], types: ["dentist", "dental_clinic"] },
  { key: "barbearia", terms: ["barbearia", "barbearias", "barbeiro", "barber"], types: ["barber_shop"] },
  { key: "restaurante", terms: ["restaurante", "restaurantes", "pizzaria", "hamburgueria", "churrascaria"], types: ["restaurant", "pizza_restaurant", "hamburger_restaurant"] },
  { key: "academia", terms: ["academia", "academias", "fitness", "crossfit"], types: ["gym", "fitness_center"] },
  { key: "advocacia", terms: ["advocacia", "advogado", "advogados"], types: ["lawyer"] },
  { key: "contabilidade", terms: ["contabilidade", "contador", "contadores"], types: ["accounting"] },
  { key: "mecanica", terms: ["mecanica", "mecanicas", "oficina", "oficinas"], types: ["car_repair"] },
  { key: "imobiliaria", terms: ["imobiliaria", "imobiliarias", "corretor"], types: ["real_estate_agency"] },
  { key: "pet", terms: ["pet", "veterinario", "veterinaria"], types: ["pet_store", "veterinary_care"] },
  { key: "estetica", terms: ["estetica", "beleza", "manicure"], types: ["beauty_salon", "spa"] },
  { key: "eletricista", terms: ["eletricista", "eletricistas"], types: ["electrician"] }
];
var words = (s) => normalizeStr(s).split(" ");
var group = (s) => groups.find((g) => g.terms.some((t) => words(s).includes(t)) || g.types.some((t) => normalizeStr(s) === normalizeStr(t)));
var nicheKey = (s) => group(s)?.key || normalizeStr(s);
function matchesNicheSemantics(text, niche) {
  if (!text || !niche) return false;
  const g = group(niche);
  if (g) return g.terms.some((t) => words(text).includes(t)) || g.types.some((t) => normalizeStr(text) === normalizeStr(t));
  const tokens = words(niche).filter((w) => w.length > 2 && !["clinica", "clinicas", "servico", "servicos", "para", "com", "de", "em"].includes(w));
  return tokens.length > 0 && tokens.every((w) => words(text).includes(w));
}
function isPlaceRelevantToNiche(place, niche) {
  const g = group(niche);
  const types = place.raw_types || [];
  if (g && types.some((t) => g.types.includes(t))) return true;
  if (g && groups.some((other) => other !== g && types.some((t) => other.types.includes(t)))) return false;
  return matchesNicheSemantics(place.name || "", niche) || types.some((t) => matchesNicheSemantics(t, niche));
}

// src/lib/store/projections.ts
var Projections = class {
  constructor(data) {
    this.data = data;
    this.deletedLeadIds = /* @__PURE__ */ new Set();
  }
  getLeads(params) {
    let filtered = (this.data.leads || []).filter((l) => l && l.id && !this.deletedLeadIds.has(l.id));
    if (params.search_job_id) filtered = filtered.filter((l) => l.search_job_ids?.includes(params.search_job_id));
    if (params.freelancer_id !== "ALL") {
      filtered = filtered.filter((l) => isLeadInWorkspace(l, params.freelancer_id));
    }
    if (params.state && params.state !== "ALL") {
      const targetState = params.state.toUpperCase().trim();
      filtered = filtered.filter((l) => {
        const ls = (l.state || "").toUpperCase().trim();
        if (ls === targetState) return true;
        if (targetState === "SP" && (ls.includes("S\xC3O PAULO") || ls.includes("SAO PAULO"))) return true;
        if (targetState === "RJ" && ls.includes("RIO DE JANEIRO")) return true;
        if (targetState === "MG" && ls.includes("MINAS GERAIS")) return true;
        if (targetState === "ES" && (ls.includes("ESP\xCDRITO SANTO") || ls.includes("ESPIRITO SANTO"))) return true;
        if (targetState === "PR" && (ls.includes("PARAN\xC1") || ls.includes("PARANA"))) return true;
        if (targetState === "SC" && ls.includes("SANTA CATARINA")) return true;
        if (targetState === "RS" && ls.includes("RIO GRANDE DO SUL")) return true;
        return false;
      });
    }
    if (params.city && params.city !== "ALL") {
      const targetCity = normalizeStr(params.city);
      filtered = filtered.filter((l) => normalizeStr(l.city) === targetCity);
    }
    if (params.niche && params.niche !== "ALL") {
      const targetNiche = normalizeStr(params.niche);
      filtered = filtered.filter((l) => {
        const ln = normalizeStr(l.niche);
        return matchesNicheSemantics(ln, targetNiche);
      });
    }
    if (params.status && params.status !== "ALL") {
      filtered = filtered.filter((l) => l.pipeline_status === params.status);
    }
    if (params.onlyWithoutWebsite) {
      filtered = filtered.filter((l) => (!l.website || l.website.trim() === "") && (l.website_status === "no_website" || !l.website_status));
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
      filtered = filtered.filter((l) => l.rating >= params.minRating);
    }
    if (params.minReviews) {
      filtered = filtered.filter((l) => l.reviews_count >= params.minReviews);
    }
    if (params.minScore) {
      filtered = filtered.filter((l) => l.lead_score >= params.minScore);
    }
    if (params.search && params.search.trim() !== "") {
      const q = normalizeStr(params.search);
      const qDigits = q.replace(/\D/g, "");
      filtered = filtered.filter(
        (l) => normalizeStr(l.name).includes(q) || normalizeStr(l.city).includes(q) || qDigits.length >= 3 && Boolean(l.phone && l.phone.replace(/\D/g, "").includes(qDigits))
      );
    }
    const sortBy = params.sortBy || "score";
    filtered.sort((a, b) => {
      if (sortBy === "score") return (b.lead_score || 0) - (a.lead_score || 0) || a.id.localeCompare(b.id);
      if (sortBy === "reviews") return (b.reviews_count || 0) - (a.reviews_count || 0) || a.id.localeCompare(b.id);
      if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0) || a.id.localeCompare(b.id);
      if (sortBy === "recent") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || a.id.localeCompare(b.id);
      return (b.lead_score || 0) - (a.lead_score || 0);
    });
    const total = filtered.length;
    const page = Math.max(1, params.page || 1);
    const isUnlimited = params.limit === 0 || params.limit === -1 || typeof params.limit === "string" && (params.limit === "all" || params.limit === "0");
    const limit = isUnlimited ? Math.max(1, total) : Math.max(1, params.limit || 50);
    const totalPages = isUnlimited ? 1 : Math.ceil(total / limit) || 1;
    const offset = isUnlimited ? 0 : (page - 1) * limit;
    const paginated = isUnlimited ? filtered : filtered.slice(offset, offset + limit);
    return { leads: paginated, total, page, totalPages };
  }
  getNichesSummary(params) {
    const counts = {};
    let leads = this.data.leads;
    if (params?.freelancer_id !== "ALL") {
      leads = leads.filter((l) => isLeadInWorkspace(l, params?.freelancer_id));
    }
    if (params?.onlyFavorites) {
      leads = leads.filter((l) => l.is_favorite === true);
    }
    for (const lead of leads) {
      const n = (lead.niche || "Geral").trim();
      const norm = normalizeStr(n);
      if (!counts[norm]) {
        counts[norm] = { display: n, count: 0 };
      }
      counts[norm].count++;
    }
    return Object.values(counts).map(({ display, count }) => ({ niche: display, count })).sort((a, b) => b.count - a.count);
  }
  getStatesSummary(params) {
    const counts = {};
    let leads = this.data.leads;
    if (params?.freelancer_id !== "ALL") {
      leads = leads.filter((l) => isLeadInWorkspace(l, params?.freelancer_id));
    }
    if (params?.onlyFavorites) {
      leads = leads.filter((l) => l.is_favorite === true);
    }
    if (params?.niche && params.niche !== "ALL") {
      const targetNiche = normalizeStr(params.niche);
      leads = leads.filter((l) => {
        const ln = normalizeStr(l.niche);
        return ln.includes(targetNiche) || targetNiche.includes(ln);
      });
    }
    for (const lead of leads) {
      const s = (lead.state || "").toUpperCase().trim();
      if (s) {
        counts[s] = (counts[s] || 0) + 1;
      }
    }
    return Object.entries(counts).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count);
  }
  getPipelineBoard(freelancer_id) {
    const columns = {
      "NOVO": [],
      "PR\xC9VIA CRIADA": [],
      "CONTATADO": [],
      "RESPONDEU": [],
      "INTERESSADO": [],
      "FOLLOW_UP": [],
      "NEGOCIACAO": [],
      "REUNI\xC3O": [],
      "PROPOSTA": [],
      "FECHADO": [],
      "PERDIDO": [],
      "NAO_INTERESSADO": [],
      "SEM_RESPOSTA": []
    };
    let list = this.data.leads;
    if (freelancer_id !== "ALL") {
      list = list.filter((l) => isLeadInWorkspace(l, freelancer_id));
    }
    for (const lead of list) {
      if (columns[lead.pipeline_status]) {
        columns[lead.pipeline_status].push(lead);
      } else {
        columns["NOVO"].push(lead);
      }
    }
    for (const key of Object.keys(columns)) {
      columns[key].sort((a, b) => b.lead_score - a.lead_score);
    }
    return columns;
  }
  getDashboardStats(freelancer_id) {
    let leads = this.data.leads;
    if (freelancer_id !== "ALL") {
      leads = leads.filter((l) => isLeadInWorkspace(l, freelancer_id));
    }
    const totalLeads = leads.length;
    const newLeads = leads.filter((l) => l.pipeline_status === "NOVO").length;
    const contactedLeads = leads.filter((l) => l.pipeline_status === "CONTATADO").length;
    const interestedLeads = leads.filter((l) => l.pipeline_status === "INTERESSADO" || l.pipeline_status === "NEGOCIACAO").length;
    const closedLeads = leads.filter((l) => l.pipeline_status === "FECHADO").length;
    const noWebsiteLeads = leads.filter((l) => (!l.website || l.website.trim() === "") && (l.website_status === "no_website" || !l.website_status)).length;
    const withPhoneLeads = leads.filter((l) => Boolean(l.phone && l.phone.trim().length >= 8)).length;
    const contactedOrMore = leads.filter((l) => ["CONTATADO", "RESPONDEU", "INTERESSADO", "FOLLOW_UP", "NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO"].includes(l.pipeline_status)).length;
    const respondedOrMore = leads.filter((l) => ["RESPONDEU", "INTERESSADO", "FOLLOW_UP", "NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO"].includes(l.pipeline_status)).length;
    const responseRate = contactedOrMore > 0 ? Math.round(respondedOrMore / contactedOrMore * 100) : 0;
    const closingRate = totalLeads > 0 ? Math.round(closedLeads / totalLeads * 100) : 0;
    const nicheCount = {};
    for (const l of leads) {
      nicheCount[l.niche] = (nicheCount[l.niche] || 0) + 1;
    }
    const leadsByNiche = Object.entries(nicheCount).map(([niche, count]) => ({ niche, count })).sort((a, b) => b.count - a.count).slice(0, 6);
    const stateCount = {};
    for (const l of leads) {
      stateCount[l.state] = (stateCount[l.state] || 0) + 1;
    }
    const leadsByState = Object.entries(stateCount).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count).slice(0, 6);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - i);
      const str = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      days.push({ date: str, count: 0 });
    }
    for (const l of leads) {
      const lDate = new Date(l.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const found = days.find((d) => d.date === lDate);
      if (found) {
        found.count += 1;
      }
    }
    const pipelineStatuses2 = ["NOVO", "PR\xC9VIA CRIADA", "CONTATADO", "RESPONDEU", "INTERESSADO", "FOLLOW_UP", "NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO", "PERDIDO"];
    const pipelineDistribution = pipelineStatuses2.map((st) => ({
      status: st,
      count: leads.filter((l) => l.pipeline_status === st).length
    }));
    const topOpportunities = [...leads].filter((l) => l.pipeline_status === "NOVO" || l.pipeline_status === "PR\xC9VIA CRIADA").sort((a, b) => b.lead_score - a.lead_score).slice(0, 5);
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
      topOpportunities
    };
  }
  getFreelancerById(id) {
    return (this.data.freelancers || []).find((f) => f.id === id);
  }
  getActivities(params) {
    let list = [...this.data.activities || []];
    if (params?.freelancer_id && params.freelancer_id !== "ALL") {
      list = list.filter((a) => a.freelancer_id === params.freelancer_id);
    }
    if (params?.action_type && params.action_type !== "ALL") {
      list = list.filter((a) => a.action_type === params.action_type);
    }
    const total = list.length;
    const offset = params?.offset || 0;
    const limit = params?.limit || 50;
    return {
      activities: list.slice(offset, offset + limit),
      total
    };
  }
  getFreelancerPerformance(freelancerId) {
    const f = this.getFreelancerById(freelancerId);
    if (!f) return void 0;
    const leads = (this.data.leads || []).filter((l) => l.freelancer_id === freelancerId);
    const searches = (this.data.search_jobs || []).filter((j) => j.freelancer_id === freelancerId);
    const activities = (this.data.activities || []).filter((a) => a.freelancer_id === freelancerId);
    const leadsFound = leads.length;
    const contactedLeads = leads.filter(
      (l) => Boolean(l.contacted_at) || ["CONTATADO", "RESPONDEU", "INTERESSADO", "FOLLOW_UP", "NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO", "PERDIDO", "NAO_INTERESSADO", "SEM_RESPOSTA"].includes(l.pipeline_status)
    ).length;
    let contactAttempts = 0;
    for (const l of leads) {
      contactAttempts += l.contact_attempts_count || (l.contacted_at ? 1 : 0);
    }
    if (contactAttempts < contactedLeads) contactAttempts = contactedLeads;
    const responses = leads.filter(
      (l) => Boolean(l.response_at) || ["RESPONDEU", "INTERESSADO", "FOLLOW_UP", "NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO"].includes(l.pipeline_status)
    ).length;
    const followUps = leads.filter(
      (l) => Boolean(l.follow_up_at) || ["FOLLOW_UP", "NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO"].includes(l.pipeline_status)
    ).length;
    const negotiations = leads.filter(
      (l) => Boolean(l.negotiation_at) || ["NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO"].includes(l.pipeline_status)
    ).length;
    const sales = leads.filter(
      (l) => Boolean(l.sale_date) || l.pipeline_status === "FECHADO"
    ).length;
    const responseRate = contactedLeads > 0 ? Math.round(responses / contactedLeads * 100) : 0;
    const conversionRate = contactedLeads > 0 ? Math.round(sales / contactedLeads * 100) : 0;
    const activeDaysSet = /* @__PURE__ */ new Set();
    for (const l of leads) {
      if (l.created_at) activeDaysSet.add(l.created_at.split("T")[0]);
      if (l.contacted_at) activeDaysSet.add(l.contacted_at.split("T")[0]);
    }
    for (const a of activities) {
      if (a.created_at) activeDaysSet.add(a.created_at.split("T")[0]);
    }
    const days = [];
    const contactDays = [];
    for (let i = 6; i >= 0; i--) {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - i);
      const str = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      days.push({ date: str, count: 0 });
      contactDays.push({ date: str, count: 0 });
    }
    for (const l of leads) {
      const lDate = new Date(l.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const found = days.find((d) => d.date === lDate);
      if (found) found.count++;
      if (l.contacted_at) {
        const cDate = new Date(l.contacted_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
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
      contactsPerDay: contactDays
    };
  }
  getAdminDashboardStats(filter) {
    const freelancers = this.data.freelancers || [];
    const totalFreelancers = freelancers.length;
    const activeFreelancers = freelancers.filter((f) => f.status === "active").length;
    const blockedFreelancers = freelancers.filter((f) => f.status === "blocked").length;
    let leads = [...this.data.leads || []];
    let searches = [...this.data.search_jobs || []];
    let activities = [...this.data.activities || []];
    if (filter?.freelancer_id && filter.freelancer_id !== "ALL") {
      leads = leads.filter((l) => l.freelancer_id === filter.freelancer_id);
      searches = searches.filter((s) => s.freelancer_id === filter.freelancer_id);
      activities = activities.filter((a) => a.freelancer_id === filter.freelancer_id);
    }
    if (filter?.period && filter.period !== "ALL") {
      const now2 = Date.now();
      let msLimit = 0;
      if (filter.period === "today") msLimit = 24 * 3600 * 1e3;
      else if (filter.period === "7d") msLimit = 7 * 24 * 3600 * 1e3;
      else if (filter.period === "30d") msLimit = 30 * 24 * 3600 * 1e3;
      if (msLimit > 0) {
        leads = leads.filter((l) => now2 - new Date(l.created_at).getTime() <= msLimit);
        searches = searches.filter((s) => now2 - new Date(s.created_at).getTime() <= msLimit);
        activities = activities.filter((a) => now2 - new Date(a.created_at).getTime() <= msLimit);
      }
    }
    if (filter?.state && filter.state !== "ALL") {
      leads = leads.filter((l) => (l.state || "").toUpperCase() === filter.state.toUpperCase());
    }
    if (filter?.niche && filter.niche !== "ALL") {
      const normN = normalizeStr(filter.niche);
      leads = leads.filter((l) => normalizeStr(l.niche).includes(normN));
    }
    if (filter?.status && filter.status !== "ALL") {
      leads = leads.filter((l) => l.pipeline_status === filter.status);
    }
    const totalLeadsFound = leads.length;
    const totalLeadsContacted = leads.filter(
      (l) => Boolean(l.contacted_at) || ["CONTATADO", "RESPONDEU", "INTERESSADO", "FOLLOW_UP", "NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO", "PERDIDO", "NAO_INTERESSADO", "SEM_RESPOSTA"].includes(l.pipeline_status)
    ).length;
    const totalResponses = leads.filter(
      (l) => Boolean(l.response_at) || ["RESPONDEU", "INTERESSADO", "FOLLOW_UP", "NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO"].includes(l.pipeline_status)
    ).length;
    const totalFollowUps = leads.filter(
      (l) => Boolean(l.follow_up_at) || ["FOLLOW_UP", "NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO"].includes(l.pipeline_status)
    ).length;
    const totalNegotiations = leads.filter(
      (l) => Boolean(l.negotiation_at) || ["NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO"].includes(l.pipeline_status)
    ).length;
    const totalSales = leads.filter(
      (l) => Boolean(l.sale_date) || l.pipeline_status === "FECHADO"
    ).length;
    let totalSalesValue = 0;
    for (const l of leads) {
      if (l.pipeline_status === "FECHADO" || l.sale_date) {
        totalSalesValue += l.sale_value || 0;
      }
    }
    const overallResponseRate = totalLeadsContacted > 0 ? Math.round(totalResponses / totalLeadsContacted * 100) : 0;
    const overallConversionRate = totalLeadsContacted > 0 ? Math.round(totalSales / totalLeadsContacted * 100) : 0;
    const allPerformances = freelancers.map((f) => {
      return this.getFreelancerPerformance(f.id);
    }).filter(Boolean);
    const mostActiveFreelancers = [...allPerformances].sort((a, b) => {
      const scoreA = a.searchesCount * 5 + a.leadsContacted * 2 + a.leadsFound;
      const scoreB = b.searchesCount * 5 + b.leadsContacted * 2 + b.leadsFound;
      return scoreB - scoreA;
    });
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
      bestPerformingFreelancers
    };
  }
};

// src/lib/scoring/leadScore.ts
var DEFAULT_SCORING_WEIGHTS = {
  noWebsite: 30,
  withPhone: 20,
  highRating: 10,
  // rating >= 4.5
  reviewsOver50: 15,
  reviewsOver200: 15,
  activeProfile: 10
};
function calculateLeadScore(place, customWeights) {
  const weights = { ...DEFAULT_SCORING_WEIGHTS, ...customWeights };
  const isNoWebsite = (!place.website || place.website.trim() === "") && (place.website_status === "no_website" || !place.website_status);
  const hasPhone = Boolean(place.phone && place.phone.trim().length >= 8);
  const rating = Number(place.rating || 0);
  const isHighRating = rating >= 4.5;
  const reviewsCount = Number(place.reviews_count || 0);
  const isOver50Reviews = reviewsCount >= 50;
  const isOver200Reviews = reviewsCount >= 200;
  const isActiveProfile = !place.business_status || place.business_status === "OPERATIONAL";
  const reasons = [
    {
      label: "Sem site cadastrado",
      points: weights.noWebsite,
      applied: isNoWebsite
    },
    {
      label: "Telefone dispon\xEDvel para contato",
      points: weights.withPhone,
      applied: hasPhone
    },
    {
      label: "Avalia\xE7\xE3o excelente (>= 4.5 estrelas)",
      points: weights.highRating,
      applied: isHighRating
    },
    {
      label: "Mais de 50 avalia\xE7\xF5es de clientes",
      points: weights.reviewsOver50,
      applied: isOver50Reviews
    },
    {
      label: "Alta autoridade local (mais de 200 avalia\xE7\xF5es)",
      points: weights.reviewsOver200,
      applied: isOver200Reviews
    },
    {
      label: "Perfil ativo e operacional no Google",
      points: weights.activeProfile,
      applied: isActiveProfile
    }
  ];
  let rawTotal = 0;
  for (const r of reasons) {
    if (r.applied) {
      rawTotal += r.points;
    }
  }
  const score = Math.min(100, Math.max(0, rawTotal));
  let tier;
  if (score >= 70) {
    tier = "Alta oportunidade";
  } else if (score >= 40) {
    tier = "Boa oportunidade";
  } else {
    tier = "Baixa prioridade";
  }
  return {
    score,
    tier,
    reasons
  };
}

// src/server/security.ts
import crypto from "node:crypto";
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(pin, salt, 32).toString("hex")}`;
}
function verifyPin(pin, stored, legacy = false) {
  if (legacy) return crypto.timingSafeEqual(crypto.createHash("sha256").update(pin).digest(), crypto.createHash("sha256").update(stored).digest());
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(pin, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

// src/lib/store/repository.ts
var actorContext = new AsyncLocalStorage();
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var digest = (value) => crypto2.createHash("sha256").update(value).digest("hex");
var leadIdentity = (workspace, place, niche) => `lead_${digest(JSON.stringify([canonicalWorkspace(workspace), place, nicheKey(niche)]))}`;
function assertOwner(record) {
  const actor = actorContext.getStore();
  if (actor?.role === "freelancer" && !isLeadInWorkspace(record, actor.freelancerId)) throw Object.assign(new Error("Acesso negado ao workspace."), { status: 403 });
}
var clean = (value) => JSON.parse(JSON.stringify(value));
var mutableLeadFields = /* @__PURE__ */ new Set(["name", "phone", "address", "city", "state", "website", "website_status", "maps_url", "is_favorite", "is_hidden", "pipeline_status", "contacted_at", "contact_attempts_count", "response_at", "follow_up_at", "negotiation_at", "sale_value", "sale_date", "preview_url"]);
var pipelineStatuses = ["NOVO", "PR\xC9VIA CRIADA", "CONTATADO", "RESPONDEU", "INTERESSADO", "FOLLOW_UP", "NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO", "PERDIDO", "NAO_INTERESSADO", "SEM_RESPOSTA"];
var defaults = { googleMapsApiKey: "", hasCustomKey: false, maxResultsPerJob: 0, maxCitiesPerJob: 0, requestDelayMs: 400, scoringWeights: DEFAULT_SCORING_WEIGHTS };
var Repository = class {
  constructor(supplied) {
    this.supplied = supplied;
  }
  get firestore() {
    return this.supplied || getServerFirestore();
  }
  async list(collection, field, value) {
    const ref = this.firestore.collection(collection);
    const snap = await (field ? ref.where(field, "==", value) : ref).get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  }
  async get(collection, id) {
    const snap = await this.firestore.collection(collection).doc(id).get();
    return snap.exists ? { ...snap.data(), id: snap.id } : void 0;
  }
  async ensureInitialized() {
    await this.firestore.collection("settings").doc("config").get();
  }
  async ensureWorkspaceHydrated(_workspace, _force) {
    await this.ensureInitialized();
  }
  async syncFromFirestore() {
    const [leads, places] = await Promise.all([this.list("leads"), this.list("places")]);
    return { leadsCount: leads.length, placesCount: places.length };
  }
  async projection(includeAdmin = false) {
    return this.firestore.runTransaction(async (tx) => {
      const leads = await tx.get(this.firestore.collection("leads"));
      const tombs = await tx.get(this.firestore.collection("deleted_leads"));
      const deleted = new Set(tombs.docs.map((d) => d.id));
      const actor = actorContext.getStore();
      const rows = leads.docs.filter((d) => !deleted.has(d.id)).map((d) => ({ ...d.data(), id: d.id })).filter((l) => actor?.role !== "freelancer" || isLeadInWorkspace(l, actor.freelancerId));
      const data = { leads: rows, freelancers: [], activities: [], search_jobs: [] };
      if (includeAdmin) {
        for (const col of ["freelancers", "activities", "search_jobs"]) {
          const snap = await tx.get(this.firestore.collection(col));
          data[col] = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        }
        data.activities.sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
      return new Projections(data);
    }, { readOnly: true });
  }
  async getLeads(params) {
    const projection = await this.projection();
    return projection.getLeads(params);
  }
  async getLeadsCount() {
    return (await this.getLeads({ freelancer_id: "ALL", limit: 0 })).total;
  }
  async getNichesSummary(params) {
    return (await this.projection()).getNichesSummary(params);
  }
  async getStatesSummary(params) {
    return (await this.projection()).getStatesSummary(params);
  }
  async getDashboardStats(id) {
    return (await this.projection()).getDashboardStats(id);
  }
  async getPipelineBoard(id) {
    return (await this.projection()).getPipelineBoard(id);
  }
  async getAdminDashboardStats(filter) {
    return (await this.projection(true)).getAdminDashboardStats(filter);
  }
  async getFreelancerPerformance(id) {
    return (await this.projection(true)).getFreelancerPerformance(id);
  }
  async getActivities(params) {
    return (await this.projection(true)).getActivities(params);
  }
  async getLeadById(id) {
    const lead = await this.get("leads", id);
    if (lead) assertOwner(lead);
    return lead;
  }
  async getPlaceByPlaceId(id) {
    return this.get("places", id);
  }
  async isLeadDeleted(id) {
    return Boolean(await this.get("deleted_leads", id));
  }
  async upsertPlace(place) {
    await this.firestore.collection("places").doc(place.id).set(clean(place), { merge: true });
    return { place, isNew: true };
  }
  async createLead(lead) {
    assertOwner(lead);
    return this.firestore.runTransaction(async (tx) => this.createLeadInTransaction(tx, lead));
  }
  async createLeadInTransaction(tx, input) {
    const id = leadIdentity(ownerOf(input), input.place_id, input.niche);
    const ref = this.firestore.collection("leads").doc(id);
    const existing = await tx.get(this.firestore.collection("leads").where("place_id", "==", input.place_id));
    const legacyId = `lead_${input.freelancer_id || "admin"}_${input.place_id}`;
    const tombs = await tx.getAll(...[.../* @__PURE__ */ new Set([id, input.id, legacyId])].map((x) => this.firestore.collection("deleted_leads").doc(x)));
    const previous = existing.docs.map((d) => ({ ...d.data(), id: d.id })).find((l) => ownerOf(l) === ownerOf(input) && nicheKey(l.niche) === nicheKey(input.niche));
    if (previous) return { lead: previous, created: false, isDeleted: false };
    if (tombs.some((s) => s.exists)) return { lead: input, created: false, isDeleted: true };
    const lead = clean({ ...input, id, workspace_id: input.workspace_id || input.freelancer_id || "admin" });
    tx.create(ref, lead);
    return { lead, created: true, isDeleted: false };
  }
  async updateLead(id, updates, freelancerId) {
    return this.mutateLead(id, (lead) => {
      if (freelancerId && !isLeadInWorkspace(lead, freelancerId)) throw Object.assign(new Error("Acesso negado."), { status: 403 });
      if (updates.pipeline_status && !pipelineStatuses.includes(updates.pipeline_status)) throw Object.assign(new Error("Status inv\xE1lido."), { status: 400 });
      const fields = Object.fromEntries(Object.entries(updates).filter(([key]) => mutableLeadFields.has(key)));
      return { ...lead, ...fields };
    });
  }
  async mutateLead(id, change) {
    return this.firestore.runTransaction(async (tx) => {
      const ref = this.firestore.collection("leads").doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return void 0;
      const previous = { ...snap.data(), id };
      assertOwner(previous);
      const updated = clean({ ...change(previous), id, updated_at: now() });
      tx.set(ref, updated);
      return updated;
    });
  }
  async toggleFavoriteLead(id) {
    return this.mutateLead(id, (l) => ({ ...l, is_favorite: !l.is_favorite }));
  }
  async toggleHideLead(id, value) {
    return this.mutateLead(id, (l) => ({ ...l, is_hidden: value ?? !l.is_hidden }));
  }
  async contactLead(id) {
    return this.mutateLead(id, (l) => ({ ...l, contacted_at: now(), contact_attempts_count: (l.contact_attempts_count || 0) + 1, pipeline_status: ["NOVO", "PR\xC9VIA CRIADA"].includes(l.pipeline_status) ? "CONTATADO" : l.pipeline_status }));
  }
  async addLeadNote(leadId, userId, content) {
    const note = { id: crypto2.randomUUID(), lead_id: leadId, user_id: userId, content, created_at: now() };
    await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(this.firestore.collection("leads").doc(leadId));
      if (!snap.exists) throw new Error("Lead n\xE3o encontrado");
      assertOwner(snap.data());
      tx.create(this.firestore.collection("lead_notes").doc(note.id), note);
    });
    return note;
  }
  async getLeadNotes(id) {
    await this.getLeadById(id);
    return this.list("lead_notes", "lead_id", id);
  }
  async deleteLead(id, freelancerId) {
    return this.firestore.runTransaction(async (tx) => {
      const ref = this.firestore.collection("leads").doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const lead = { ...snap.data(), id };
      assertOwner(lead);
      if (freelancerId && !isLeadInWorkspace(lead, freelancerId)) throw Object.assign(new Error("Acesso negado"), { status: 403 });
      const tomb = { deleted_at: now(), workspace_id: ownerOf(lead), lead };
      tx.set(this.firestore.collection("deleted_leads").doc(id), tomb);
      const identity = leadIdentity(ownerOf(lead), lead.place_id, lead.niche);
      if (identity !== id) tx.set(this.firestore.collection("deleted_leads").doc(identity), tomb);
      tx.delete(ref);
      return true;
    });
  }
  async deleteMultipleLeads(ids, freelancerId) {
    let count = 0;
    for (const id of [...new Set(ids)]) if (await this.deleteLead(id, freelancerId)) count++;
    return count;
  }
  async deleteAllLeads(scope) {
    const target = scope.freelancerId || "admin";
    if (scope.role === "freelancer" && target === "ALL") throw Object.assign(new Error("Acesso negado"), { status: 403 });
    await this.cancelWorkspaceJobs(target);
    const leads = (await this.getLeads({ freelancer_id: target, limit: 0 })).leads;
    const deletedCount = await this.deleteMultipleLeads(leads.map((l) => l.id), target);
    return { deletedCount, leadIds: leads.map((l) => l.id) };
  }
  async purgeAllLeadsGlobal() {
    const jobsCancelled = await this.cancelWorkspaceJobs("ALL");
    const result = await this.deleteAllLeads({ freelancerId: "ALL", role: "admin" });
    return { ...result, jobsCancelled, firestoreDeletedCount: result.deletedCount };
  }
  async cleanFreelancerWorkspace(id) {
    return { leadsRemoved: (await this.deleteAllLeads({ freelancerId: id, role: "admin" })).deletedCount };
  }
  async cancelWorkspaceJobs(id) {
    const jobs = await this.getAllSearchJobs(id);
    for (const job of jobs.filter((j) => ["pending", "running", "paused", "failed"].includes(j.status))) await this.updateSearchJob(job.id, { status: "cancelled", lease_token: "", lease_until: 0 });
    return jobs.length;
  }
  async getFreelancers() {
    return (await this.list("freelancers")).filter((f) => !f.deleted_at);
  }
  async getFreelancerById(id) {
    const f = await this.get("freelancers", id);
    return f?.deleted_at ? void 0 : f;
  }
  async getFreelancerByAccessCode(code) {
    return (await this.getFreelancers()).find((f) => f.access_code?.toLowerCase() === code.trim().toLowerCase());
  }
  async createFreelancer(data) {
    const code = crypto2.randomBytes(24).toString("base64url");
    const f = clean({ ...data, id: `free_${crypto2.randomUUID()}`, access_code: code, status: data.status || "active", created_at: now(), updated_at: now() });
    if (f.pin) {
      f.pin_hash = hashPin(f.pin);
      delete f.pin;
    }
    await this.firestore.collection("freelancers").doc(f.id).create(f);
    await this.logActivity({ freelancer_id: f.id, action_type: "freelancer_created", description: "Freelancer cadastrado." });
    return f;
  }
  async updateFreelancer(id, updates) {
    if (updates.pin !== void 0) updates = { ...updates, pin_hash: updates.pin ? hashPin(updates.pin) : "", pin: "" };
    const allowed = ["name", "email", "notes", "pin", "pin_hash", "status", "last_access_at", "last_activity_at"];
    return this.firestore.runTransaction(async (tx) => {
      const ref = this.firestore.collection("freelancers").doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()?.deleted_at) return void 0;
      const f = clean({ ...snap.data(), ...Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k))), id, updated_at: now() });
      tx.set(ref, f);
      return f;
    });
  }
  async setFreelancerStatus(id, status) {
    return this.updateFreelancer(id, { status });
  }
  async regenerateFreelancerAccessCode(id) {
    const f = await this.getFreelancerById(id);
    if (!f) return void 0;
    const code = crypto2.randomBytes(24).toString("base64url");
    await this.firestore.collection("freelancers").doc(id).update({ access_code: code });
    return code;
  }
  async deleteFreelancer(id) {
    const f = await this.getFreelancerById(id);
    if (!f) return { success: false, leadsRemoved: 0, jobsRemoved: 0, activitiesRemoved: 0 };
    await this.updateFreelancer(id, { status: "blocked" });
    const jobsRemoved = await this.cancelWorkspaceJobs(id);
    const { leadsRemoved } = await this.cleanFreelancerWorkspace(id);
    await this.firestore.collection("freelancers").doc(id).update({ deleted_at: now() });
    return { success: true, name: f.name, leadsRemoved, jobsRemoved, activitiesRemoved: 0 };
  }
  async logActivity(activity) {
    const item = clean({ ...activity, id: crypto2.randomUUID(), created_at: now() });
    await this.firestore.collection("activities").doc(item.id).create(item);
    return item;
  }
  async getSearchJob(id) {
    const job = await this.get("search_jobs", id);
    if (job) assertOwner(job);
    return job;
  }
  async getAllSearchJobs(id) {
    const actor = actorContext.getStore();
    return (await this.list("search_jobs")).filter((j) => isLeadInWorkspace(j, id) && (actor?.role !== "freelancer" || isLeadInWorkspace(j, actor.freelancerId))).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async createSearchJob(job, areas = []) {
    await this.firestore.collection("search_jobs").doc(job.id).create(clean({ ...job, area_plan: areas }));
    return job;
  }
  async updateSearchJob(id, updates) {
    return this.firestore.runTransaction(async (tx) => {
      const ref = this.firestore.collection("search_jobs").doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return void 0;
      assertOwner(snap.data());
      const job = clean({ ...snap.data(), ...updates, id, updated_at: now() });
      tx.set(ref, job);
      return job;
    });
  }
  async getSearchAreas(id) {
    const job = await this.getSearchJob(id);
    return job?.area_plan || this.list("search_areas", "search_job_id", id);
  }
  async ensureSearchAreasLoaded(id) {
    return this.getSearchAreas(id);
  }
  async getSearchQueries(id) {
    await this.getSearchJob(id);
    return this.list("search_queries", "search_job_id", id);
  }
  async getSettings() {
    const config = await this.get("settings", "config");
    const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || config?.googleMapsApiKey || "";
    return { ...defaults, ...config, googleMapsApiKey: key, hasCustomKey: Boolean(key) };
  }
  async updateSettings(updates) {
    const allowed = ["googleMapsApiKey", "maxResultsPerJob", "maxCitiesPerJob", "requestDelayMs", "scoringWeights"];
    await this.firestore.collection("settings").doc("config").set(clean(Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)))), { merge: true });
    return this.getSettings();
  }
};
var db = new Repository();

// src/lib/search/searchWorker.ts
import crypto3 from "node:crypto";

// src/lib/google/places.ts
var OFFICIAL_PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.primaryType",
  "places.types",
  "places.googleMapsUri",
  "places.businessStatus"
].join(",");
function hasWebsite(rawWebsiteUri) {
  if (!rawWebsiteUri || rawWebsiteUri.trim() === "") {
    return { hasWebsite: false, status: "no_website" };
  }
  const trimmed = rawWebsiteUri.trim().toLowerCase();
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (url.hostname.length < 3 || !url.hostname.includes(".")) {
      return { hasWebsite: false, status: "invalid_website" };
    }
    return { hasWebsite: true, status: "website_found" };
  } catch {
    return { hasWebsite: false, status: "invalid_website" };
  }
}
function extractCityAndStateFromAddress(address) {
  if (!address) return {};
  const matchHyphen = address.match(/,\s*([A-Za-zÀ-ÿ\s.'-]+?)\s*-\s*([A-Z]{2})\b/);
  if (matchHyphen) {
    const rawCity = matchHyphen[1].trim();
    const rawUf = matchHyphen[2].trim();
    if (rawCity.length >= 2 && rawCity.length <= 40) {
      return { city: rawCity, state: rawUf };
    }
  }
  const matchComma = address.match(/,\s*([A-Za-zÀ-ÿ\s.'-]+?),\s*([A-Z]{2})\b/);
  if (matchComma) {
    const rawCity = matchComma[1].trim();
    const rawUf = matchComma[2].trim();
    if (rawCity.length >= 2 && rawCity.length <= 40) {
      return { city: rawCity, state: rawUf };
    }
  }
  return {};
}
function normalizePlace(raw, fallbackCity, fallbackState) {
  const placeId = raw.id || (raw.name ? raw.name.replace("places/", "") : `gen_${Date.now()}_${Math.random().toString(36).substring(7)}`);
  const displayName = raw.displayName?.text || "Estabelecimento sem nome";
  const address = raw.formattedAddress || "Endere\xE7o n\xE3o informado";
  const { status: websiteStatus } = hasWebsite(raw.websiteUri);
  const now2 = (/* @__PURE__ */ new Date()).toISOString();
  let postalCode;
  const cepMatch = address.match(/\d{5}-\d{3}/);
  if (cepMatch) {
    postalCode = cepMatch[0];
  }
  const extracted = extractCityAndStateFromAddress(address);
  const resolvedCity = extracted.city || fallbackCity;
  const resolvedState = extracted.state || fallbackState;
  return {
    id: placeId,
    place_id: placeId,
    name: displayName,
    formatted_address: address,
    city: resolvedCity,
    state: resolvedState,
    postal_code: postalCode,
    lat: raw.location?.latitude ?? 0,
    lng: raw.location?.longitude ?? 0,
    phone: raw.nationalPhoneNumber || void 0,
    website: raw.websiteUri || void 0,
    website_status: websiteStatus,
    rating: raw.rating ?? 0,
    reviews_count: raw.userRatingCount ?? 0,
    maps_url: raw.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${displayName} ${address}`)}`,
    business_status: raw.businessStatus || "OPERATIONAL",
    raw_types: raw.types || (raw.primaryType ? [raw.primaryType] : []),
    created_at: now2,
    updated_at: now2,
    last_fetched_at: now2
  };
}
var NICHE_TO_PLACE_TYPES = {
  barbearia: ["barber_shop", "hair_salon"],
  salao: ["beauty_salon", "hair_salon"],
  dentista: ["dentist", "dental_clinic"],
  odonto: ["dentist", "dental_clinic"],
  restaurante: ["restaurant"],
  pizzaria: ["restaurant", "meal_delivery"],
  academia: ["gym", "fitness_center"],
  estetica: ["beauty_salon", "spa"],
  advogado: ["lawyer"],
  oficina: ["car_repair"],
  mecanica: ["car_repair"],
  imobiliaria: ["real_estate_agency"],
  pet: ["pet_store", "veterinary_care"],
  contabilidade: ["accounting"],
  eletricista: ["electrician"],
  solar: ["point_of_interest"],
  fotografo: ["point_of_interest"]
};
function getIncludedTypesForQuery(query) {
  const norm = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const [key, types] of Object.entries(NICHE_TO_PLACE_TYPES)) {
    if (norm.includes(key)) {
      return types;
    }
  }
  return void 0;
}
async function searchPlacesNearby(apiKey, center, radius, includedTypes) {
  const endpoint = "https://places.googleapis.com/v1/places:searchNearby";
  const body = {
    locationRestriction: {
      circle: {
        center,
        radius: Math.max(1e3, Math.min(radius || 8e3, 5e4))
      }
    },
    maxResultCount: 20
  };
  if (includedTypes && includedTypes.length > 0) {
    body.includedTypes = includedTypes;
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": OFFICIAL_PLACES_FIELD_MASK
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errorJson = await response.json().catch(() => null);
      return {
        places: [],
        error: errorJson?.error?.message || `HTTP ${response.status}`
      };
    }
    const data = await response.json();
    return { places: data.places || [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { places: [], error: msg };
  }
}
async function searchPlacesOfficial(query, apiKey, options, maxRetries = 2) {
  if (!apiKey || apiKey.trim() === "") {
    return { places: [], error: "GOOGLE_MAPS_API_KEY_MISSING" };
  }
  const endpoint = "https://places.googleapis.com/v1/places:searchText";
  const body = {
    textQuery: query,
    languageCode: "pt-BR",
    maxResultCount: Math.min(options?.maxResultCount || 20, 20)
  };
  const centerLat = options?.locationBias?.circle?.center?.latitude;
  const centerLng = options?.locationBias?.circle?.center?.longitude;
  const hasValidCenter = typeof centerLat === "number" && typeof centerLng === "number" && centerLat !== 0 && centerLng !== 0;
  if (options?.locationBias?.circle && hasValidCenter) {
    body.locationBias = {
      circle: {
        center: {
          latitude: centerLat,
          longitude: centerLng
        },
        radius: options.locationBias.circle.radius || 12e3
      }
    };
  }
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": OFFICIAL_PLACES_FIELD_MASK
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        const errorMessage = errorJson?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
        lastError = errorMessage;
        if (hasValidCenter && (response.status === 429 || errorMessage.toLowerCase().includes("quota") || errorMessage.toLowerCase().includes("resource_exhausted"))) {
          console.warn("[Places] Cota de SearchTextRequest atingida, alternando para searchNearby...");
          const center = options?.locationBias?.circle?.center;
          if (center) {
            const types = getIncludedTypesForQuery(query);
            const nearbyRes = await searchPlacesNearby(apiKey, center, options?.locationBias?.circle?.radius || 12e3, types);
            if (nearbyRes.places && nearbyRes.places.length > 0) {
              return { places: nearbyRes.places };
            }
          }
        }
        const isTemporary = response.status === 503 || response.status === 500;
        if (isTemporary && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1e3));
          continue;
        }
        break;
      }
      const data = await response.json();
      if (data.places && data.places.length > 0) {
        return { places: data.places };
      }
      if (hasValidCenter && options?.locationBias?.circle?.center) {
        const types = getIncludedTypesForQuery(query);
        const nearbyRes = await searchPlacesNearby(apiKey, options.locationBias.circle.center, options.locationBias.circle.radius || 12e3, types);
        if (nearbyRes.places && nearbyRes.places.length > 0) {
          return { places: nearbyRes.places };
        }
      }
      return { places: [] };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1e3));
      }
    }
  }
  if (hasValidCenter && options?.locationBias?.circle?.center) {
    try {
      const types = getIncludedTypesForQuery(query);
      const nearbyRes = await searchPlacesNearby(apiKey, options.locationBias.circle.center, options.locationBias.circle.radius || 12e3, types);
      if (nearbyRes.places && nearbyRes.places.length > 0) {
        return { places: nearbyRes.places };
      }
    } catch {
    }
  }
  return { places: [], error: lastError };
}

// src/lib/google/searchPage.ts
async function searchPage(query, key, options = {}) {
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY_MISSING");
  const body = { textQuery: query, languageCode: "pt-BR", pageSize: 20 };
  if (options.pageToken) body.pageToken = options.pageToken;
  if (options.lat && options.lng) body.locationBias = { circle: { center: { latitude: options.lat, longitude: options.lng }, radius: options.radius || 12e3 } };
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    signal: AbortSignal.timeout(1e4),
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": `${OFFICIAL_PLACES_FIELD_MASK},nextPageToken` },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw Object.assign(new Error(`PLACES_HTTP_${response.status}`), { status: response.status });
  const data = await response.json();
  if (data.places !== void 0 && !Array.isArray(data.places)) throw new Error("PLACES_INVALID_RESPONSE");
  return { places: data.places || [], nextPageToken: data.nextPageToken };
}

// src/lib/ibge/ibgeService.ts
var BRAZILIAN_STATES = [
  { id: 12, sigla: "AC", nome: "Acre" },
  { id: 27, sigla: "AL", nome: "Alagoas" },
  { id: 16, sigla: "AP", nome: "Amap\xE1" },
  { id: 13, sigla: "AM", nome: "Amazonas" },
  { id: 29, sigla: "BA", nome: "Bahia" },
  { id: 23, sigla: "CE", nome: "Cear\xE1" },
  { id: 53, sigla: "DF", nome: "Distrito Federal" },
  { id: 32, sigla: "ES", nome: "Esp\xEDrito Santo" },
  { id: 52, sigla: "GO", nome: "Goi\xE1s" },
  { id: 21, sigla: "MA", nome: "Maranh\xE3o" },
  { id: 51, sigla: "MT", nome: "Mato Grosso" },
  { id: 50, sigla: "MS", nome: "Mato Grosso do Sul" },
  { id: 31, sigla: "MG", nome: "Minas Gerais" },
  { id: 15, sigla: "PA", nome: "Par\xE1" },
  { id: 25, sigla: "PB", nome: "Para\xEDba" },
  { id: 41, sigla: "PR", nome: "Paran\xE1" },
  { id: 26, sigla: "PE", nome: "Pernambuco" },
  { id: 22, sigla: "PI", nome: "Piau\xED" },
  { id: 33, sigla: "RJ", nome: "Rio de Janeiro" },
  { id: 24, sigla: "RN", nome: "Rio Grande do Norte" },
  { id: 43, sigla: "RS", nome: "Rio Grande do Sul" },
  { id: 11, sigla: "RO", nome: "Rond\xF4nia" },
  { id: 14, sigla: "RR", nome: "Roraima" },
  { id: 42, sigla: "SC", nome: "Santa Catarina" },
  { id: 35, sigla: "SP", nome: "S\xE3o Paulo" },
  { id: 28, sigla: "SE", nome: "Sergipe" },
  { id: 17, sigla: "TO", nome: "Tocantins" }
];
var POPULAR_CITIES_BY_STATE = {
  SP: ["S\xE3o Paulo", "Campinas", "Guarulhos", "S\xE3o Bernardo do Campo", "Santo Andr\xE9", "Osasco", "Ribeir\xE3o Preto", "Sorocaba", "Santos", "S\xE3o Jos\xE9 dos Campos", "Jundia\xED", "Piracicaba", "Bauru", "Franca"],
  RJ: ["Rio de Janeiro", "S\xE3o Gon\xE7alo", "Duque de Caxias", "Nova Igua\xE7u", "Niter\xF3i", "Belford Roxo", "Campos dos Goytacazes", "Petr\xF3polis", "Volta Redonda", "Cabo Frio"],
  MG: ["Belo Horizonte", "Uberl\xE2ndia", "Contagem", "Juiz de Fora", "Betim", "Montes Claros", "Ribeir\xE3o das Neves", "Uberaba", "Governador Valadares", "Ipatinga"],
  PR: ["Curitiba", "Londrina", "Maring\xE1", "Ponta Grossa", "Cascavel", "S\xE3o Jos\xE9 dos Pinhais", "Foz do Igua\xE7u", "Colombo", "Guarapuava"],
  RS: ["Porto Alegre", "Caxias do Sul", "Canoas", "Pelotas", "Santa Maria", "Gravata\xED", "Viam\xE3o", "Novo Hamburgo", "S\xE3o Leopoldo"],
  SC: ["Florian\xF3polis", "Joinville", "Blumenau", "S\xE3o Jos\xE9", "Chapec\xF3", "Itaja\xED", "Crici\xFAma", "Jaragu\xE1 do Sul", "Palho\xE7a", "Balne\xE1rio Cambori\xFA"],
  BA: ["Salvador", "Feira de Santana", "Vit\xF3ria da Conquista", "Cama\xE7ari", "Juazeiro", "Itabuna", "Lauro de Freitas", "Ilh\xE9us"],
  PE: ["Recife", "Jaboat\xE3o dos Guararapes", "Olinda", "Caruaru", "Petrolina", "Paulista", "Cabo de Santo Agostinho"],
  CE: ["Fortaleza", "Caucaia", "Juazeiro do Norte", "Maracana\xFA", "Sobral", "Crato", "Itapipoca"],
  GO: ["Goi\xE2nia", "Aparecida de Goi\xE2nia", "An\xE1polis", "Rio Verde", "\xC1guas Lindas de Goi\xE1s", "Luzi\xE2nia", "Valpara\xEDso de Goi\xE1s"],
  ES: ["Vit\xF3ria", "Vila Velha", "Serra", "Cariacica", "Cachoeiro de Itapemirim", "Linhares", "S\xE3o Mateus", "Colatina"],
  DF: ["Bras\xEDlia", "Taguatinga", "Ceil\xE2ndia", "\xC1guas Claras", "Samambaia", "Plano Piloto"],
  AM: ["Manaus", "Parintins", "Itacoatiara", "Manacapuru", "Coari"],
  PA: ["Bel\xE9m", "Ananindeua", "Santar\xE9m", "Marab\xE1", "Parauapebas", "Castanhal"],
  MT: ["Cuiab\xE1", "V\xE1rzea Grande", "Rondon\xF3polis", "Sinop", "Tangar\xE1 da Serra"],
  MS: ["Campo Grande", "Dourados", "Tr\xEAs Lagoas", "Corumb\xE1", "Ponta Por\xE3"],
  RN: ["Natal", "Mossor\xF3", "Parnamirim", "S\xE3o Gon\xE7alo do Amarante"],
  PB: ["Jo\xE3o Pessoa", "Campina Grande", "Santa Rita", "Patos", "Bayeux"],
  AL: ["Macei\xF3", "Arapiraca", "Rio Largo", "Palmeira dos \xCDndios"],
  MA: ["S\xE3o Lu\xEDs", "Imperatriz", "S\xE3o Jos\xE9 de Ribamar", "Timon", "Caxias"],
  PI: ["Teresina", "Parna\xEDba", "Picos", "Piripiri", "Floriano"],
  SE: ["Aracaju", "Nossa Senhora do Socorro", "Lagarto", "Itabaiana", "S\xE3o Crist\xF3v\xE3o"],
  RO: ["Porto Velho", "Ji-Paran\xE1", "Ariquemes", "Vilhena", "Cacoal"],
  TO: ["Palmas", "Aragua\xEDna", "Gurupi", "Porto Nacional"],
  AC: ["Rio Branco", "Cruzeiro do Sul", "Sena Madureira"],
  AP: ["Macap\xE1", "Santana", "Laranjal do Jari"],
  RR: ["Boa Vista", "Rorain\xF3polis", "Caracara\xED"]
};
var CITY_COORDINATES = {
  "S\xE3o Paulo": { lat: -23.5505, lng: -46.6333 },
  "Campinas": { lat: -22.9056, lng: -47.0608 },
  "Santos": { lat: -23.9608, lng: -46.3336 },
  "Sorocaba": { lat: -23.5015, lng: -47.4526 },
  "Ribeir\xE3o Preto": { lat: -21.1767, lng: -47.8108 },
  "S\xE3o Jos\xE9 dos Campos": { lat: -23.1791, lng: -45.8872 },
  "Rio de Janeiro": { lat: -22.9068, lng: -43.1729 },
  "Niter\xF3i": { lat: -22.8833, lng: -43.1039 },
  "Belo Horizonte": { lat: -19.9167, lng: -43.9345 },
  "Curitiba": { lat: -25.4284, lng: -49.2733 },
  "Porto Alegre": { lat: -30.0346, lng: -51.2177 },
  "Florian\xF3polis": { lat: -27.5954, lng: -48.548 },
  "Salvador": { lat: -12.9714, lng: -38.5014 },
  "Recife": { lat: -8.0476, lng: -34.877 },
  "Fortaleza": { lat: -3.7172, lng: -38.5433 },
  "Bras\xEDlia": { lat: -15.7975, lng: -47.8919 },
  "Goi\xE2nia": { lat: -16.6869, lng: -49.2648 },
  "Vit\xF3ria": { lat: -20.3155, lng: -40.3128 },
  "Cuiab\xE1": { lat: -15.6014, lng: -56.0979 },
  "Campo Grande": { lat: -20.4697, lng: -54.6201 },
  "Manaus": { lat: -3.119, lng: -60.0217 },
  "Bel\xE9m": { lat: -1.4558, lng: -48.4902 },
  "Natal": { lat: -5.7945, lng: -35.211 },
  "Jo\xE3o Pessoa": { lat: -7.1195, lng: -34.845 },
  "Macei\xF3": { lat: -9.6658, lng: -35.7353 },
  "S\xE3o Lu\xEDs": { lat: -2.5307, lng: -44.3068 },
  "Teresina": { lat: -5.092, lng: -42.8038 },
  "Aracaju": { lat: -10.9472, lng: -37.0731 },
  "Porto Velho": { lat: -8.7619, lng: -63.9039 },
  "Palmas": { lat: -10.2491, lng: -48.3243 },
  "Rio Branco": { lat: -9.9754, lng: -67.8249 },
  "Macap\xE1": { lat: 0.0356, lng: -51.0705 },
  "Boa Vista": { lat: 2.8235, lng: -60.6758 }
};
var METROPOLITAN_GRIDS = {
  "S\xE3o Paulo": [
    { name: "S\xE3o Paulo - Centro / Rep\xFAblica / S\xE9", lat: -23.5475, lng: -46.6361, radius: 4e3 },
    { name: "S\xE3o Paulo - Paulista / Jardins / Bela Vista", lat: -23.5615, lng: -46.6559, radius: 4e3 },
    { name: "S\xE3o Paulo - Pinheiros / Vila Madalena", lat: -23.5673, lng: -46.702, radius: 4500 },
    { name: "S\xE3o Paulo - Moema / Vila Mariana / Ibirapuera", lat: -23.6022, lng: -46.6622, radius: 4500 },
    { name: "S\xE3o Paulo - Itaim Bibi / Vila Ol\xEDmpia / Morumbi", lat: -23.5936, lng: -46.6855, radius: 5e3 },
    { name: "S\xE3o Paulo - Tatuap\xE9 / Mooca / An\xE1lia Franco", lat: -23.5401, lng: -46.5772, radius: 5e3 },
    { name: "S\xE3o Paulo - Santana / Tucuruvi (Zona Norte)", lat: -23.5042, lng: -46.6264, radius: 6e3 },
    { name: "S\xE3o Paulo - Santo Amaro / Interlagos (Zona Sul)", lat: -23.6534, lng: -46.7088, radius: 6500 },
    { name: "S\xE3o Paulo - Lapa / Perdizes / Pomp\xE9ia (Zona Oeste)", lat: -23.5287, lng: -46.6851, radius: 4500 },
    { name: "S\xE3o Paulo - Penha / Itaquera (Zona Leste)", lat: -23.535, lng: -46.471, radius: 7e3 }
  ],
  "Rio de Janeiro": [
    { name: "Rio de Janeiro - Centro / Lapa", lat: -22.9068, lng: -43.1729, radius: 4e3 },
    { name: "Rio de Janeiro - Copacabana / Ipanema / Leblon", lat: -22.9711, lng: -43.1822, radius: 4500 },
    { name: "Rio de Janeiro - Botafogo / Flamengo / Tijuca", lat: -22.9519, lng: -43.1843, radius: 5e3 },
    { name: "Rio de Janeiro - Barra da Tijuca / Recreio", lat: -23.0003, lng: -43.3659, radius: 7500 },
    { name: "Rio de Janeiro - M\xE9ier / Madureira (Zona Norte)", lat: -22.892, lng: -43.279, radius: 6e3 }
  ],
  "Belo Horizonte": [
    { name: "Belo Horizonte - Centro / Savassi / Lourdes", lat: -19.9324, lng: -43.9381, radius: 4e3 },
    { name: "Belo Horizonte - Pampulha / Castelo", lat: -19.8519, lng: -43.9785, radius: 5e3 },
    { name: "Belo Horizonte - Barreiro / Buritis", lat: -19.9723, lng: -44.0201, radius: 5500 },
    { name: "Belo Horizonte - Venda Nova / Santa In\xEAs", lat: -19.8145, lng: -43.957, radius: 5500 }
  ],
  "Curitiba": [
    { name: "Curitiba - Centro / Batel / Bigorrilho", lat: -25.4372, lng: -49.278, radius: 4e3 },
    { name: "Curitiba - Port\xE3o / \xC1gua Verde / Santa Quit\xE9ria", lat: -25.4678, lng: -49.2932, radius: 4500 },
    { name: "Curitiba - Boqueir\xE3o / Hauer / Pinheirinho", lat: -25.5029, lng: -49.2458, radius: 5500 },
    { name: "Curitiba - Boa Vista / Bacacheri / Cabral", lat: -25.395, lng: -49.248, radius: 5e3 }
  ],
  "Campinas": [
    { name: "Campinas - Centro / Cambu\xED / Guanabara", lat: -22.9056, lng: -47.0608, radius: 4500 },
    { name: "Campinas - Taquaral / Bar\xE3o Geraldo / Mans\xF5es", lat: -22.8689, lng: -47.0583, radius: 6e3 },
    { name: "Campinas - Ouro Verde / Campo Grande", lat: -22.9675, lng: -47.1278, radius: 7e3 },
    { name: "Campinas - Nova Campinas / Alphaville", lat: -22.885, lng: -47.025, radius: 5500 }
  ],
  "Salvador": [
    { name: "Salvador - Centro / Barra / Ondina", lat: -13.0033, lng: -38.5283, radius: 4500 },
    { name: "Salvador - Pituba / Itaigara / Caminho das \xC1rvores", lat: -12.9922, lng: -38.4628, radius: 5e3 },
    { name: "Salvador - Cabula / Brotas", lat: -12.9667, lng: -38.4833, radius: 5500 },
    { name: "Salvador - Itapu\xE3 / Stella Maris", lat: -12.9356, lng: -38.3611, radius: 6500 }
  ],
  "Bras\xEDlia": [
    { name: "Bras\xEDlia - Asa Sul / Asa Norte (Plano Piloto)", lat: -15.7975, lng: -47.8919, radius: 5500 },
    { name: "Bras\xEDlia - Taguatinga / Samambaia", lat: -15.8333, lng: -48.0567, radius: 6500 },
    { name: "Bras\xEDlia - \xC1guas Claras / Guar\xE1", lat: -15.84, lng: -47.98, radius: 5500 },
    { name: "Bras\xEDlia - Ceil\xE2ndia", lat: -15.82, lng: -48.11, radius: 6500 }
  ],
  "Porto Alegre": [
    { name: "Porto Alegre - Centro Hist\xF3rico / Moinhos de Vento", lat: -30.0346, lng: -51.2177, radius: 4500 },
    { name: "Porto Alegre - Menino Deus / Praia de Belas / Azenha", lat: -30.055, lng: -51.225, radius: 4500 },
    { name: "Porto Alegre - Petr\xF3polis / Bela Vista", lat: -30.04, lng: -51.185, radius: 5e3 },
    { name: "Porto Alegre - Zona Norte / Sarandi", lat: -29.995, lng: -51.145, radius: 6e3 }
  ],
  "Goi\xE2nia": [
    { name: "Goi\xE2nia - Setor Bueno / Marista / Oeste", lat: -16.698, lng: -49.268, radius: 4500 },
    { name: "Goi\xE2nia - Centro / Setor Central / Aeroporto", lat: -16.678, lng: -49.255, radius: 4500 },
    { name: "Goi\xE2nia - Jardim Goi\xE1s / Flamboyant", lat: -16.71, lng: -49.235, radius: 5e3 }
  ]
};
var memoryCitiesCache = /* @__PURE__ */ new Map();
async function fetchStates() {
  try {
    const res = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome", {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(4e3)
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch {
  }
  return BRAZILIAN_STATES;
}
async function fetchCitiesByState(uf, requireComplete = false) {
  const upperUf = uf.toUpperCase().trim();
  if (memoryCitiesCache.has(upperUf)) {
    return memoryCitiesCache.get(upperUf);
  }
  try {
    const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${upperUf}/municipios`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(6e3)
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        data.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        memoryCitiesCache.set(upperUf, data);
        return data;
      }
    }
  } catch {
  }
  if (requireComplete) throw new Error("IBGE_UNAVAILABLE: a lista completa de cidades n\xE3o foi obtida.");
  const popular = POPULAR_CITIES_BY_STATE[upperUf] || ["Capital", "Regi\xE3o Central", "Interior"];
  const fallbackCities = popular.map((name, index) => ({
    id: 1e3 + index,
    nome: name
  }));
  return fallbackCities;
}

// src/lib/search/searchWorker.ts
async function createAndPrepareSearchJob(params, repo = db) {
  const settings = await repo.getSettings();
  let cities = params.city === "all" ? [.../* @__PURE__ */ new Set([...POPULAR_CITIES_BY_STATE[params.state] || [], ...(await fetchCitiesByState(params.state, true)).map((c) => c.nome)])] : [params.city];
  if (settings.maxCitiesPerJob > 0) cities = cities.slice(0, settings.maxCitiesPerJob);
  if (!cities.length) throw new Error("N\xE3o foi poss\xEDvel determinar as cidades da busca.");
  const id = `job_${crypto3.randomUUID()}`;
  const areas = cities.flatMap((city) => {
    const coord = CITY_COORDINATES[city];
    const cells = METROPOLITAN_GRIDS[city] || [{ lat: coord?.lat || 0, lng: coord?.lng || 0, radius: 12e3 }];
    return cells.map((cell, i) => ({ id: `${id}_${digest(city).slice(0, 12)}_${i}`, search_job_id: id, city, state: params.state, ...cell, status: "pending", attempts: 0, places_found: 0 }));
  });
  const job = { id, version: 2, user_id: params.userId, workspace_id: params.freelancerId || "admin", freelancer_id: params.freelancerId, freelancer_name: params.freelancerName, state: params.state, city: params.city, niche: params.niche, filters: params.filters, status: "pending", target_leads: params.filters.targetLeads || 0, total_cities: cities.length, processed_cities: 0, total_search_areas: areas.length, processed_search_areas: 0, places_found: 0, places_without_website: 0, leads_created: 0, approved_count: 0, duplicates_count: 0, rejected_count: 0, deleted_count: 0, results_count: 0, area_cursor: 0, candidate_cursor: 0, created_at: now(), updated_at: now() };
  await repo.createSearchJob(job, areas);
  return { job, estimatedQueries: areas.length, totalCities: cities.length, totalAreas: areas.length };
}
function checkLeadFilters(place, filters) {
  return (!filters.onlyWithoutWebsite || !place.website?.trim() && place.website_status === "no_website") && (!filters.onlyWithPhone || (place.phone?.replace(/\D/g, "").length || 0) >= 8) && (place.rating || 0) >= filters.minRating && (place.reviews_count || 0) >= filters.minReviews && (!filters.maxReviews || (place.reviews_count || 0) <= filters.maxReviews) && (!place.business_status || place.business_status === "OPERATIONAL");
}
var clean2 = (value) => JSON.parse(JSON.stringify(value));
async function runSearchJob(jobId, repo = db, fetchPage = searchPage, budgetMs = 25e3) {
  const started = Date.now();
  const token = crypto3.randomUUID();
  const ref = repo.firestore.collection("search_jobs").doc(jobId);
  const claimed = await repo.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const j = snap.data();
    if (!["pending", "running"].includes(j.status) || (j.retry_at || 0) > Date.now() || (j.lease_until || 0) > Date.now()) return false;
    if (j.version !== 2) {
      tx.update(ref, { status: "paused", error_message: "Busca hist\xF3rica: revisar antes de executar novamente." });
      return false;
    }
    tx.update(ref, { status: "running", lease_token: token, lease_until: Date.now() + 45e3, started_at: j.started_at || now(), updated_at: now() });
    return true;
  }, { maxAttempts: 1 }).catch((error) => {
    if (error.code === 10) return false;
    throw error;
  });
  if (!claimed) return false;
  const guarded = async (fn) => repo.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const j = snap.data();
    if (!j || j.status !== "running" || j.lease_token !== token || (j.lease_until || 0) <= Date.now()) return void 0;
    return fn(tx, j);
  }, { maxAttempts: 1 }).catch((error) => {
    if (error.code === 10) return void 0;
    throw error;
  });
  try {
    const settings = await repo.getSettings();
    while (Date.now() - started < budgetMs) {
      const job = await repo.getSearchJob(jobId);
      if (!job || job.status !== "running" || job.lease_token !== token) break;
      const cursor = job.area_cursor || 0;
      const area = job.area_plan?.[cursor];
      if (job.target_leads > 0 && job.leads_created >= job.target_leads || !area) {
        await guarded(async (tx, j) => {
          tx.update(ref, { status: "completed", completion_reason: area ? "target_reached" : "exhausted", finished_at: now(), lease_token: "", lease_until: 0, updated_at: now() });
          return true;
        });
        break;
      }
      if (!job.candidates) {
        const page = await fetchPage(`${job.niche} em ${area.city} ${area.state}`, settings.googleMapsApiKey, { pageToken: job.page_token, lat: area.lat, lng: area.lng, radius: area.radius });
        if (page.nextPageToken && page.nextPageToken === job.page_token) throw new Error("PLACES_REPEATED_PAGE_TOKEN");
        await guarded(async (tx, j) => {
          tx.update(ref, { candidates: clean2(page.places), candidate_cursor: 0, next_page_token: page.nextPageToken || "", updated_at: now() });
          return true;
        });
        continue;
      }
      if ((job.candidate_cursor || 0) >= job.candidates.length) {
        await guarded(async (tx, j) => {
          const plan = [...j.area_plan || []];
          const a = plan[cursor];
          if (!j.next_page_token) plan[cursor] = { ...a, status: "completed", processed_at: now() };
          const next = j.next_page_token ? cursor : cursor + 1;
          const citiesDone = new Set(plan.filter((x) => x.status === "completed").map((x) => x.city));
          for (const a2 of plan.filter((x) => x.status !== "completed")) citiesDone.delete(a2.city);
          tx.update(ref, { area_plan: clean2(plan), area_cursor: next, page_token: j.next_page_token || "", next_page_token: "", candidates: null, candidate_cursor: 0, processed_search_areas: next, processed_cities: citiesDone.size, updated_at: now() });
          return true;
        });
        break;
      }
      const raw = job.candidates[job.candidate_cursor || 0];
      await guarded(async (tx, j) => {
        const place = normalizePlace(raw, area.city, area.state);
        if (!raw.id && !raw.name) throw new Error("PLACES_MISSING_ID");
        const receiptRef = repo.firestore.collection("search_results").doc(digest(`${jobId}:${place.place_id}`));
        const receipt = await tx.get(receiptRef);
        const patch = { candidate_cursor: (j.candidate_cursor || 0) + 1, updated_at: now(), attempts: 0 };
        if (receipt.exists) {
          tx.update(ref, patch);
          return;
        }
        const approved = isPlaceRelevantToNiche(place, j.niche) && checkLeadFilters(place, j.filters) && place.state === j.state;
        patch.places_found = j.places_found + 1;
        patch.places_without_website = j.places_without_website + (place.website_status === "no_website" ? 1 : 0);
        let result = "rejected";
        let leadId;
        if (approved) {
          const lead = clean2({ id: leadIdentity(ownerOf(j), place.place_id, j.niche), workspace_id: j.workspace_id, user_id: j.user_id, freelancer_id: j.freelancer_id, freelancer_name: j.freelancer_name, place_id: place.place_id, name: place.name, niche: j.niche, state: place.state, city: place.city, address: place.formatted_address, phone: place.phone, website: place.website, website_status: place.website_status, maps_url: place.maps_url, rating: place.rating, reviews_count: place.reviews_count, lead_score: calculateLeadScore(place, settings.scoringWeights).score, pipeline_status: "NOVO", search_job_ids: [j.id], created_at: now(), updated_at: now() });
          const saved = await repo.createLeadInTransaction(tx, lead);
          result = saved.isDeleted ? "deleted" : saved.created ? "created" : "duplicate";
          leadId = saved.isDeleted ? void 0 : saved.lead.id;
          if (!saved.created && !saved.isDeleted) tx.update(repo.firestore.collection("leads").doc(saved.lead.id), { search_job_ids: [.../* @__PURE__ */ new Set([...saved.lead.search_job_ids || [], j.id])] });
          patch.approved_count = (j.approved_count || 0) + 1;
          patch.leads_created = j.leads_created + (saved.created ? 1 : 0);
          patch.duplicates_count = (j.duplicates_count || 0) + (result === "duplicate" ? 1 : 0);
          patch.deleted_count = (j.deleted_count || 0) + (result === "deleted" ? 1 : 0);
          patch.results_count = (j.results_count || 0) + (leadId ? 1 : 0);
        } else patch.rejected_count = (j.rejected_count || 0) + 1;
        tx.set(repo.firestore.collection("places").doc(place.id), clean2(place), { merge: true });
        tx.create(receiptRef, clean2({ job_id: jobId, workspace_id: j.workspace_id, place_id: place.place_id, lead_id: leadId, result, created_at: now() }));
        tx.update(ref, patch);
      });
    }
  } catch (error) {
    await guarded(async (tx, j) => {
      const attempts = (j.attempts || 0) + 1;
      tx.update(ref, { attempts, status: attempts >= 5 ? "failed" : "running", retry_at: Date.now() + Math.min(6e4, 1e3 * 2 ** attempts), error_message: "Falha de processamento. Checkpoint preservado para nova tentativa.", updated_at: now() });
      return true;
    });
    throw error;
  } finally {
    await guarded(async (tx) => {
      tx.update(ref, { lease_token: "", lease_until: 0 });
      return true;
    });
  }
  return true;
}
async function pauseSearchJob(id, repo = db) {
  return Boolean(await repo.updateSearchJob(id, { status: "paused", lease_token: "", lease_until: 0 }));
}
async function cancelSearchJob(id, repo = db) {
  return Boolean(await repo.updateSearchJob(id, { status: "cancelled", lease_token: "", lease_until: 0, finished_at: now() }));
}
async function resumeSearchJob(id, repo = db) {
  const job = await repo.getSearchJob(id);
  if (!job || job.version !== 2 || ["completed", "cancelled"].includes(job.status)) return false;
  return Boolean(await repo.updateSearchJob(id, { status: "pending", lease_token: "", lease_until: 0, retry_at: 0, attempts: 0, error_message: "" }));
}
async function cleanupStaleJobs() {
  return 0;
}
async function dispatchSearchJobs(repo = db) {
  const jobs = (await repo.getAllSearchJobs("ALL")).filter((j) => ["pending", "running"].includes(j.status)).sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  for (const job of jobs) {
    if (await runSearchJob(job.id, repo)) return job.id;
  }
  return null;
}

// src/server/app.ts
import { z } from "zod";

// src/lib/supabase/migrations.ts
var SUPABASE_MIGRATIONS_SQL = `-- Migration: Schema Inicial do ProspectaPlaces B2B
-- Criado para PostgreSQL e Supabase com Row Level Security (RLS)

-- 1. EXTENS\xD5ES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABELA: profiles (Usu\xE1rios)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  company_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. TABELA: places (Estabelecimentos identificados via Google Places)
CREATE TABLE IF NOT EXISTS public.places (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  formatted_address TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  phone TEXT,
  website TEXT,
  website_status TEXT NOT NULL DEFAULT 'not_verified',
  rating NUMERIC(3, 2),
  reviews_count INTEGER DEFAULT 0,
  maps_url TEXT,
  business_status TEXT DEFAULT 'OPERATIONAL',
  raw_types JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  last_fetched_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- \xCDndices em places
CREATE INDEX IF NOT EXISTS idx_places_place_id ON public.places(place_id);
CREATE INDEX IF NOT EXISTS idx_places_state_city ON public.places(state, city);
CREATE INDEX IF NOT EXISTS idx_places_website_status ON public.places(website_status);

-- 4. TABELA: search_jobs (Tarefas de busca ass\xEDncronas)
CREATE TABLE IF NOT EXISTS public.search_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  city TEXT NOT NULL,
  niche TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, paused, completed, failed, cancelled
  total_cities INTEGER NOT NULL DEFAULT 0,
  processed_cities INTEGER NOT NULL DEFAULT 0,
  total_search_areas INTEGER NOT NULL DEFAULT 0,
  processed_search_areas INTEGER NOT NULL DEFAULT 0,
  places_found INTEGER NOT NULL DEFAULT 0,
  places_without_website INTEGER NOT NULL DEFAULT 0,
  leads_created INTEGER NOT NULL DEFAULT 0,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_search_jobs_user_id ON public.search_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_search_jobs_status ON public.search_jobs(status);

-- 5. TABELA: search_areas (Subdivis\xF5es geogr\xE1ficas e grid)
CREATE TABLE IF NOT EXISTS public.search_areas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  search_job_id UUID NOT NULL REFERENCES public.search_jobs(id) ON DELETE CASCADE,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  radius INTEGER NOT NULL DEFAULT 5000,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
  attempts INTEGER NOT NULL DEFAULT 0,
  places_found INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_search_areas_job_id ON public.search_areas(search_job_id);
CREATE INDEX IF NOT EXISTS idx_search_areas_status ON public.search_areas(status);

-- 6. TABELA: search_queries (Auditoria de consultas enviadas \xE0 Google Places API)
CREATE TABLE IF NOT EXISTS public.search_queries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  search_job_id UUID NOT NULL REFERENCES public.search_jobs(id) ON DELETE CASCADE,
  search_area_id UUID REFERENCES public.search_areas(id) ON DELETE SET NULL,
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  results_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_search_queries_job_id ON public.search_queries(search_job_id);

-- 7. TABELA: leads (Oportunidades qualificadas para prospec\xE7\xE3o comercial)
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES public.places(place_id) ON DELETE CASCADE,
  niche TEXT NOT NULL,
  website_status TEXT NOT NULL DEFAULT 'no_website',
  lead_score INTEGER NOT NULL DEFAULT 0,
  pipeline_status TEXT NOT NULL DEFAULT 'NOVO', -- NOVO, PR\xC9VIA CRIADA, CONTATADO, RESPONDEU, INTERESSADO, REUNI\xC3O, PROPOSTA, FECHADO, PERDIDO
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  contacted_at TIMESTAMPTZ,
  -- Evitar duplicar o mesmo lead para o mesmo usu\xE1rio e nicho
  CONSTRAINT unique_user_place_niche UNIQUE (user_id, place_id, niche)
);

CREATE INDEX IF NOT EXISTS idx_leads_user_id ON public.leads(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline_status ON public.leads(pipeline_status);
CREATE INDEX IF NOT EXISTS idx_leads_score ON public.leads(lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_niche ON public.leads(niche);

-- 8. TABELA: lead_notes (Hist\xF3rico de notas e intera\xE7\xF5es de contato)
CREATE TABLE IF NOT EXISTS public.lead_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id ON public.lead_notes(lead_id);

-- 9. TABELA: pipeline_history (Hist\xF3rico de movimenta\xE7\xE3o de status no Kanban)
CREATE TABLE IF NOT EXISTS public.pipeline_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_pipeline_history_lead_id ON public.pipeline_history(lead_id);

-- 10. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_history ENABLE ROW LEVEL SECURITY;

-- Profiles: cada usu\xE1rio v\xEA e edita o seu perfil
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Search Jobs: isolamento total por usu\xE1rio
CREATE POLICY "Users can manage own search jobs" ON public.search_jobs FOR ALL USING (auth.uid() = user_id);

-- Search Areas e Queries: vinculados ao search_job do usu\xE1rio
CREATE POLICY "Users can view areas for their jobs" ON public.search_areas FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.search_jobs WHERE id = search_areas.search_job_id AND user_id = auth.uid())
);
CREATE POLICY "Users can view queries for their jobs" ON public.search_queries FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.search_jobs WHERE id = search_queries.search_job_id AND user_id = auth.uid())
);

-- Leads: isolamento total por usu\xE1rio
CREATE POLICY "Users can manage own leads" ON public.leads FOR ALL USING (auth.uid() = user_id);

-- Lead Notes: notas apenas do usu\xE1rio criador
CREATE POLICY "Users can manage own lead notes" ON public.lead_notes FOR ALL USING (auth.uid() = user_id);

-- Pipeline History: hist\xF3rico apenas do usu\xE1rio
CREATE POLICY "Users can view own pipeline history" ON public.pipeline_history FOR SELECT USING (auth.uid() = user_id);
`;

// src/server/app.ts
dotenv.config();
var app = express();
app.set("json replacer", (key, value) => ["pin", "pin_hash"].includes(key) ? void 0 : value);
app.use(express.json({ limit: "256kb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, private");
  next();
});
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-matched-path, x-forwarded-uri");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});
var ADMIN_DEFAULT_EMAIL = process.env.ADMIN_EMAIL || "";
var ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "";
function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 random characters.");
  return secret;
}
var revokedTokens = { async add(token) {
  await db.firestore.collection("revoked_sessions").doc(digest(token)).set({ revoked_at: (/* @__PURE__ */ new Date()).toISOString() });
} };
function signSession(payload) {
  const data = Buffer.from(JSON.stringify({ ...payload, sid: crypto4.randomUUID() })).toString("base64url");
  const signature = crypto4.createHmac("sha256", sessionSecret()).update(data).digest("base64url");
  return `${data}.${signature}`;
}
function verifySession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, signature] = parts;
  const expectedSig = crypto4.createHmac("sha256", sessionSecret()).update(data).digest("base64url");
  if (signature.length !== expectedSig.length) return null;
  if (!crypto4.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now() || !["admin", "freelancer"].includes(payload.role)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
app.use("/api", async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers["x-access-token"];
  const token = authHeader ? authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : authHeader.trim() : "";
  if (!token) {
    req.user = void 0;
    return next();
  }
  const payload = verifySession(token);
  if (!payload || await db.get("revoked_sessions", digest(token))) {
    req.user = void 0;
    return next();
  }
  if (payload.role === "admin") {
    req.user = {
      role: "admin",
      id: payload.id || "admin_1",
      email: payload.email || ADMIN_DEFAULT_EMAIL,
      name: "Gustavo Santos (Admin)"
    };
    return next();
  }
  if (payload.role === "freelancer") {
    let freelancer = await db.getFreelancerById(payload.freelancerId) || await db.getFreelancerByAccessCode(payload.accessCode);
    if (!freelancer) {
      try {
        await db.syncFromFirestore();
        freelancer = await db.getFreelancerById(payload.freelancerId) || await db.getFreelancerByAccessCode(payload.accessCode);
      } catch (syncErr) {
        console.warn("[Server] Falha ao sincronizar com Firestore na autentica\xE7\xE3o:", syncErr);
      }
    }
    if (!freelancer) {
      req.user = void 0;
      return next();
    }
    if (freelancer.status !== "active" || freelancer.access_code !== payload.accessCode) {
      return res.status(403).json({
        error: "Acesso desativado",
        blocked: true,
        message: "Seu acesso ao GHProspec\xE7\xE3o foi desativado. Entre em contato com o administrador."
      });
    }
    req.user = {
      role: "freelancer",
      id: freelancer.id,
      freelancerId: freelancer.id,
      name: freelancer.name,
      email: freelancer.email,
      freelancer
    };
    return next();
  }
  req.user = void 0;
  next();
});
app.use("/api", (req, res, next) => actorContext.run(req.user ? { role: req.user.role, freelancerId: req.user.freelancerId } : { role: "anonymous" }, next));
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: "N\xE3o autenticado",
      message: "Sess\xE3o necess\xE1ria para acessar este recurso."
    });
  }
  if (req.user.role === "freelancer" && req.user.freelancer?.status === "blocked") {
    return res.status(403).json({
      error: "Acesso desativado",
      blocked: true,
      message: "Seu acesso ao GHProspec\xE7\xE3o foi desativado."
    });
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: "N\xE3o autenticado",
      message: "Autentica\xE7\xE3o de administrador necess\xE1ria."
    });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({
      error: "Acesso negado",
      message: "Apenas administradores podem acessar este recurso."
    });
  }
  next();
}
function resolveWorkspaceScope(req) {
  if (!req.user) {
    const err = new Error("N\xE3o autenticado");
    err.status = 401;
    throw err;
  }
  if (req.user.role === "freelancer") {
    const userFid = req.user.freelancerId;
    const queryFid2 = req.query.freelancer_id ? String(req.query.freelancer_id).trim() : req.query.workspace_id ? String(req.query.workspace_id).trim() : void 0;
    const bodyFid2 = req.body?.freelancer_id ? String(req.body.freelancer_id).trim() : req.body?.workspace_id ? String(req.body.workspace_id).trim() : void 0;
    const requestedFid = queryFid2 || bodyFid2;
    if (requestedFid) {
      if (requestedFid === "ALL" || !matchesFreelancerId(userFid, requestedFid)) {
        const err = new Error("Acesso negado: Voc\xEA n\xE3o tem permiss\xE3o para acessar ou modificar dados de outro workspace.");
        err.status = 403;
        throw err;
      }
    }
    return {
      role: "freelancer",
      workspaceId: userFid,
      freelancerId: userFid,
      isInspectingFreelancer: false
    };
  }
  const queryFid = req.query.freelancer_id ? String(req.query.freelancer_id).trim() : req.query.workspace_id ? String(req.query.workspace_id).trim() : void 0;
  const bodyFid = req.body?.freelancer_id ? String(req.body.freelancer_id).trim() : req.body?.workspace_id ? String(req.body.workspace_id).trim() : void 0;
  const targetFid = queryFid || bodyFid;
  if (targetFid === "ALL") {
    return {
      role: "admin",
      workspaceId: "ALL",
      freelancerId: "ALL",
      isInspectingFreelancer: false
    };
  }
  if (targetFid && targetFid !== "admin" && targetFid !== "administrador" && targetFid !== "free_admin" && targetFid !== "free_administrador") {
    return {
      role: "admin",
      workspaceId: targetFid,
      freelancerId: targetFid,
      isInspectingFreelancer: true
    };
  }
  return {
    role: "admin",
    workspaceId: "admin",
    freelancerId: "admin",
    isInspectingFreelancer: false
  };
}
app.use(["/api/admin/login", "/api/freelancer/auth/verify"], async (req, res, next) => {
  if (req.method !== "POST") return next();
  const key = digest(`${req.ip}:${String(req.body.email || req.body.accessCode || "").toLowerCase()}`);
  const allowed = await db.firestore.runTransaction(async (tx) => {
    const ref = db.firestore.collection("auth_attempts").doc(key);
    const snap = await tx.get(ref);
    const data = snap.data();
    const reset = !data || data.until < Date.now();
    const count = reset ? 0 : data.count;
    if (count >= 20) return false;
    tx.set(ref, { count: count + 1, until: reset ? Date.now() + 15 * 60 * 1e3 : data.until });
    return true;
  });
  if (!allowed) return res.status(429).json({ error: "Muitas tentativas. Aguarde antes de tentar novamente." });
  next();
});
app.get("/api", (_req, res) => {
  res.json({
    status: "ok",
    service: "ProspectaPlaces B2B Engine API",
    time: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.post("/api/sync", requireAuth, async (_req, res) => {
  try {
    const result = await db.syncFromFirestore();
    const stats = await db.getDashboardStats();
    res.json({
      success: true,
      message: "Sincroniza\xE7\xE3o com o Firestore conclu\xEDda com sucesso!",
      leadsCount: result.leadsCount,
      placesCount: result.placesCount,
      stats
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/admin/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email e senha s\xE3o obrigat\xF3rios." });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPass = String(password).trim();
  const isValidAdmin = Boolean(ADMIN_DEFAULT_EMAIL && ADMIN_DEFAULT_PASSWORD.length >= 12) && cleanEmail === ADMIN_DEFAULT_EMAIL.toLowerCase() && crypto4.timingSafeEqual(crypto4.createHash("sha256").update(cleanPass).digest(), crypto4.createHash("sha256").update(ADMIN_DEFAULT_PASSWORD).digest());
  if (!isValidAdmin) {
    return res.status(401).json({ error: "Credenciais de administrador inv\xE1lidas." });
  }
  const token = signSession({
    role: "admin",
    id: "admin_1",
    email: cleanEmail,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1e3
  });
  return res.json({
    success: true,
    user: {
      id: "admin_1",
      email: cleanEmail,
      name: "Gustavo Santos",
      role: "admin"
    },
    token
  });
});
app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({
    user: req.user
  });
});
app.post("/api/admin/logout", requireAdmin, async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (token) {
    await revokedTokens.add(token);
  }
  res.json({ success: true });
});
app.post("/api/auth/login", (_req, res) => res.status(410).json({ error: "Use /api/admin/login." }));
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
app.post("/api/auth/logout", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (token) {
    await revokedTokens.add(token);
  }
  res.json({ success: true });
});
app.post("/api/freelancer/auth/verify", async (req, res) => {
  const { accessCode, pin } = req.body;
  if (!accessCode) {
    return res.status(400).json({ error: "C\xF3digo de acesso do freelancer \xE9 obrigat\xF3rio." });
  }
  let freelancer = await db.getFreelancerByAccessCode(String(accessCode));
  if (!freelancer) {
    try {
      await db.syncFromFirestore();
      freelancer = await db.getFreelancerByAccessCode(String(accessCode));
    } catch (err) {
      console.warn("[Server] Falha ao sincronizar Firestore ao verificar c\xF3digo:", err);
    }
  }
  if (!freelancer) {
    return res.status(404).json({
      error: "Link de acesso n\xE3o encontrado",
      message: "Este link de acesso ao GHProspec\xE7\xE3o n\xE3o existe ou foi revogado."
    });
  }
  if (freelancer.status === "blocked") {
    return res.status(403).json({
      error: "Acesso desativado",
      blocked: true,
      message: "Seu acesso ao GHProspec\xE7\xE3o foi desativado. Entre em contato com o administrador."
    });
  }
  if (freelancer.status === "inactive") {
    return res.status(403).json({
      error: "Acesso inativo",
      message: "Seu cadastro est\xE1 inativo no momento. Entre em contato com o administrador."
    });
  }
  if (freelancer.pin_hash || freelancer.pin) {
    if (typeof pin !== "string" || !verifyPin(pin.trim(), freelancer.pin_hash || freelancer.pin, !freelancer.pin_hash)) {
      return res.status(401).json({
        error: "PIN incorreto",
        requiresPin: true,
        message: "Informe o PIN de 4 a 6 d\xEDgitos cadastrado para este acesso."
      });
    }
  }
  const token = signSession({
    role: "freelancer",
    freelancerId: freelancer.id,
    accessCode: freelancer.access_code,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1e3
  });
  const updated = await db.updateFreelancer(freelancer.id, {
    last_access_at: (/* @__PURE__ */ new Date()).toISOString(),
    last_activity_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  await db.logActivity({
    freelancer_id: freelancer.id,
    freelancer_name: freelancer.name,
    action_type: "login",
    description: `${freelancer.name} acessou seu workspace individual via link exclusivo.`,
    metadata: { access_code: freelancer.access_code }
  });
  return res.json({
    success: true,
    token,
    freelancer: updated || freelancer
  });
});
app.post("/api/freelancer/logout", requireAuth, async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (token) {
    await revokedTokens.add(token);
  }
  res.json({ success: true });
});
app.get("/api/freelancer/me", async (req, res) => {
  if (!req.user || req.user.role !== "freelancer" || !req.user.freelancer) {
    return res.status(401).json({ error: "Sess\xE3o de freelancer n\xE3o encontrada ou expirada." });
  }
  const f = await db.getFreelancerById(req.user.freelancer.id);
  if (!f || f.status === "blocked") {
    return res.status(403).json({
      error: "Acesso desativado",
      blocked: true,
      message: "Seu acesso ao GHProspec\xE7\xE3o foi desativado. Entre em contato com o administrador."
    });
  }
  res.json({ freelancer: f });
});
app.post("/api/freelancer/workspace/reset", requireAuth, async (req, res) => {
  try {
    let freelancerId;
    if (req.user.role === "freelancer") {
      freelancerId = req.user.freelancerId;
    } else {
      freelancerId = req.body?.freelancerId || req.query.freelancer_id;
    }
    if (!freelancerId) {
      return res.status(400).json({ error: "Identifica\xE7\xE3o do freelancer \xE9 obrigat\xF3ria para zerar o workspace." });
    }
    const result = await db.cleanFreelancerWorkspace(freelancerId);
    res.json({
      success: true,
      leadsRemoved: result.leadsRemoved,
      message: `Workspace zerado com sucesso! ${result.leadsRemoved} leads foram removidos.`
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/admin/dashboard/stats", requireAdmin, async (req, res) => {
  try {
    const stats = await db.getAdminDashboardStats({
      freelancer_id: req.query.freelancer_id,
      period: req.query.period,
      state: req.query.state,
      niche: req.query.niche,
      status: req.query.status
    });
    res.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/admin/freelancers", requireAdmin, async (_req, res) => {
  try {
    const freelancers = await db.getFreelancers();
    const enriched = freelancers.map(async (f) => {
      const perf = await db.getFreelancerPerformance(f.id);
      return {
        ...f,
        performance: perf
      };
    });
    res.json(await Promise.all(enriched));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/admin/freelancers", requireAdmin, async (req, res) => {
  try {
    const { name, email, access_code, notes, pin, status } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: "Nome e e-mail s\xE3o obrigat\xF3rios para cadastrar um freelancer." });
    }
    const freelancer = await db.createFreelancer({
      name,
      email,
      access_code,
      notes,
      pin,
      status: status || "active"
    });
    const perf = await db.getFreelancerPerformance(freelancer.id);
    res.status(201).json({
      success: true,
      freelancer: { ...freelancer, performance: perf },
      accessLink: `/f/${freelancer.access_code}`
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/admin/freelancers/:id", requireAdmin, async (req, res) => {
  try {
    const f = await db.getFreelancerById(req.params.id);
    if (!f) {
      return res.status(404).json({ error: "Freelancer n\xE3o encontrado." });
    }
    const performance = await db.getFreelancerPerformance(f.id);
    res.json({ freelancer: f, performance });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.patch("/api/admin/freelancers/:id", requireAdmin, async (req, res) => {
  try {
    const updated = await db.updateFreelancer(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: "Freelancer n\xE3o encontrado." });
    }
    const perf = await db.getFreelancerPerformance(updated.id);
    res.json({ success: true, freelancer: { ...updated, performance: perf } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/admin/freelancers/:id/block", requireAdmin, async (req, res) => {
  try {
    const updated = await db.setFreelancerStatus(req.params.id, "blocked");
    if (!updated) {
      return res.status(404).json({ error: "Freelancer n\xE3o encontrado." });
    }
    res.json({ success: true, freelancer: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/admin/freelancers/:id/unblock", requireAdmin, async (req, res) => {
  try {
    const updated = await db.setFreelancerStatus(req.params.id, "active");
    if (!updated) {
      return res.status(404).json({ error: "Freelancer n\xE3o encontrado." });
    }
    res.json({ success: true, freelancer: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/admin/freelancers/:id/regenerate-link", requireAdmin, async (req, res) => {
  try {
    const newCode = await db.regenerateFreelancerAccessCode(req.params.id);
    if (!newCode) {
      return res.status(404).json({ error: "Freelancer n\xE3o encontrado." });
    }
    const updated = await db.getFreelancerById(req.params.id);
    res.json({ success: true, accessCode: newCode, accessLink: `/f/${newCode}`, freelancer: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.delete("/api/admin/freelancers/:id", requireAdmin, async (req, res) => {
  try {
    const result = await db.deleteFreelancer(req.params.id);
    if (!result.success) {
      return res.status(404).json({ error: "Freelancer n\xE3o encontrado." });
    }
    res.json({
      success: true,
      message: `Workspace "${result.name || req.params.id}" e todos os dados associados (${result.leadsRemoved} leads, ${result.jobsRemoved} buscas e ${result.activitiesRemoved} atividades) foram exclu\xEDdos permanentemente.`,
      details: result
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/admin/freelancers/:id/reset", requireAdmin, async (req, res) => {
  try {
    const result = await db.cleanFreelancerWorkspace(req.params.id);
    res.json({
      success: true,
      leadsRemoved: result.leadsRemoved,
      message: `Workspace zerado com sucesso! ${result.leadsRemoved} leads foram removidos.`
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/admin/leads/purge-global", requireAdmin, async (req, res) => {
  try {
    const confirmation = (req.body?.confirmation || "").toString().trim().toUpperCase();
    const validConfirmations = ["ZERAR_TODOS_OS_LEADS", "ZERAR TUDO", "CONFIRMAR", "EXCLUIR_TODOS_OS_LEADS"];
    if (!validConfirmations.includes(confirmation)) {
      return res.status(400).json({
        error: "Confirma\xE7\xE3o inv\xE1lida",
        message: 'Para zerar permanentemente todos os leads de todos os workspaces, confirme enviando "ZERAR_TODOS_OS_LEADS" ou "ZERAR TUDO".'
      });
    }
    const result = await db.purgeAllLeadsGlobal();
    res.json({
      success: true,
      deletedCount: result.deletedCount,
      jobsCancelled: result.jobsCancelled,
      firestoreDeletedCount: result.firestoreDeletedCount,
      message: `Opera\xE7\xE3o conclu\xEDda com sucesso: ${result.deletedCount} leads foram permanentemente removidos de todos os workspaces (Admin e Freelancers).`
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.delete("/api/leads/all", requireAuth, async (req, res) => {
  try {
    const isGlobalRequested = req.query.global === "true" || req.body?.global === true || req.query.freelancer_id === "ALL" || req.body?.freelancer_id === "ALL";
    if (isGlobalRequested) {
      if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Apenas administradores podem executar a limpeza global de todos os workspaces." });
      }
      const result2 = await db.purgeAllLeadsGlobal();
      return res.json({
        success: true,
        deletedCount: result2.deletedCount,
        jobsCancelled: result2.jobsCancelled,
        firestoreDeletedCount: result2.firestoreDeletedCount,
        message: `Todos os leads de TODOS os workspaces foram exclu\xEDdos permanentemente (${result2.deletedCount} estabelecimentos removidos).`
      });
    }
    const scope = resolveWorkspaceScope(req);
    const targetFreelancerId = scope.role === "freelancer" ? scope.freelancerId : scope.isInspectingFreelancer ? scope.freelancerId : "admin";
    const result = await db.deleteAllLeads({
      freelancerId: targetFreelancerId,
      role: req.user.role
    });
    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `${result.deletedCount} leads exclu\xEDdos com sucesso do workspace.`
    });
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});
app.post("/api/leads/delete-all", requireAuth, async (req, res) => {
  try {
    const isGlobalRequested = req.query.global === "true" || req.body?.global === true || req.query.freelancer_id === "ALL" || req.body?.freelancer_id === "ALL";
    if (isGlobalRequested) {
      if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Apenas administradores podem executar a limpeza global de todos os workspaces." });
      }
      const result2 = await db.purgeAllLeadsGlobal();
      return res.json({
        success: true,
        deletedCount: result2.deletedCount,
        jobsCancelled: result2.jobsCancelled,
        firestoreDeletedCount: result2.firestoreDeletedCount,
        message: `Todos os leads de TODOS os workspaces foram exclu\xEDdos permanentemente (${result2.deletedCount} estabelecimentos removidos).`
      });
    }
    const scope = resolveWorkspaceScope(req);
    const targetFreelancerId = scope.role === "freelancer" ? scope.freelancerId : scope.isInspectingFreelancer ? scope.freelancerId : "admin";
    const result = await db.deleteAllLeads({
      freelancerId: targetFreelancerId,
      role: req.user.role
    });
    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `${result.deletedCount} leads exclu\xEDdos com sucesso do workspace.`
    });
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});
app.post("/api/leads/batch-delete", requireAuth, async (req, res) => {
  try {
    const { leadIds } = req.body;
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: "leadIds deve ser um array com os IDs dos leads." });
    }
    if (req.user.role === "freelancer") {
      for (const id of leadIds) {
        const lead = await db.getLeadById(id);
        if (lead && !matchesFreelancerId(lead.freelancer_id, req.user.freelancerId) && lead.workspace_id !== req.user.freelancerId) {
          return res.status(403).json({ error: "Acesso negado: um ou mais leads pertencem a outro workspace." });
        }
      }
    }
    const deletedCount = await db.deleteMultipleLeads(leadIds, req.user?.freelancerId);
    res.json({ success: true, deletedCount });
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});
app.delete("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const leadId = req.params.id;
    const lead = await db.getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !matchesFreelancerId(lead.freelancer_id, req.user.freelancerId) && lead.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso negado: este lead n\xE3o pertence ao seu workspace." });
    }
    await db.deleteLead(leadId, req.user?.freelancerId);
    res.json({ success: true, message: "Lead exclu\xEDdo com sucesso." });
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});
app.post("/api/leads/:id/delete", requireAuth, async (req, res) => {
  try {
    const leadId = req.params.id;
    const lead = await db.getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !matchesFreelancerId(lead.freelancer_id, req.user.freelancerId) && lead.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso negado: este lead n\xE3o pertence ao seu workspace." });
    }
    await db.deleteLead(leadId, req.user?.freelancerId);
    res.json({ success: true, message: "Lead exclu\xEDdo com sucesso." });
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});
app.get("/api/admin/freelancers/:id/leads", requireAdmin, async (req, res) => {
  try {
    const leads = await db.getLeads({ freelancer_id: req.params.id, limit: 500 });
    res.json(leads);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/admin/freelancers/:id/searches", requireAdmin, async (req, res) => {
  try {
    const searches = await db.getAllSearchJobs(req.params.id);
    res.json(searches);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/admin/freelancers/:id/activities", requireAdmin, async (req, res) => {
  try {
    const result = await db.getActivities({ freelancer_id: req.params.id, limit: 100 });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/admin/activities", requireAdmin, async (req, res) => {
  try {
    const { freelancer_id, action_type, limit, offset } = req.query;
    const result = await db.getActivities({
      freelancer_id,
      action_type,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/ibge/states", async (_req, res) => {
  try {
    const states = await fetchStates();
    res.json(states);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/ibge/cities", async (req, res) => {
  try {
    const uf = req.query.uf || "SP";
    const cities = await fetchCitiesByState(uf);
    res.json(cities);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/ibge/cities/:uf", async (req, res) => {
  try {
    const uf = req.params.uf;
    const cities = await fetchCitiesByState(uf);
    res.json(cities);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/dashboard/stats", requireAuth, async (req, res) => {
  try {
    const scope = resolveWorkspaceScope(req);
    const stats = await db.getDashboardStats(scope.freelancerId);
    res.json(stats);
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});
app.get("/api/niches", requireAuth, async (req, res) => {
  try {
    const onlyFavorites = req.query.onlyFavorites === "true";
    const scope = resolveWorkspaceScope(req);
    const niches = await db.getNichesSummary({ onlyFavorites, freelancer_id: scope.freelancerId });
    res.json(niches);
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});
app.get("/api/states-summary", requireAuth, async (req, res) => {
  try {
    const onlyFavorites = req.query.onlyFavorites === "true";
    const niche = req.query.niche;
    const scope = resolveWorkspaceScope(req);
    const states = await db.getStatesSummary({ onlyFavorites, niche, freelancer_id: scope.freelancerId });
    res.json(states);
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});
app.get("/api/leads", requireAuth, async (req, res) => {
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
      limit
    } = req.query;
    const scope = resolveWorkspaceScope(req);
    const result = await db.getLeads({
      search_job_id: req.query.search_job_id,
      freelancer_id: scope.freelancerId,
      state,
      city,
      niche,
      onlyWithoutWebsite: onlyWithoutWebsite === "true",
      onlyWithPhone: onlyWithPhone === "true",
      onlyFavorites: onlyFavorites === "true",
      excludeHidden: req.query.excludeHidden === "true",
      onlyHidden: req.query.onlyHidden === "true",
      minRating: minRating ? Number(minRating) : void 0,
      minReviews: minReviews ? Number(minReviews) : void 0,
      minScore: minScore ? Number(minScore) : void 0,
      status,
      search,
      sortBy,
      page: page ? Number(page) : 1,
      limit: limit === "all" || limit === "0" || limit === "-1" ? 0 : limit ? Number(limit) : 50
    });
    res.json(result);
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});
app.get("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !matchesFreelancerId(lead.freelancer_id, req.user.freelancerId) && lead.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso negado: este lead n\xE3o pertence ao seu workspace." });
    }
    const notes = await db.getLeadNotes(lead.id);
    const place = await db.getPlaceByPlaceId(lead.place_id);
    res.json({ lead, notes, place });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.patch("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const oldLead = await db.getLeadById(req.params.id);
    if (!oldLead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !matchesFreelancerId(oldLead.freelancer_id, req.user.freelancerId) && oldLead.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso negado: este lead n\xE3o pertence ao seu workspace." });
    }
    const safeUpdates = { ...req.body };
    delete safeUpdates.workspace_id;
    delete safeUpdates.freelancer_id;
    delete safeUpdates.user_id;
    const freelancerId = req.user.role === "freelancer" ? req.user.freelancerId : void 0;
    const updated = await db.updateLead(req.params.id, safeUpdates, freelancerId);
    if (!updated) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado ou acesso n\xE3o autorizado." });
    }
    if (safeUpdates.pipeline_status && oldLead.pipeline_status !== safeUpdates.pipeline_status) {
      const actorId = req.user.freelancerId || oldLead.freelancer_id || "admin_1";
      const actorName = req.user.name || oldLead.freelancer_name || "Usu\xE1rio";
      let actionType = "status_changed";
      if (safeUpdates.pipeline_status === "CONTATADO") actionType = "lead_contacted";
      else if (safeUpdates.pipeline_status === "RESPONDEU") actionType = "response_registered";
      else if (safeUpdates.pipeline_status === "FOLLOW_UP") actionType = "follow_up_registered";
      else if (safeUpdates.pipeline_status === "NEGOCIACAO") actionType = "negotiation_started";
      else if (safeUpdates.pipeline_status === "FECHADO") actionType = "sale_registered";
      await db.logActivity({
        freelancer_id: actorId,
        freelancer_name: actorName,
        action_type: actionType,
        description: `${actorName} moveu "${updated.name}" para ${safeUpdates.pipeline_status}`,
        metadata: { lead_id: updated.id, old_status: oldLead.pipeline_status, new_status: safeUpdates.pipeline_status }
      });
    }
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/leads/:id/contact-attempt", requireAuth, async (req, res) => {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    if (req.user.role === "freelancer" && !matchesFreelancerId(lead.freelancer_id, req.user.freelancerId) && lead.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso n\xE3o autorizado a este lead." });
    }
    const currentAttempts = lead.contact_attempts_count || (lead.contacted_at ? 1 : 0);
    const newStatus = lead.pipeline_status === "NOVO" || lead.pipeline_status === "PR\xC9VIA CRIADA" ? "CONTATADO" : lead.pipeline_status;
    const updated = await db.contactLead(lead.id);
    const actorId = req.user.freelancerId || lead.freelancer_id || "admin_1";
    const actorName = req.user.name || lead.freelancer_name || "Usu\xE1rio";
    await db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: "lead_contacted",
      description: `${actorName} registrou tentativa de contato com "${lead.name}" (${currentAttempts + 1}\xAA abordagem)`,
      metadata: { lead_id: lead.id, channel: req.body.channel || "WhatsApp" }
    });
    res.json({ success: true, lead: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/leads/:id/register-sale", requireAuth, async (req, res) => {
  try {
    const { value } = req.body;
    const lead = await db.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    if (req.user.role === "freelancer" && !matchesFreelancerId(lead.freelancer_id, req.user.freelancerId) && lead.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso n\xE3o autorizado a este lead." });
    }
    const saleVal = Number(value) || 0;
    const updated = await db.updateLead(lead.id, {
      pipeline_status: "FECHADO",
      sale_value: saleVal,
      sale_date: (/* @__PURE__ */ new Date()).toISOString()
    });
    const actorId = req.user.freelancerId || lead.freelancer_id || "admin_1";
    const actorName = req.user.name || lead.freelancer_name || "Usu\xE1rio";
    await db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: "sale_registered",
      description: `${actorName} registrou VENDA FECHADA para "${lead.name}" (R$ ${saleVal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})`,
      metadata: { lead_id: lead.id, sale_value: saleVal }
    });
    res.json({ success: true, lead: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/leads/:id/favorite", requireAuth, async (req, res) => {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !matchesFreelancerId(lead.freelancer_id, req.user.freelancerId) && lead.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso negado: este lead pertence a outro workspace." });
    }
    const updated = await db.toggleFavoriteLead(req.params.id);
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/leads/:id/hide", requireAuth, async (req, res) => {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !matchesFreelancerId(lead.freelancer_id, req.user.freelancerId) && lead.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso negado: este lead pertence a outro workspace." });
    }
    const explicitValue = typeof req.body?.is_hidden === "boolean" ? req.body.is_hidden : void 0;
    const updated = await db.toggleHideLead(req.params.id, explicitValue);
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/leads/:id/notes", requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Conte\xFAdo da observa\xE7\xE3o n\xE3o pode ser vazio." });
    }
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !matchesFreelancerId(lead.freelancer_id, req.user.freelancerId) && lead.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso negado: este lead pertence a outro workspace." });
    }
    const userId = req.user.role === "freelancer" ? req.user.freelancerId : req.user.id;
    const note = await db.addLeadNote(req.params.id, userId, content.trim());
    const actorId = req.user.freelancerId || lead.freelancer_id || "admin_1";
    const actorName = req.user.name || lead.freelancer_name || "Usu\xE1rio";
    await db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: "note_added",
      description: `${actorName} adicionou anota\xE7\xE3o em "${lead.name}"`,
      metadata: { lead_id: lead.id }
    });
    res.json(note);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/pipeline", requireAuth, async (req, res) => {
  try {
    const scope = resolveWorkspaceScope(req);
    const board = await db.getPipelineBoard(scope.freelancerId);
    res.json(board);
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});
app.post("/api/pipeline/move", requireAuth, async (req, res) => {
  try {
    const { leadId, toStatus } = req.body;
    if (!leadId || !toStatus) {
      return res.status(400).json({ error: "leadId e toStatus s\xE3o obrigat\xF3rios." });
    }
    const lead = await db.getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !matchesFreelancerId(lead.freelancer_id, req.user.freelancerId) && lead.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso n\xE3o autorizado a este lead." });
    }
    const updates = { pipeline_status: toStatus };
    if (toStatus === "CONTATADO") {
      updates.contacted_at = (/* @__PURE__ */ new Date()).toISOString();
      updates.contact_attempts_count = (lead.contact_attempts_count || 0) + 1;
    } else if (toStatus === "RESPONDEU") {
      updates.response_at = (/* @__PURE__ */ new Date()).toISOString();
    } else if (toStatus === "FOLLOW_UP") {
      updates.follow_up_at = (/* @__PURE__ */ new Date()).toISOString();
    } else if (toStatus === "NEGOCIACAO") {
      updates.negotiation_at = (/* @__PURE__ */ new Date()).toISOString();
    } else if (toStatus === "FECHADO") {
      updates.sale_date = (/* @__PURE__ */ new Date()).toISOString();
    }
    const updated = toStatus === "CONTATADO" ? await db.contactLead(leadId) : await db.updateLead(leadId, updates);
    const actorId = req.user.freelancerId || lead.freelancer_id || "admin_1";
    const actorName = req.user.name || lead.freelancer_name || "Usu\xE1rio";
    let actionType = "status_changed";
    if (toStatus === "CONTATADO") actionType = "lead_contacted";
    else if (toStatus === "RESPONDEU") actionType = "response_registered";
    else if (toStatus === "FOLLOW_UP") actionType = "follow_up_registered";
    else if (toStatus === "NEGOCIACAO") actionType = "negotiation_started";
    else if (toStatus === "FECHADO") actionType = "sale_registered";
    await db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: actionType,
      description: `${actorName} moveu "${lead.name}" para ${toStatus}`,
      metadata: { lead_id: lead.id, toStatus }
    });
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/search-jobs", requireAuth, async (req, res) => {
  try {
    cleanupStaleJobs();
    const scope = resolveWorkspaceScope(req);
    const jobs = await db.getAllSearchJobs(scope.freelancerId);
    res.json(jobs);
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});
app.post("/api/search-jobs", requireAuth, async (req, res) => {
  try {
    const parsed = z.object({ state: z.string().regex(/^[A-Z]{2}$/), city: z.string().trim().min(1).max(100), niche: z.string().trim().min(2).max(120), filters: z.object({ onlyWithoutWebsite: z.boolean(), onlyWithPhone: z.boolean(), minRating: z.number().min(0).max(5), minReviews: z.number().int().min(0), maxReviews: z.number().int().min(0).optional(), targetLeads: z.number().int().min(0).max(1e4).optional() }) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Par\xE2metros de busca inv\xE1lidos." });
    const { state, city, niche, filters } = parsed.data;
    if (!state || !city || !niche) {
      return res.status(400).json({ error: "Estado, cidade e nicho s\xE3o obrigat\xF3rios." });
    }
    let jobFreelancerId = void 0;
    let jobFreelancerName = void 0;
    let jobWorkspaceId = "admin";
    if (req.user.role === "freelancer") {
      const userFid = req.user.freelancerId;
      const requestedFid = req.body.freelancerId || req.query.freelancer_id;
      if (requestedFid && !matchesFreelancerId(userFid, String(requestedFid))) {
        return res.status(403).json({
          error: "Acesso negado",
          message: "Voc\xEA n\xE3o pode criar buscas no workspace de outro usu\xE1rio."
        });
      }
      jobFreelancerId = userFid;
      jobFreelancerName = req.user.name;
      jobWorkspaceId = userFid;
    } else {
      if (req.body.targetFreelancerId) {
        const targetF = await db.getFreelancerById(req.body.targetFreelancerId);
        if (targetF) {
          jobFreelancerId = targetF.id;
          jobFreelancerName = targetF.name;
          jobWorkspaceId = targetF.id;
        }
      } else {
        jobFreelancerId = void 0;
        jobFreelancerName = void 0;
        jobWorkspaceId = "admin";
      }
    }
    const userId = jobFreelancerId || "admin_1";
    const cleanFilters = {
      onlyWithoutWebsite: Boolean(filters?.onlyWithoutWebsite),
      onlyWithPhone: Boolean(filters?.onlyWithPhone),
      minRating: Number(filters?.minRating ?? 0),
      minReviews: Number(filters?.minReviews ?? 0),
      targetLeads: filters.targetLeads ?? 0
    };
    if (filters.maxReviews !== void 0) {
      cleanFilters.maxReviews = Number(filters.maxReviews);
    }
    const { job, estimatedQueries, totalCities, totalAreas } = await createAndPrepareSearchJob({
      userId,
      freelancerId: jobFreelancerId,
      freelancerName: jobFreelancerName,
      state,
      city,
      niche,
      filters: cleanFilters
    });
    job.workspace_id = jobWorkspaceId;
    if (jobFreelancerId) {
      await db.logActivity({
        freelancer_id: jobFreelancerId,
        freelancer_name: jobFreelancerName,
        action_type: "search_performed",
        description: `${jobFreelancerName} iniciou busca: "${niche} em ${city}, ${state}"`,
        metadata: { jobId: job.id, niche, city, state, target_leads: job.target_leads }
      });
    }
    res.json({ job, estimatedQueries, totalCities, totalAreas });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/search-jobs/:id", requireAuth, async (req, res) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Search Job n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !matchesFreelancerId(job.freelancer_id, req.user.freelancerId) && job.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso negado: esta busca pertence a outro workspace." });
    }
    const areas = await db.getSearchAreas(job.id);
    const queries = await db.getSearchQueries(job.id);
    res.json({ job, areas, queries });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/search-jobs/:id/pause", requireAuth, async (req, res) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Search Job n\xE3o encontrado." });
    if (req.user.role === "freelancer" && !matchesFreelancerId(job.freelancer_id, req.user.freelancerId) && job.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso negado: esta busca pertence a outro workspace." });
    }
    const ok = await pauseSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/search-jobs/:id/resume", requireAuth, async (req, res) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Search Job n\xE3o encontrado." });
    if (req.user.role === "freelancer" && !matchesFreelancerId(job.freelancer_id, req.user.freelancerId) && job.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso negado: esta busca pertence a outro workspace." });
    }
    const ok = await resumeSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/search-jobs/:id/cancel", requireAuth, async (req, res) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Search Job n\xE3o encontrado." });
    if (req.user.role === "freelancer" && !matchesFreelancerId(job.freelancer_id, req.user.freelancerId) && job.workspace_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso negado: esta busca pertence a outro workspace." });
    }
    const ok = await cancelSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.get("/api/settings", requireAdmin, async (req, res) => {
  try {
    const settings = await db.getSettings();
    const maskedKey = settings.googleMapsApiKey ? `${settings.googleMapsApiKey.substring(0, 6)}...${settings.googleMapsApiKey.substring(settings.googleMapsApiKey.length - 4)}` : "";
    res.json({
      ...settings,
      maskedKey,
      googleMapsApiKey: settings.googleMapsApiKey ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : ""
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/settings", requireAdmin, async (req, res) => {
  try {
    const updates = req.body;
    if (updates.googleMapsApiKey && updates.googleMapsApiKey.includes("\u2022\u2022\u2022\u2022")) {
      delete updates.googleMapsApiKey;
    }
    const updated = await db.updateSettings(updates);
    res.json({ success: true, settings: { ...updated, googleMapsApiKey: updated.googleMapsApiKey ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err?.status || 503).json({ error: err?.status === 403 ? "Acesso negado." : "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
  }
});
app.post("/api/settings/test-key", requireAdmin, async (req, res) => {
  try {
    let keyToTest = req.body.key;
    if (!keyToTest || keyToTest.includes("\u2022\u2022\u2022\u2022")) {
      keyToTest = (await db.getSettings()).googleMapsApiKey;
    }
    if (!keyToTest || keyToTest.trim() === "") {
      return res.status(400).json({ valid: false, error: "Chave de API n\xE3o informada." });
    }
    const testRes = await searchPlacesOfficial("Barbearia em S\xE3o Paulo SP", keyToTest, { maxResultCount: 1 });
    if (testRes.error) {
      return res.json({ valid: false, error: testRes.error });
    }
    res.json({
      valid: true,
      placesFound: testRes.places.length,
      samplePlace: testRes.places[0]?.displayName?.text || "Sucesso na comunica\xE7\xE3o!"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ valid: false, error: message });
  }
});
app.get("/api/supabase/migrations", requireAdmin, (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(SUPABASE_MIGRATIONS_SQL);
});
app.post("/api/search-jobs/:id/process", requireAuth, async (req, res) => {
  const job = await db.getSearchJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Busca n\xE3o encontrada." });
  await runSearchJob(job.id);
  res.json({ success: true });
});
app.post("/api/leads/:id/preview-link", requireAuth, async (req, res) => {
  const lead = await db.getLeadById(req.params.id);
  if (!lead) return res.sendStatus(404);
  const expires = String(Date.now() + 7 * 24 * 3600 * 1e3);
  const signature = crypto4.createHmac("sha256", sessionSecret()).update(`preview:${lead.id}:${expires}`).digest("hex");
  res.json({ path: `/preview?leadId=${encodeURIComponent(lead.id)}&expires=${expires}&signature=${signature}` });
});
app.get("/api/public-preview/:id", async (req, res) => {
  const { expires, signature } = req.query;
  if (typeof expires !== "string" || typeof signature !== "string" || !/^\d+$/.test(expires) || Number(expires) <= Date.now()) return res.sendStatus(403);
  const expected = crypto4.createHmac("sha256", sessionSecret()).update(`preview:${req.params.id}:${expires}`).digest("hex");
  if (signature.length !== expected.length || !crypto4.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.sendStatus(403);
  const lead = await db.getLeadById(req.params.id);
  if (!lead) return res.sendStatus(404);
  const fields = ["id", "name", "niche", "city", "state", "address", "phone", "rating", "reviews_count", "maps_url"];
  res.json({ lead: Object.fromEntries(Object.entries(lead).filter(([k]) => fields.includes(k))) });
});
app.get("/api/internal/search-dispatch", async (req, res) => {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 32 || req.headers.authorization !== `Bearer ${expected}`) return res.sendStatus(401);
  const jobId = await dispatchSearchJobs();
  res.json({ jobId });
});
app.use((err, _req, res, _next) => {
  res.status(err.status >= 400 && err.status < 500 ? err.status : 503).json({ error: "Opera\xE7\xE3o n\xE3o confirmada. Tente novamente.", code: storageErrorCode(err) });
});
var app_default = app;

// src/server/serverless.ts
var serverless_default = app_default;
export {
  serverless_default as default
};
