// src/server/app.ts
import express from "express";
import dotenv from "dotenv";

// src/lib/store/db.ts
import fs2 from "fs";
import path2 from "path";

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
  const isNoWebsite = place.website_status === "no_website" || !place.website || place.website.trim() === "";
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

// src/lib/firebase/sync.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs
} from "firebase/firestore";
import fs from "fs";
import path from "path";

// firebase-applet-config.json
var firebase_applet_config_default = {
  projectId: "modified-sunrise-g8gvj",
  appId: "1:827387065378:web:bb320fa48106e1f764867b",
  apiKey: "AIzaSyBTugqv5sUMv7qTvzyyGtRsvdk69r9qnP0",
  authDomain: "modified-sunrise-g8gvj.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-prospectaplacesb-a0f0acf2-92de-4dc6-84d3-27efdba900e9",
  storageBucket: "modified-sunrise-g8gvj.firebasestorage.app",
  messagingSenderId: "827387065378",
  measurementId: "",
  oAuthClientId: "827387065378-53adtd8l002b8cisk0h9l42guofmfihc.apps.googleusercontent.com",
  recaptchaSiteKey: ""
};

// src/lib/firebase/sync.ts
var dbInstance = null;
function getFirestoreDb() {
  if (dbInstance) return dbInstance;
  try {
    let config = firebase_applet_config_default;
    if (!config || !config.projectId) {
      const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      }
    }
    if (!config || !config.projectId) {
      console.warn("[Firebase] Configura\xE7\xE3o do Firebase n\xE3o encontrada.");
      return null;
    }
    const app2 = !getApps().length ? initializeApp(config) : getApp();
    const databaseId = config.firestoreDatabaseId || process.env.FIRESTORE_DATABASE_ID || "ai-studio-prospectaplacesb-a0f0acf2-92de-4dc6-84d3-27efdba900e9";
    dbInstance = getFirestore(app2, databaseId);
    return dbInstance;
  } catch (err) {
    console.warn("[Firebase] N\xE3o foi poss\xEDvel inicializar Firestore:", err);
    return null;
  }
}
async function fetchAllFromFirestore() {
  const db2 = getFirestoreDb();
  if (!db2) return null;
  try {
    const [leadsSnap, placesSnap, jobsSnap, settingsSnap] = await Promise.all([
      getDocs(collection(db2, "leads")).catch(() => null),
      getDocs(collection(db2, "places")).catch(() => null),
      getDocs(collection(db2, "search_jobs")).catch(() => null),
      getDoc(doc(db2, "settings", "config")).catch(() => null)
    ]);
    const leads = [];
    if (leadsSnap) {
      leadsSnap.forEach((d) => leads.push(d.data()));
    }
    const places = [];
    if (placesSnap) {
      placesSnap.forEach((d) => places.push(d.data()));
    }
    const jobs = [];
    if (jobsSnap) {
      jobsSnap.forEach((d) => jobs.push(d.data()));
    }
    const settings = settingsSnap && settingsSnap.exists() ? settingsSnap.data() : void 0;
    return { places, leads, jobs, settings };
  } catch (err) {
    console.warn("[Firebase] Erro ao carregar dados do Firestore:", err);
    return null;
  }
}
function cleanForFirestore(data) {
  if (data === null || data === void 0) return data;
  if (Array.isArray(data)) {
    return data.map(cleanForFirestore);
  }
  if (typeof data === "object") {
    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== void 0) {
        clean[k] = cleanForFirestore(v);
      }
    }
    return clean;
  }
  return data;
}
async function syncLeadToFirestore(lead) {
  const db2 = getFirestoreDb();
  if (!db2 || !lead.id) return;
  try {
    await setDoc(doc(db2, "leads", lead.id), cleanForFirestore(lead), { merge: true });
  } catch (err) {
    console.warn(`[Firebase] Erro ao sincronizar lead ${lead.id}:`, err);
  }
}
async function syncPlaceToFirestore(place) {
  const db2 = getFirestoreDb();
  if (!db2 || !place.id) return;
  try {
    await setDoc(doc(db2, "places", place.id), cleanForFirestore(place), { merge: true });
  } catch (err) {
    console.warn(`[Firebase] Erro ao sincronizar place ${place.id}:`, err);
  }
}
async function syncJobToFirestore(job) {
  const db2 = getFirestoreDb();
  if (!db2 || !job.id) return;
  try {
    await setDoc(doc(db2, "search_jobs", job.id), cleanForFirestore(job), { merge: true });
  } catch (err) {
    console.warn(`[Firebase] Erro ao sincronizar job ${job.id}:`, err);
  }
}
async function syncSettingsToFirestore(settings) {
  const db2 = getFirestoreDb();
  if (!db2) return;
  try {
    await setDoc(doc(db2, "settings", "config"), cleanForFirestore(settings), { merge: true });
  } catch (err) {
    console.warn("[Firebase] Erro ao salvar configura\xE7\xF5es no Firestore:", err);
  }
}

// src/lib/store/db.ts
var isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
var BUNDLED_DB_FILE = path2.resolve(process.cwd(), ".data", "db.json");
var DATA_DIR = isVercel ? path2.join("/tmp", ".data") : path2.resolve(process.cwd(), ".data");
var DB_FILE = path2.join(DATA_DIR, "db.json");
var INITIAL_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || "AIzaSyBjXeqBW89Kdk_s6oxccrGLJvRtcTP1ec4";
var INITIAL_SETTINGS = {
  googleMapsApiKey: INITIAL_KEY,
  hasCustomKey: Boolean(INITIAL_KEY && INITIAL_KEY.trim().length > 10),
  maxResultsPerJob: 100,
  maxCitiesPerJob: 15,
  requestDelayMs: 600,
  scoringWeights: DEFAULT_SCORING_WEIGHTS
};
var Database = class {
  constructor() {
    this.data = {
      places: [],
      leads: [],
      lead_notes: [],
      search_jobs: [],
      search_areas: [],
      search_queries: [],
      settings: INITIAL_SETTINGS
    };
    this.initialized = false;
    this.initPromise = null;
    this.init();
  }
  init() {
    try {
      if (fs2.existsSync(DB_FILE)) {
        const raw = fs2.readFileSync(DB_FILE, "utf-8");
        this.data = JSON.parse(raw);
        this.data.settings = { ...INITIAL_SETTINGS, ...this.data.settings || {} };
        this.initialized = true;
        return;
      }
      if (isVercel && fs2.existsSync(BUNDLED_DB_FILE)) {
        try {
          if (!fs2.existsSync(DATA_DIR)) {
            fs2.mkdirSync(DATA_DIR, { recursive: true });
          }
          const bundledRaw = fs2.readFileSync(BUNDLED_DB_FILE, "utf-8");
          this.data = JSON.parse(bundledRaw);
          this.data.settings = { ...INITIAL_SETTINGS, ...this.data.settings || {} };
          fs2.writeFileSync(DB_FILE, bundledRaw, "utf-8");
          this.initialized = true;
          return;
        } catch (copyErr) {
          console.warn("[DB] Erro ao copiar DB inicial para /tmp:", copyErr);
        }
      }
      if (!fs2.existsSync(DATA_DIR)) {
        fs2.mkdirSync(DATA_DIR, { recursive: true });
      }
      this.seedInitialData();
      this.save();
    } catch (err) {
      console.warn("[DB] Erro durante inicializa\xE7\xE3o do banco, usando dados em mem\xF3ria:", err);
      this.seedInitialData();
    }
    this.initialized = true;
    this.syncFromFirestore().catch(() => {
    });
  }
  async ensureInitialized() {
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
      if (!this.data.leads || this.data.leads.length === 0) {
        console.log("[DB] Base local sem dados. Conectando e sincronizando com o Google Firestore...");
        await this.syncFromFirestore();
        console.log(`[DB] Firestore sincronizado: ${this.data.leads.length} leads carregados.`);
      }
    })().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }
  async syncFromFirestore() {
    try {
      const remote = await fetchAllFromFirestore();
      if (remote) {
        if (remote.leads && remote.leads.length > 0) {
          this.data.leads = remote.leads;
        } else if (this.data.leads && this.data.leads.length > 0) {
          for (const l of this.data.leads) {
            syncLeadToFirestore(l).catch(() => {
            });
          }
        }
        if (remote.places && remote.places.length > 0) {
          this.data.places = remote.places;
        } else if (this.data.places && this.data.places.length > 0) {
          for (const p of this.data.places) {
            syncPlaceToFirestore(p).catch(() => {
            });
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
        placesCount: this.data.places.length
      };
    } catch (err) {
      console.warn("[DB] Falha na sincroniza\xE7\xE3o inicial do Firestore:", err);
      return {
        leadsCount: this.data.leads.length,
        placesCount: this.data.places.length
      };
    }
  }
  seedInitialData() {
    this.data.places = [];
    this.data.leads = [];
    this.data.lead_notes = [];
    this.data.search_jobs = [];
    this.data.search_areas = [];
    this.data.search_queries = [];
    this.data.settings = INITIAL_SETTINGS;
  }
  save() {
    try {
      if (!fs2.existsSync(DATA_DIR)) {
        fs2.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs2.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.warn("[DB] N\xE3o foi poss\xEDvel persistir no disco (ambiente somente leitura/serverless). Mantendo dados na mem\xF3ria:", err);
    }
  }
  // --- PLACES ---
  upsertPlace(place) {
    const existingIndex = this.data.places.findIndex((p) => p.place_id === place.place_id);
    if (existingIndex >= 0) {
      this.data.places[existingIndex] = {
        ...this.data.places[existingIndex],
        ...place,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.save();
      syncPlaceToFirestore(this.data.places[existingIndex]).catch(() => {
      });
      return { place: this.data.places[existingIndex], isNew: false };
    } else {
      this.data.places.push(place);
      this.save();
      syncPlaceToFirestore(place).catch(() => {
      });
      return { place, isNew: true };
    }
  }
  getPlaceByPlaceId(placeId) {
    return this.data.places.find((p) => p.place_id === placeId);
  }
  // --- LEADS ---
  createLead(lead) {
    const exists = this.data.leads.some(
      (l) => l.user_id === lead.user_id && l.place_id === lead.place_id && l.niche.toLowerCase() === lead.niche.toLowerCase()
    );
    if (exists) {
      return { lead, created: false };
    }
    this.data.leads.unshift(lead);
    this.save();
    syncLeadToFirestore(lead).catch(() => {
    });
    return { lead, created: true };
  }
  getLeads(params) {
    let filtered = [...this.data.leads];
    if (params.state && params.state !== "ALL") {
      filtered = filtered.filter((l) => l.state.toUpperCase() === params.state.toUpperCase());
    }
    if (params.city && params.city !== "ALL") {
      filtered = filtered.filter((l) => l.city.toLowerCase() === params.city.toLowerCase());
    }
    if (params.niche && params.niche !== "ALL") {
      filtered = filtered.filter((l) => l.niche.toLowerCase().includes(params.niche.toLowerCase()));
    }
    if (params.status && params.status !== "ALL") {
      filtered = filtered.filter((l) => l.pipeline_status === params.status);
    }
    if (params.onlyWithoutWebsite) {
      filtered = filtered.filter((l) => l.website_status === "no_website" || !l.website);
    }
    if (params.onlyWithPhone) {
      filtered = filtered.filter((l) => Boolean(l.phone && l.phone.trim().length >= 8));
    }
    if (params.onlyFavorites) {
      filtered = filtered.filter((l) => l.is_favorite === true);
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
      const q = params.search.toLowerCase().trim();
      filtered = filtered.filter(
        (l) => l.name.toLowerCase().includes(q) || l.city.toLowerCase().includes(q) || l.phone && l.phone.replace(/\D/g, "").includes(q.replace(/\D/g, ""))
      );
    }
    const sortBy = params.sortBy || "score";
    filtered.sort((a, b) => {
      if (sortBy === "score") return b.lead_score - a.lead_score;
      if (sortBy === "reviews") return b.reviews_count - a.reviews_count;
      if (sortBy === "rating") return b.rating - a.rating;
      if (sortBy === "recent") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
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
  getNichesSummary(params) {
    const counts = {};
    let leads = this.data.leads;
    if (params?.onlyFavorites) {
      leads = leads.filter((l) => l.is_favorite === true);
    }
    for (const lead of leads) {
      const n = lead.niche || "Geral";
      counts[n] = (counts[n] || 0) + 1;
    }
    return Object.entries(counts).map(([niche, count]) => ({ niche, count })).sort((a, b) => b.count - a.count);
  }
  getLeadById(id) {
    return this.data.leads.find((l) => l.id === id);
  }
  updateLead(id, updates) {
    const idx = this.data.leads.findIndex((l) => l.id === id);
    if (idx === -1) return void 0;
    this.data.leads[idx] = {
      ...this.data.leads[idx],
      ...updates,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.save();
    syncLeadToFirestore(this.data.leads[idx]).catch(() => {
    });
    return this.data.leads[idx];
  }
  toggleFavoriteLead(id) {
    const idx = this.data.leads.findIndex((l) => l.id === id);
    if (idx === -1) return void 0;
    const current = Boolean(this.data.leads[idx].is_favorite);
    this.data.leads[idx].is_favorite = !current;
    this.data.leads[idx].updated_at = (/* @__PURE__ */ new Date()).toISOString();
    this.save();
    syncLeadToFirestore(this.data.leads[idx]).catch(() => {
    });
    return this.data.leads[idx];
  }
  addLeadNote(leadId, userId, content) {
    const note = {
      id: `note_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      lead_id: leadId,
      user_id: userId,
      content,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.data.lead_notes.unshift(note);
    this.save();
    return note;
  }
  getLeadNotes(leadId) {
    return this.data.lead_notes.filter((n) => n.lead_id === leadId);
  }
  // --- PIPELINE ---
  getPipelineBoard() {
    const columns = {
      "NOVO": [],
      "PR\xC9VIA CRIADA": [],
      "CONTATADO": [],
      "RESPONDEU": [],
      "INTERESSADO": [],
      "REUNI\xC3O": [],
      "PROPOSTA": [],
      "FECHADO": [],
      "PERDIDO": []
    };
    for (const lead of this.data.leads) {
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
  // --- DASHBOARD ---
  getDashboardStats() {
    const leads = this.data.leads;
    const totalLeads = leads.length;
    const newLeads = leads.filter((l) => l.pipeline_status === "NOVO").length;
    const contactedLeads = leads.filter((l) => l.pipeline_status === "CONTATADO").length;
    const interestedLeads = leads.filter((l) => l.pipeline_status === "INTERESSADO").length;
    const closedLeads = leads.filter((l) => l.pipeline_status === "FECHADO").length;
    const noWebsiteLeads = leads.filter((l) => l.website_status === "no_website" || !l.website).length;
    const withPhoneLeads = leads.filter((l) => Boolean(l.phone && l.phone.trim().length >= 8)).length;
    const contactedOrMore = leads.filter((l) => ["CONTATADO", "RESPONDEU", "INTERESSADO", "REUNI\xC3O", "PROPOSTA", "FECHADO"].includes(l.pipeline_status)).length;
    const respondedOrMore = leads.filter((l) => ["RESPONDEU", "INTERESSADO", "REUNI\xC3O", "PROPOSTA", "FECHADO"].includes(l.pipeline_status)).length;
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
    const pipelineStatuses = ["NOVO", "PR\xC9VIA CRIADA", "CONTATADO", "RESPONDEU", "INTERESSADO", "REUNI\xC3O", "PROPOSTA", "FECHADO", "PERDIDO"];
    const pipelineDistribution = pipelineStatuses.map((st) => ({
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
  // --- SEARCH JOBS ---
  createSearchJob(job) {
    this.data.search_jobs.unshift(job);
    this.save();
    syncJobToFirestore(job).catch(() => {
    });
    return job;
  }
  getSearchJob(id) {
    return this.data.search_jobs.find((j) => j.id === id);
  }
  getAllSearchJobs() {
    return [...this.data.search_jobs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
  updateSearchJob(id, updates) {
    const idx = this.data.search_jobs.findIndex((j) => j.id === id);
    if (idx === -1) return void 0;
    this.data.search_jobs[idx] = {
      ...this.data.search_jobs[idx],
      ...updates,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.save();
    syncJobToFirestore(this.data.search_jobs[idx]).catch(() => {
    });
    return this.data.search_jobs[idx];
  }
  addSearchAreas(areas) {
    this.data.search_areas.push(...areas);
    this.save();
  }
  getSearchAreas(jobId) {
    return this.data.search_areas.filter((a) => a.search_job_id === jobId);
  }
  updateSearchArea(id, updates) {
    const idx = this.data.search_areas.findIndex((a) => a.id === id);
    if (idx !== -1) {
      this.data.search_areas[idx] = { ...this.data.search_areas[idx], ...updates };
      this.save();
    }
  }
  logSearchQuery(queryLog) {
    this.data.search_queries.unshift(queryLog);
    if (this.data.search_queries.length > 500) {
      this.data.search_queries.pop();
    }
    this.save();
  }
  getSearchQueries(jobId) {
    return this.data.search_queries.filter((q) => q.search_job_id === jobId);
  }
  // --- SETTINGS ---
  getSettings() {
    const currentApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || this.data.settings.googleMapsApiKey;
    return {
      ...this.data.settings,
      googleMapsApiKey: currentApiKey,
      hasCustomKey: Boolean(currentApiKey && currentApiKey.trim() !== "")
    };
  }
  updateSettings(updates) {
    const key = updates.googleMapsApiKey !== void 0 ? updates.googleMapsApiKey : this.data.settings.googleMapsApiKey;
    this.data.settings = {
      ...this.data.settings,
      ...updates,
      hasCustomKey: Boolean(key && key.trim() !== "")
    };
    if (updates.googleMapsApiKey !== void 0) {
      process.env.GOOGLE_MAPS_API_KEY = updates.googleMapsApiKey;
      process.env.GOOGLE_PLACES_API_KEY = updates.googleMapsApiKey;
    }
    this.save();
    syncSettingsToFirestore(this.data.settings).catch(() => {
    });
    return this.getSettings();
  }
};
var db = new Database();

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
async function fetchCitiesByState(uf) {
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
  const popular = POPULAR_CITIES_BY_STATE[upperUf] || ["Capital", "Regi\xE3o Central", "Interior"];
  const fallbackCities = popular.map((name, index) => ({
    id: 1e3 + index,
    nome: name
  }));
  memoryCitiesCache.set(upperUf, fallbackCities);
  return fallbackCities;
}

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
function normalizePlace(raw, fallbackCity, fallbackState) {
  const placeId = raw.id || (raw.name ? raw.name.replace("places/", "") : `gen_${Date.now()}_${Math.random().toString(36).substring(7)}`);
  const displayName = raw.displayName?.text || "Estabelecimento sem nome";
  const address = raw.formattedAddress || "Endere\xE7o n\xE3o informado";
  const { status: websiteStatus } = hasWebsite(raw.websiteUri);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let postalCode;
  const cepMatch = address.match(/\d{5}-\d{3}/);
  if (cepMatch) {
    postalCode = cepMatch[0];
  }
  return {
    id: placeId,
    place_id: placeId,
    name: displayName,
    formatted_address: address,
    city: fallbackCity,
    state: fallbackState,
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
    created_at: now,
    updated_at: now,
    last_fetched_at: now
  };
}
async function searchPlacesOfficial(query, apiKey, options) {
  if (!apiKey || apiKey.trim() === "") {
    return { places: [], error: "GOOGLE_MAPS_API_KEY_MISSING" };
  }
  const endpoint = "https://places.googleapis.com/v1/places:searchText";
  const body = {
    textQuery: query,
    languageCode: "pt-BR",
    maxResultCount: Math.min(options?.maxResultCount || 20, 20)
  };
  if (options?.locationBias?.circle) {
    body.locationBias = {
      circle: {
        center: {
          latitude: options.locationBias.circle.center.latitude,
          longitude: options.locationBias.circle.center.longitude
        },
        radius: options.locationBias.circle.radius
      }
    };
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
      const errorMessage = errorJson?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      const isQuota = response.status === 429 || errorMessage.toLowerCase().includes("quota") || errorMessage.toLowerCase().includes("resource_exhausted");
      return {
        places: [],
        error: errorMessage,
        isQuotaExceeded: isQuota
      };
    }
    const data = await response.json();
    return {
      places: data.places || []
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      places: [],
      error: `Falha na requisi\xE7\xE3o: ${errorMsg}`
    };
  }
}

// src/lib/search/searchWorker.ts
var activeWorkers = /* @__PURE__ */ new Map();
async function createAndPrepareSearchJob(params) {
  const settings = db.getSettings();
  let targetCities = [];
  if (params.city === "all") {
    const ibgeCities = await fetchCitiesByState(params.state);
    const maxCities = settings.maxCitiesPerJob || 15;
    targetCities = ibgeCities.slice(0, maxCities).map((c) => c.nome);
    if (targetCities.length === 0) {
      targetCities = POPULAR_CITIES_BY_STATE[params.state] || ["Capital"];
    }
  } else {
    targetCities = [params.city];
  }
  const areas = [];
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  for (const c of targetCities) {
    const grid = METROPOLITAN_GRIDS[c];
    if (grid && grid.length > 0) {
      for (const cell of grid) {
        areas.push({
          id: `area_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          search_job_id: jobId,
          city: c,
          state: params.state,
          lat: cell.lat,
          lng: cell.lng,
          radius: cell.radius,
          status: "pending",
          attempts: 0,
          places_found: 0
        });
      }
    } else {
      const coords = CITY_COORDINATES[c] || { lat: -23.5505, lng: -46.6333 };
      areas.push({
        id: `area_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        search_job_id: jobId,
        city: c,
        state: params.state,
        lat: coords.lat,
        lng: coords.lng,
        radius: 8e3,
        status: "pending",
        attempts: 0,
        places_found: 0
      });
    }
  }
  const newJob = {
    id: jobId,
    user_id: params.userId,
    state: params.state,
    city: params.city,
    niche: params.niche,
    status: "pending",
    filters: params.filters,
    total_cities: targetCities.length,
    processed_cities: 0,
    total_search_areas: areas.length,
    processed_search_areas: 0,
    places_found: 0,
    places_without_website: 0,
    leads_created: 0,
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  db.createSearchJob(newJob);
  db.addSearchAreas(areas);
  return {
    job: newJob,
    estimatedQueries: areas.length,
    totalCities: targetCities.length,
    totalAreas: areas.length
  };
}
async function runSearchJob(jobId) {
  const job = db.getSearchJob(jobId);
  if (!job) return;
  const worker = {
    jobId,
    paused: false,
    cancelled: false
  };
  activeWorkers.set(jobId, worker);
  db.updateSearchJob(jobId, {
    status: "running",
    started_at: job.started_at || (/* @__PURE__ */ new Date()).toISOString()
  });
  const areas = db.getSearchAreas(jobId);
  const pendingAreas = areas.filter((a) => a.status === "pending" || a.status === "failed");
  const settings = db.getSettings();
  const citiesSeen = /* @__PURE__ */ new Set();
  for (const area of pendingAreas) {
    const currentWorker = activeWorkers.get(jobId);
    if (!currentWorker || currentWorker.cancelled) {
      db.updateSearchJob(jobId, { status: "cancelled" });
      activeWorkers.delete(jobId);
      return;
    }
    if (currentWorker.paused) {
      db.updateSearchJob(jobId, { status: "paused" });
      return;
    }
    db.updateSearchArea(area.id, {
      status: "processing",
      attempts: area.attempts + 1
    });
    const query = `${job.niche} em ${area.city} ${area.state}`;
    const startTime = Date.now();
    let rawPlaces = [];
    let isQuotaExceeded = false;
    let queryError;
    const apiKey = settings.googleMapsApiKey || process.env.GOOGLE_MAPS_API_KEY || "";
    const res = await searchPlacesOfficial(query, apiKey, {
      locationBias: {
        circle: {
          center: { latitude: area.lat, longitude: area.lng },
          radius: area.radius
        }
      },
      maxResultCount: 20
    });
    if (res.isQuotaExceeded) {
      isQuotaExceeded = true;
      queryError = res.error;
    } else if (res.error) {
      queryError = res.error;
    } else {
      rawPlaces = res.places;
    }
    const durationMs = Date.now() - startTime;
    if (isQuotaExceeded) {
      const quotaMsg = "O limite tempor\xE1rio da API do Google foi atingido. A busca foi pausada automaticamente e poder\xE1 ser retomada.";
      db.updateSearchArea(area.id, { status: "failed", error: quotaMsg });
      db.logSearchQuery({
        id: `query_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        search_job_id: jobId,
        search_area_id: area.id,
        query,
        status: "quota_exceeded",
        results_count: 0,
        duration_ms: durationMs,
        error_details: quotaMsg,
        created_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      db.updateSearchJob(jobId, {
        status: "paused",
        error_message: quotaMsg
      });
      activeWorkers.delete(jobId);
      return;
    }
    db.logSearchQuery({
      id: `query_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      search_job_id: jobId,
      search_area_id: area.id,
      query,
      status: queryError ? "error" : "success",
      results_count: rawPlaces.length,
      duration_ms: durationMs,
      error_details: queryError,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    let newPlacesFound = 0;
    let newWithoutWebsite = 0;
    let newLeadsCreated = 0;
    for (const raw of rawPlaces) {
      const normalizedPlace = normalizePlace(raw, area.city, area.state);
      const { isNew } = db.upsertPlace(normalizedPlace);
      if (isNew) {
        newPlacesFound++;
      }
      if (normalizedPlace.website_status === "no_website") {
        newWithoutWebsite++;
      }
      const matchesFilters = checkLeadFilters(normalizedPlace, job.filters);
      if (matchesFilters) {
        const { score } = calculateLeadScore(normalizedPlace, settings.scoringWeights);
        const { created } = db.createLead({
          id: `lead_${normalizedPlace.place_id}`,
          user_id: job.user_id,
          place_id: normalizedPlace.place_id,
          name: normalizedPlace.name,
          niche: job.niche,
          state: normalizedPlace.state,
          city: normalizedPlace.city,
          address: normalizedPlace.formatted_address,
          phone: normalizedPlace.phone,
          website: normalizedPlace.website,
          website_status: normalizedPlace.website_status,
          maps_url: normalizedPlace.maps_url,
          rating: normalizedPlace.rating || 0,
          reviews_count: normalizedPlace.reviews_count || 0,
          lead_score: score,
          pipeline_status: "NOVO",
          created_at: (/* @__PURE__ */ new Date()).toISOString(),
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        });
        if (created) {
          newLeadsCreated++;
        }
      }
    }
    citiesSeen.add(area.city);
    db.updateSearchArea(area.id, {
      status: "completed",
      places_found: rawPlaces.length,
      processed_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    const updatedJob = db.getSearchJob(jobId);
    if (updatedJob) {
      db.updateSearchJob(jobId, {
        processed_search_areas: updatedJob.processed_search_areas + 1,
        processed_cities: citiesSeen.size,
        places_found: updatedJob.places_found + newPlacesFound,
        places_without_website: updatedJob.places_without_website + newWithoutWebsite,
        leads_created: updatedJob.leads_created + newLeadsCreated
      });
    }
    const delay = Math.max(300, settings.requestDelayMs || 600);
    await new Promise((r) => setTimeout(r, delay));
  }
  db.updateSearchJob(jobId, {
    status: "completed",
    finished_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  activeWorkers.delete(jobId);
}
function checkLeadFilters(place, filters) {
  if (filters.onlyWithoutWebsite && place.website_status !== "no_website" && place.website) {
    return false;
  }
  if (filters.onlyWithPhone && (!place.phone || place.phone.trim().length < 8)) {
    return false;
  }
  const rating = Number(place.rating || 0);
  if (filters.minRating > 0 && rating < filters.minRating) {
    return false;
  }
  const reviews = Number(place.reviews_count || 0);
  if (filters.minReviews > 0 && reviews < filters.minReviews) {
    return false;
  }
  if (filters.maxReviews && filters.maxReviews > 0 && reviews > filters.maxReviews) {
    return false;
  }
  return true;
}
function pauseSearchJob(jobId) {
  const worker = activeWorkers.get(jobId);
  if (worker) {
    worker.paused = true;
    db.updateSearchJob(jobId, { status: "paused" });
    return true;
  }
  db.updateSearchJob(jobId, { status: "paused" });
  return true;
}
function resumeSearchJob(jobId) {
  const job = db.getSearchJob(jobId);
  if (!job) return false;
  const worker = activeWorkers.get(jobId);
  if (worker) {
    worker.paused = false;
  }
  db.updateSearchJob(jobId, { status: "running" });
  runSearchJob(jobId).catch(console.error);
  return true;
}
function cancelSearchJob(jobId) {
  const worker = activeWorkers.get(jobId);
  if (worker) {
    worker.cancelled = true;
  }
  db.updateSearchJob(jobId, {
    status: "cancelled",
    finished_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  activeWorkers.delete(jobId);
  return true;
}

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
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-matched-path, x-forwarded-uri");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  if (req.url && !req.url.startsWith("/api") && !req.url.startsWith("/assets") && !req.url.includes(".")) {
    req.url = "/api" + (req.url.startsWith("/") ? req.url : "/" + req.url);
  }
  next();
});
app.use("/api", async (req, _res, next) => {
  if (req.path === "" || req.path === "/") {
    return next();
  }
  try {
    await db.ensureInitialized();
  } catch (err) {
    console.warn("[Server] Falha ao sincronizar com Firestore:", err);
  }
  next();
});
app.get("/api", (_req, res) => {
  res.json({
    status: "ok",
    service: "ProspectaPlaces B2B Engine API",
    time: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.post("/api/sync", async (_req, res) => {
  try {
    const result = await db.syncFromFirestore();
    const stats = db.getDashboardStats();
    res.json({
      success: true,
      message: "Sincroniza\xE7\xE3o com o Firestore conclu\xEDda com sucesso!",
      leadsCount: result.leadsCount,
      placesCount: result.placesCount,
      stats
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email e senha s\xE3o obrigat\xF3rios." });
  }
  return res.json({
    user: {
      id: "default_user_1",
      email,
      name: email.split("@")[0],
      role: "admin"
    },
    token: "session_token_" + Date.now()
  });
});
app.get("/api/auth/me", (_req, res) => {
  res.json({
    user: {
      id: "default_user_1",
      email: "gustavohcsantos.mm2020@gmail.com",
      name: "Gustavo Santos",
      role: "admin"
    }
  });
});
app.post("/api/auth/logout", (_req, res) => {
  res.json({ success: true });
});
app.get("/api/ibge/states", async (_req, res) => {
  try {
    const states = await fetchStates();
    res.json(states);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/ibge/cities", async (req, res) => {
  try {
    const uf = req.query.uf || "SP";
    const cities = await fetchCitiesByState(uf);
    res.json(cities);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/ibge/cities/:uf", async (req, res) => {
  try {
    const uf = req.params.uf;
    const cities = await fetchCitiesByState(uf);
    res.json(cities);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/dashboard/stats", (_req, res) => {
  try {
    const stats = db.getDashboardStats();
    res.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/niches", (req, res) => {
  try {
    const onlyFavorites = req.query.onlyFavorites === "true";
    const niches = db.getNichesSummary({ onlyFavorites });
    res.json(niches);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/leads", (req, res) => {
  try {
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
    const result = db.getLeads({
      state,
      city,
      niche,
      onlyWithoutWebsite: onlyWithoutWebsite === "true",
      onlyWithPhone: onlyWithPhone === "true",
      onlyFavorites: onlyFavorites === "true",
      minRating: minRating ? Number(minRating) : void 0,
      minReviews: minReviews ? Number(minReviews) : void 0,
      minScore: minScore ? Number(minScore) : void 0,
      status,
      search,
      sortBy,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/leads/:id", (req, res) => {
  try {
    const lead = db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    const notes = db.getLeadNotes(lead.id);
    const place = db.getPlaceByPlaceId(lead.place_id);
    res.json({ lead, notes, place });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.patch("/api/leads/:id", (req, res) => {
  try {
    const updated = db.updateLead(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/leads/:id/favorite", (req, res) => {
  try {
    const updated = db.toggleFavoriteLead(req.params.id);
    if (!updated) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/leads/:id/notes", (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Conte\xFAdo da observa\xE7\xE3o n\xE3o pode ser vazio." });
    }
    const note = db.addLeadNote(req.params.id, "default_user_1", content.trim());
    res.json(note);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/pipeline", (_req, res) => {
  try {
    const board = db.getPipelineBoard();
    res.json(board);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/pipeline/move", (req, res) => {
  try {
    const { leadId, toStatus } = req.body;
    if (!leadId || !toStatus) {
      return res.status(400).json({ error: "leadId e toStatus s\xE3o obrigat\xF3rios." });
    }
    const updates = { pipeline_status: toStatus };
    if (toStatus === "CONTATADO") {
      updates.contacted_at = (/* @__PURE__ */ new Date()).toISOString();
    }
    const updated = db.updateLead(leadId, updates);
    if (!updated) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/search-jobs", (_req, res) => {
  try {
    const jobs = db.getAllSearchJobs();
    res.json(jobs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/search-jobs", async (req, res) => {
  try {
    const { state, city, niche, filters } = req.body;
    if (!state || !city || !niche) {
      return res.status(400).json({ error: "Estado, cidade e nicho s\xE3o obrigat\xF3rios." });
    }
    const cleanFilters = {
      onlyWithoutWebsite: filters?.onlyWithoutWebsite ?? true,
      onlyWithPhone: filters?.onlyWithPhone ?? false,
      minRating: Number(filters?.minRating ?? 0),
      minReviews: Number(filters?.minReviews ?? 0)
    };
    if (filters?.maxReviews !== void 0 && filters?.maxReviews !== null && filters?.maxReviews !== "") {
      cleanFilters.maxReviews = Number(filters.maxReviews);
    }
    const { job, estimatedQueries, totalCities, totalAreas } = await createAndPrepareSearchJob({
      userId: "default_user_1",
      state,
      city,
      niche,
      filters: cleanFilters
    });
    runSearchJob(job.id).catch(console.error);
    res.json({ job, estimatedQueries, totalCities, totalAreas });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/search-jobs/:id", (req, res) => {
  try {
    const job = db.getSearchJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Search Job n\xE3o encontrado." });
    }
    const areas = db.getSearchAreas(job.id);
    const queries = db.getSearchQueries(job.id);
    res.json({ job, areas, queries });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/search-jobs/:id/pause", (req, res) => {
  try {
    const ok = pauseSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/search-jobs/:id/resume", (req, res) => {
  try {
    const ok = resumeSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/search-jobs/:id/cancel", (req, res) => {
  try {
    const ok = cancelSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/settings", (_req, res) => {
  try {
    const settings = db.getSettings();
    const maskedKey = settings.googleMapsApiKey ? `${settings.googleMapsApiKey.substring(0, 6)}...${settings.googleMapsApiKey.substring(settings.googleMapsApiKey.length - 4)}` : "";
    res.json({
      ...settings,
      maskedKey,
      googleMapsApiKey: settings.googleMapsApiKey ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : ""
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/settings", (req, res) => {
  try {
    const updates = req.body;
    if (updates.googleMapsApiKey && updates.googleMapsApiKey.includes("\u2022\u2022\u2022\u2022")) {
      delete updates.googleMapsApiKey;
    }
    const updated = db.updateSettings(updates);
    res.json({ success: true, settings: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/settings/test-key", async (req, res) => {
  try {
    let keyToTest = req.body.key;
    if (!keyToTest || keyToTest.includes("\u2022\u2022\u2022\u2022")) {
      keyToTest = db.getSettings().googleMapsApiKey;
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
app.get("/api/supabase/migrations", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(SUPABASE_MIGRATIONS_SQL);
});
var app_default = app;

// src/server/serverless.ts
var serverless_default = app_default;
export {
  serverless_default as default
};
