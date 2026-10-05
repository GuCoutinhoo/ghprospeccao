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
  getDocs,
  deleteDoc
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
    const [leadsSnap, placesSnap, jobsSnap, settingsSnap, freelancersSnap, activitiesSnap] = await Promise.all([
      getDocs(collection(db2, "leads")).catch(() => null),
      getDocs(collection(db2, "places")).catch(() => null),
      getDocs(collection(db2, "search_jobs")).catch(() => null),
      getDoc(doc(db2, "settings", "config")).catch(() => null),
      getDocs(collection(db2, "freelancers")).catch(() => null),
      getDocs(collection(db2, "activities")).catch(() => null)
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
    const freelancers = [];
    if (freelancersSnap) {
      freelancersSnap.forEach((d) => freelancers.push(d.data()));
    }
    const activities = [];
    if (activitiesSnap) {
      activitiesSnap.forEach((d) => activities.push(d.data()));
    }
    const settings = settingsSnap && settingsSnap.exists() ? settingsSnap.data() : void 0;
    return { places, leads, jobs, settings, freelancers, activities };
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
async function syncFreelancerToFirestore(freelancer) {
  const db2 = getFirestoreDb();
  if (!db2 || !freelancer.id) return;
  try {
    await setDoc(doc(db2, "freelancers", freelancer.id), cleanForFirestore(freelancer), { merge: true });
  } catch (err) {
    console.warn(`[Firebase] Erro ao sincronizar freelancer ${freelancer.id}:`, err);
  }
}
async function deleteFreelancerFromFirestore(id) {
  const db2 = getFirestoreDb();
  if (!db2 || !id) return;
  try {
    await deleteDoc(doc(db2, "freelancers", id));
  } catch (err) {
    console.warn(`[Firebase] Erro ao deletar freelancer ${id} do Firestore:`, err);
  }
}
async function deleteLeadFromFirestore(id) {
  const db2 = getFirestoreDb();
  if (!db2 || !id) return;
  try {
    await deleteDoc(doc(db2, "leads", id));
  } catch (err) {
    console.warn(`[Firebase] Erro ao deletar lead ${id} do Firestore:`, err);
  }
}
async function deleteJobFromFirestore(id) {
  const db2 = getFirestoreDb();
  if (!db2 || !id) return;
  try {
    await deleteDoc(doc(db2, "search_jobs", id));
  } catch (err) {
    console.warn(`[Firebase] Erro ao deletar job ${id} do Firestore:`, err);
  }
}
async function deleteActivityFromFirestore(id) {
  const db2 = getFirestoreDb();
  if (!db2 || !id) return;
  try {
    await deleteDoc(doc(db2, "activities", id));
  } catch (err) {
    console.warn(`[Firebase] Erro ao deletar atividade ${id} do Firestore:`, err);
  }
}
async function syncActivityToFirestore(activity) {
  const db2 = getFirestoreDb();
  if (!db2 || !activity.id) return;
  try {
    await setDoc(doc(db2, "activities", activity.id), cleanForFirestore(activity), { merge: true });
  } catch (err) {
    console.warn(`[Firebase] Erro ao sincronizar atividade ${activity.id}:`, err);
  }
}

// src/lib/store/db.ts
function normalizeStr(str) {
  if (!str) return "";
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function slugifyFreelancerName(name) {
  if (!name) return "freelancer";
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "freelancer";
}
var isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
var BUNDLED_DB_FILE = path2.resolve(process.cwd(), ".data", "db.json");
var DATA_DIR = isVercel ? path2.join("/tmp", ".data") : path2.resolve(process.cwd(), ".data");
var DB_FILE = path2.join(DATA_DIR, "db.json");
var INITIAL_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || "AIzaSyBjXeqBW89Kdk_s6oxccrGLJvRtcTP1ec4";
var INITIAL_SETTINGS = {
  googleMapsApiKey: INITIAL_KEY,
  hasCustomKey: Boolean(INITIAL_KEY && INITIAL_KEY.trim().length > 10),
  maxResultsPerJob: 0,
  // 0 = Sem limite
  maxCitiesPerJob: 0,
  // 0 = Sem limite
  requestDelayMs: 400,
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
      settings: INITIAL_SETTINGS,
      freelancers: [],
      activities: []
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
        if (!this.data.freelancers) this.data.freelancers = [];
        if (!this.data.activities) this.data.activities = [];
        this.data.freelancers = (this.data.freelancers || []).filter((f) => f && f.id && f.name);
        this.data.activities = (this.data.activities || []).filter((a) => a && a.id);
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
        console.warn("[DB] Erro ao sincronizar inicializa\xE7\xE3o com Firestore:", syncErr);
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
        const leadMap = /* @__PURE__ */ new Map();
        for (const l of remote.leads || []) {
          if (l && l.id) leadMap.set(l.id, l);
        }
        for (const l of this.data.leads || []) {
          if (!l || !l.id) continue;
          const existing = leadMap.get(l.id);
          if (!existing) {
            leadMap.set(l.id, l);
            syncLeadToFirestore(l).catch(() => {
            });
          } else {
            const localTime = new Date(l.updated_at || l.created_at || 0).getTime();
            const remoteTime = new Date(existing.updated_at || existing.created_at || 0).getTime();
            if (localTime >= remoteTime) {
              leadMap.set(l.id, l);
            }
          }
        }
        this.data.leads = Array.from(leadMap.values());
        const placeMap = /* @__PURE__ */ new Map();
        for (const p of remote.places || []) {
          if (p && p.id) placeMap.set(p.id, p);
        }
        for (const p of this.data.places || []) {
          if (!p || !p.id) continue;
          if (!placeMap.has(p.id)) {
            placeMap.set(p.id, p);
            syncPlaceToFirestore(p).catch(() => {
            });
          }
        }
        this.data.places = Array.from(placeMap.values());
        const jobMap = /* @__PURE__ */ new Map();
        for (const j of remote.jobs || []) {
          if (j && j.id) jobMap.set(j.id, j);
        }
        for (const j of this.data.search_jobs || []) {
          if (!j || !j.id) continue;
          const existing = jobMap.get(j.id);
          if (!existing) {
            jobMap.set(j.id, j);
            syncJobToFirestore(j).catch(() => {
            });
          } else {
            const localTime = new Date(j.updated_at || j.created_at || 0).getTime();
            const remoteTime = new Date(existing.updated_at || existing.created_at || 0).getTime();
            if (localTime >= remoteTime) {
              jobMap.set(j.id, j);
            }
          }
        }
        this.data.search_jobs = Array.from(jobMap.values());
        const demoFreeIds = ["free_7F4K92XQ", "free_8HKS82MD", "free_9YPL21BZ", "free_4TRM67KV"];
        if (remote.freelancers && remote.freelancers.length > 0) {
          const freeMap = /* @__PURE__ */ new Map();
          for (const f of remote.freelancers) {
            if (f && f.id && !demoFreeIds.includes(f.id)) freeMap.set(f.id, f);
            else if (f && f.id && demoFreeIds.includes(f.id)) {
              deleteFreelancerFromFirestore(f.id).catch(() => {
              });
            }
          }
          for (const f of this.data.freelancers || []) {
            if (!f || !f.id || demoFreeIds.includes(f.id)) continue;
            if (!freeMap.has(f.id)) {
              freeMap.set(f.id, f);
              syncFreelancerToFirestore(f).catch(() => {
              });
            }
          }
          this.data.freelancers = Array.from(freeMap.values());
        } else {
          this.data.freelancers = (this.data.freelancers || []).filter((f) => !demoFreeIds.includes(f.id));
        }
        if (remote.activities && remote.activities.length > 0) {
          const actMap = /* @__PURE__ */ new Map();
          for (const a of remote.activities) {
            if (a && a.id && !demoFreeIds.includes(a.freelancer_id) && !["act_1", "act_2", "act_3", "act_4", "act_5", "act_6", "act_7"].includes(a.id)) {
              actMap.set(a.id, a);
            }
          }
          for (const a of this.data.activities || []) {
            if (!a || !a.id || demoFreeIds.includes(a.freelancer_id) || ["act_1", "act_2", "act_3", "act_4", "act_5", "act_6", "act_7"].includes(a.id)) continue;
            if (!actMap.has(a.id)) {
              actMap.set(a.id, a);
              syncActivityToFirestore(a).catch(() => {
              });
            }
          }
          this.data.activities = Array.from(actMap.values()).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        } else {
          this.data.activities = (this.data.activities || []).filter(
            (a) => !demoFreeIds.includes(a.freelancer_id) && !["act_1", "act_2", "act_3", "act_4", "act_5", "act_6", "act_7"].includes(a.id)
          );
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
      console.warn("[DB] Falha na sincroniza\xE7\xE3o do Firestore:", err);
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
    this.data.freelancers = [];
    this.data.activities = [];
    this.data.settings = INITIAL_SETTINGS;
    this.seedInitialFreelancers();
  }
  seedInitialFreelancers() {
    this.data.freelancers = [];
    this.data.activities = [];
  }
  removeAllFreelancers() {
    const list = [...this.data.freelancers || []];
    for (const f of list) {
      deleteFreelancerFromFirestore(f.id).catch(() => {
      });
    }
    this.data.freelancers = [];
    this.data.activities = [];
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
    const normNiche = normalizeStr(lead.niche);
    const scope = lead.freelancer_id || lead.user_id || "default_user_1";
    const existingIndex = this.data.leads.findIndex(
      (l) => l.place_id === lead.place_id && normalizeStr(l.niche) === normNiche && (l.freelancer_id || l.user_id || "default_user_1") === scope
    );
    if (existingIndex >= 0) {
      const prev = this.data.leads[existingIndex];
      this.data.leads[existingIndex] = {
        ...prev,
        ...lead,
        pipeline_status: prev.pipeline_status || lead.pipeline_status,
        is_favorite: prev.is_favorite ?? lead.is_favorite,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.save();
      syncLeadToFirestore(this.data.leads[existingIndex]).catch(() => {
      });
      return { lead: this.data.leads[existingIndex], created: false };
    }
    this.data.leads.unshift(lead);
    this.save();
    syncLeadToFirestore(lead).catch(() => {
    });
    return { lead, created: true };
  }
  getLeads(params) {
    let filtered = [...this.data.leads];
    if (params.freelancer_id && params.freelancer_id !== "ALL") {
      filtered = filtered.filter((l) => l.freelancer_id === params.freelancer_id);
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
        return ln.includes(targetNiche) || targetNiche.includes(ln);
      });
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
      const q = normalizeStr(params.search);
      filtered = filtered.filter(
        (l) => normalizeStr(l.name).includes(q) || normalizeStr(l.city).includes(q) || l.phone && l.phone.replace(/\D/g, "").includes(q.replace(/\D/g, ""))
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
    if (params?.freelancer_id && params.freelancer_id !== "ALL") {
      leads = leads.filter((l) => l.freelancer_id === params.freelancer_id);
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
    if (params?.freelancer_id && params.freelancer_id !== "ALL") {
      leads = leads.filter((l) => l.freelancer_id === params.freelancer_id);
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
  getLeadById(id) {
    return this.data.leads.find((l) => l.id === id);
  }
  updateLead(id, updates, freelancer_id) {
    const idx = this.data.leads.findIndex((l) => l.id === id);
    if (idx === -1) return void 0;
    if (freelancer_id && this.data.leads[idx].freelancer_id && this.data.leads[idx].freelancer_id !== freelancer_id) {
      return void 0;
    }
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
    if (freelancer_id && freelancer_id !== "ALL") {
      list = list.filter((l) => l.freelancer_id === freelancer_id);
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
  // --- DASHBOARD ---
  getDashboardStats(freelancer_id) {
    let leads = this.data.leads;
    if (freelancer_id && freelancer_id !== "ALL") {
      leads = leads.filter((l) => l.freelancer_id === freelancer_id);
    }
    const totalLeads = leads.length;
    const newLeads = leads.filter((l) => l.pipeline_status === "NOVO").length;
    const contactedLeads = leads.filter((l) => l.pipeline_status === "CONTATADO").length;
    const interestedLeads = leads.filter((l) => l.pipeline_status === "INTERESSADO" || l.pipeline_status === "NEGOCIACAO").length;
    const closedLeads = leads.filter((l) => l.pipeline_status === "FECHADO").length;
    const noWebsiteLeads = leads.filter((l) => l.website_status === "no_website" || !l.website).length;
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
    const pipelineStatuses = ["NOVO", "PR\xC9VIA CRIADA", "CONTATADO", "RESPONDEU", "INTERESSADO", "FOLLOW_UP", "NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO", "PERDIDO"];
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
  getAllSearchJobs(freelancer_id) {
    let list = [...this.data.search_jobs];
    if (freelancer_id && freelancer_id !== "ALL") {
      list = list.filter((j) => j.freelancer_id === freelancer_id);
    }
    return list.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
  // --- FREELANCERS MANAGEMENT ---
  getFreelancers() {
    return [...this.data.freelancers || []];
  }
  getFreelancerById(id) {
    return (this.data.freelancers || []).find((f) => f.id === id);
  }
  getFreelancerByAccessCode(code) {
    if (!code) return void 0;
    const cleanRaw = code.trim().replace(/^https?:\/\/[^\/]+\/f\//i, "").replace(/^\/f\//i, "").replace(/\/+$/, "");
    const cleanLower = cleanRaw.toLowerCase();
    const cleanSlug = slugifyFreelancerName(cleanRaw);
    const cleanNorm = normalizeStr(cleanRaw).replace(/[^a-z0-9]/g, "");
    return (this.data.freelancers || []).find((f) => {
      if (!f) return false;
      const fCode = f.access_code || "";
      const fCodeLower = fCode.toLowerCase().trim();
      const fCodeSlug = slugifyFreelancerName(fCode);
      const fNameLower = (f.name || "").toLowerCase().trim();
      const fNameSlug = slugifyFreelancerName(f.name || "");
      const fFirstNameSlug = slugifyFreelancerName((f.name || "").split(" ")[0]);
      const fNameNorm = normalizeStr(f.name || "").replace(/[^a-z0-9]/g, "");
      const fIdLower = (f.id || "").toLowerCase().trim();
      return fCodeLower === cleanLower || fCodeSlug === cleanSlug || fNameSlug === cleanSlug || fFirstNameSlug === cleanSlug || fNameLower === cleanLower || fNameNorm === cleanNorm || fIdLower === cleanLower || fIdLower === `free_${cleanLower}` || fIdLower.replace("free_", "") === cleanLower || fCode.toUpperCase() === cleanRaw.toUpperCase() || f.email && f.email.toLowerCase() === cleanLower;
    });
  }
  createFreelancer(data) {
    const rawName = data.name.trim();
    let preferredCode = data.access_code?.trim() ? slugifyFreelancerName(data.access_code) : slugifyFreelancerName(rawName.split(" ")[0]) || slugifyFreelancerName(rawName);
    if (!preferredCode) {
      preferredCode = slugifyFreelancerName(rawName) || "freelancer";
    }
    let code = preferredCode;
    let counter = 2;
    while ((this.data.freelancers || []).some((f) => f.access_code.toLowerCase() === code.toLowerCase())) {
      code = `${preferredCode}-${counter}`;
      counter++;
    }
    const id = `free_${code}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const codesToClean = [id, code, `free_${code}`];
    const oldLeads = (this.data.leads || []).filter((l) => codesToClean.includes(l.freelancer_id || ""));
    for (const l of oldLeads) {
      deleteLeadFromFirestore(l.id).catch(() => {
      });
    }
    this.data.leads = (this.data.leads || []).filter((l) => !codesToClean.includes(l.freelancer_id || ""));
    const oldJobs = (this.data.search_jobs || []).filter((j) => codesToClean.includes(j.freelancer_id || ""));
    for (const j of oldJobs) {
      deleteJobFromFirestore(j.id).catch(() => {
      });
    }
    this.data.search_jobs = (this.data.search_jobs || []).filter((j) => !codesToClean.includes(j.freelancer_id || ""));
    const oldActivities = (this.data.activities || []).filter((a) => codesToClean.includes(a.freelancer_id || ""));
    for (const a of oldActivities) {
      deleteActivityFromFirestore(a.id).catch(() => {
      });
    }
    this.data.activities = (this.data.activities || []).filter((a) => !codesToClean.includes(a.freelancer_id || ""));
    const freelancer = {
      id,
      name: rawName,
      email: data.email.trim().toLowerCase(),
      access_code: code,
      status: data.status || "active",
      notes: data.notes?.trim(),
      pin: data.pin?.trim(),
      created_at: now,
      updated_at: now
    };
    if (!this.data.freelancers) this.data.freelancers = [];
    this.data.freelancers.unshift(freelancer);
    this.save();
    syncFreelancerToFirestore(freelancer).catch(() => {
    });
    this.logActivity({
      freelancer_id: freelancer.id,
      freelancer_name: freelancer.name,
      action_type: "freelancer_created",
      description: `Administrador cadastrou o freelancer "${freelancer.name}" com link de acesso: /f/${freelancer.access_code}`,
      metadata: { freelancer_id: freelancer.id, access_code: freelancer.access_code }
    });
    return freelancer;
  }
  updateFreelancer(id, updates) {
    const idx = (this.data.freelancers || []).findIndex((f) => f.id === id);
    if (idx === -1) return void 0;
    const prev = this.data.freelancers[idx];
    const updated = {
      ...prev,
      ...updates,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.data.freelancers[idx] = updated;
    this.save();
    syncFreelancerToFirestore(updated).catch(() => {
    });
    return updated;
  }
  regenerateFreelancerAccessCode(id) {
    const f = this.getFreelancerById(id);
    if (!f) return void 0;
    const baseCode = slugifyFreelancerName(f.name.split(" ")[0]) || slugifyFreelancerName(f.name);
    let newCode = baseCode;
    let counter = 2;
    while ((this.data.freelancers || []).some((x) => x.id !== f.id && x.access_code.toLowerCase() === newCode.toLowerCase())) {
      newCode = `${baseCode}-${counter}`;
      counter++;
    }
    f.access_code = newCode;
    f.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    this.save();
    syncFreelancerToFirestore(f).catch(() => {
    });
    this.logActivity({
      freelancer_id: f.id,
      freelancer_name: f.name,
      action_type: "access_link_regenerated",
      description: `Link de acesso de ${f.name} foi atualizado para /f/${newCode}`,
      metadata: { new_code: newCode }
    });
    return newCode;
  }
  setFreelancerStatus(id, status) {
    const f = this.getFreelancerById(id);
    if (!f) return void 0;
    const oldStatus = f.status;
    f.status = status;
    f.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    this.save();
    syncFreelancerToFirestore(f).catch(() => {
    });
    if (status === "blocked" && oldStatus !== "blocked") {
      this.logActivity({
        freelancer_id: f.id,
        freelancer_name: f.name,
        action_type: "freelancer_blocked",
        description: `Administrador bloqueou o acesso do freelancer "${f.name}"`
      });
    } else if (status === "active" && oldStatus === "blocked") {
      this.logActivity({
        freelancer_id: f.id,
        freelancer_name: f.name,
        action_type: "freelancer_unblocked",
        description: `Administrador desbloqueou o acesso do freelancer "${f.name}"`
      });
    }
    return f;
  }
  deleteFreelancer(id) {
    const idx = (this.data.freelancers || []).findIndex((f) => f.id === id);
    if (idx === -1) return false;
    const removed = this.data.freelancers.splice(idx, 1)[0];
    const codes = [id, removed.access_code, `free_${removed.access_code}`].filter(Boolean);
    const leadsToDelete = (this.data.leads || []).filter((l) => codes.includes(l.freelancer_id || ""));
    for (const lead of leadsToDelete) {
      deleteLeadFromFirestore(lead.id).catch(() => {
      });
    }
    this.data.leads = (this.data.leads || []).filter((l) => !codes.includes(l.freelancer_id || ""));
    const jobsToDelete = (this.data.search_jobs || []).filter((j) => codes.includes(j.freelancer_id || ""));
    for (const job of jobsToDelete) {
      deleteJobFromFirestore(job.id).catch(() => {
      });
    }
    this.data.search_jobs = (this.data.search_jobs || []).filter((j) => !codes.includes(j.freelancer_id || ""));
    const activitiesToDelete = (this.data.activities || []).filter((a) => codes.includes(a.freelancer_id || ""));
    for (const act of activitiesToDelete) {
      deleteActivityFromFirestore(act.id).catch(() => {
      });
    }
    this.data.activities = (this.data.activities || []).filter((a) => !codes.includes(a.freelancer_id || ""));
    this.save();
    deleteFreelancerFromFirestore(id).catch(() => {
    });
    if (removed.access_code && removed.access_code !== id) {
      deleteFreelancerFromFirestore(`free_${removed.access_code}`).catch(() => {
      });
      deleteFreelancerFromFirestore(removed.access_code).catch(() => {
      });
    }
    this.logActivity({
      freelancer_id: id,
      freelancer_name: removed.name,
      action_type: "freelancer_blocked",
      description: `Administrador removeu o cadastro e todos os dados do workspace "${removed.name}"`
    });
    return true;
  }
  cleanFreelancerWorkspace(id) {
    const f = this.getFreelancerById(id) || this.getFreelancerByAccessCode(id);
    const code = f?.access_code || id;
    const codes = [id, code, `free_${code}`, f?.id].filter(Boolean);
    const leadsToDelete = (this.data.leads || []).filter((l) => codes.includes(l.freelancer_id || ""));
    for (const lead of leadsToDelete) {
      deleteLeadFromFirestore(lead.id).catch(() => {
      });
    }
    this.data.leads = (this.data.leads || []).filter((l) => !codes.includes(l.freelancer_id || ""));
    const jobsToDelete = (this.data.search_jobs || []).filter((j) => codes.includes(j.freelancer_id || ""));
    for (const job of jobsToDelete) {
      deleteJobFromFirestore(job.id).catch(() => {
      });
    }
    this.data.search_jobs = (this.data.search_jobs || []).filter((j) => !codes.includes(j.freelancer_id || ""));
    const activitiesToDelete = (this.data.activities || []).filter((a) => codes.includes(a.freelancer_id || ""));
    for (const act of activitiesToDelete) {
      deleteActivityFromFirestore(act.id).catch(() => {
      });
    }
    this.data.activities = (this.data.activities || []).filter((a) => !codes.includes(a.freelancer_id || ""));
    this.save();
    return { leadsRemoved: leadsToDelete.length };
  }
  // --- ACTIVITIES AUDIT LOG ---
  logActivity(activity) {
    const item = {
      ...activity,
      id: `act_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (!this.data.activities) this.data.activities = [];
    this.data.activities.unshift(item);
    if (this.data.activities.length > 500) {
      this.data.activities = this.data.activities.slice(0, 500);
    }
    this.save();
    syncActivityToFirestore(item).catch(() => {
    });
    return item;
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
  // --- PERFORMANCE METRICS ---
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
      const now = Date.now();
      let msLimit = 0;
      if (filter.period === "today") msLimit = 24 * 3600 * 1e3;
      else if (filter.period === "7d") msLimit = 7 * 24 * 3600 * 1e3;
      else if (filter.period === "30d") msLimit = 30 * 24 * 3600 * 1e3;
      if (msLimit > 0) {
        leads = leads.filter((l) => now - new Date(l.created_at).getTime() <= msLimit);
        searches = searches.filter((s) => now - new Date(s.created_at).getTime() <= msLimit);
        activities = activities.filter((a) => now - new Date(a.created_at).getTime() <= msLimit);
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
var SOCIAL_MEDIA_DOMAINS = [
  "instagram.com",
  "facebook.com",
  "fb.com",
  "wa.me",
  "whatsapp.com",
  "linktr.ee",
  "linktree.com",
  "tiktok.com",
  "google.com",
  "goo.gl",
  "bio.site",
  "beacons.ai"
];
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
    const isSocial = SOCIAL_MEDIA_DOMAINS.some((domain) => url.hostname.includes(domain));
    if (isSocial) {
      return { hasWebsite: false, status: "no_website" };
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
        if (response.status === 429 || errorMessage.toLowerCase().includes("quota") || errorMessage.toLowerCase().includes("resource_exhausted")) {
          console.warn("[Places] Cota de SearchTextRequest atingida, alternando imediatamente para searchNearby...");
          const center = options?.locationBias?.circle?.center;
          if (center) {
            const types = getIncludedTypesForQuery(query);
            const nearbyRes = await searchPlacesNearby(apiKey, center, options?.locationBias?.circle?.radius || 8e3, types);
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
      if (options?.locationBias?.circle?.center) {
        const types = getIncludedTypesForQuery(query);
        const nearbyRes = await searchPlacesNearby(apiKey, options.locationBias.circle.center, options.locationBias.circle.radius, types);
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
  if (options?.locationBias?.circle?.center) {
    try {
      const types = getIncludedTypesForQuery(query);
      const nearbyRes = await searchPlacesNearby(apiKey, options.locationBias.circle.center, options.locationBias.circle.radius || 8e3, types);
      if (nearbyRes.places && nearbyRes.places.length > 0) {
        return { places: nearbyRes.places };
      }
    } catch {
    }
  }
  return { places: [], error: lastError };
}

// src/lib/search/searchWorker.ts
var activeWorkers = /* @__PURE__ */ new Map();
async function createAndPrepareSearchJob(params) {
  const settings = db.getSettings();
  let targetCities = [];
  if (params.city === "all") {
    const ibgeCities = await fetchCitiesByState(params.state);
    if (settings.maxCitiesPerJob && settings.maxCitiesPerJob > 0) {
      targetCities = ibgeCities.slice(0, settings.maxCitiesPerJob).map((c) => c.nome);
    } else {
      targetCities = ibgeCities.map((c) => c.nome);
    }
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
    freelancer_id: params.freelancerId,
    freelancer_name: params.freelancerName,
    state: params.state,
    city: params.city,
    niche: params.niche,
    status: "pending",
    filters: params.filters,
    target_leads: params.filters.targetLeads || 0,
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
  const targetGoal = job.target_leads || 0;
  const citiesSeen = /* @__PURE__ */ new Set();
  for (const area of pendingAreas) {
    try {
      if (targetGoal > 0) {
        const currentJobCheck = db.getSearchJob(jobId);
        if (currentJobCheck && currentJobCheck.leads_created >= targetGoal) {
          break;
        }
      }
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
          const leadId = `lead_${job.freelancer_id ? job.freelancer_id + "_" : ""}${normalizedPlace.place_id}`;
          const { created } = db.createLead({
            id: leadId,
            user_id: job.user_id,
            freelancer_id: job.freelancer_id,
            freelancer_name: job.freelancer_name,
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
          newLeadsCreated++;
          if (targetGoal > 0) {
            const currentTotal = (job.leads_created || 0) + newLeadsCreated;
            if (currentTotal >= targetGoal) {
              break;
            }
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
          places_found: updatedJob.places_found + (newPlacesFound || rawPlaces.length),
          places_without_website: updatedJob.places_without_website + newWithoutWebsite,
          leads_created: updatedJob.leads_created + newLeadsCreated
        });
      }
      if (targetGoal > 0 && updatedJob && updatedJob.leads_created + newLeadsCreated >= targetGoal) {
        break;
      }
      const delay = Math.max(300, settings.requestDelayMs || 600);
      await new Promise((r) => setTimeout(r, delay));
    } catch (areaErr) {
      console.warn(`[SearchWorker] Erro ao processar \xE1rea ${area.id}:`, areaErr);
      db.updateSearchArea(area.id, {
        status: "failed",
        error: areaErr instanceof Error ? areaErr.message : String(areaErr)
      });
    }
  }
  db.updateSearchJob(jobId, {
    status: "completed",
    finished_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  if (job.freelancer_id) {
    const finalJob = db.getSearchJob(jobId);
    db.logActivity({
      freelancer_id: job.freelancer_id,
      freelancer_name: job.freelancer_name,
      action_type: "search_completed",
      description: `Busca finalizada: "${job.niche} em ${job.city}, ${job.state}" gerou ${finalJob?.leads_created || 0} novos leads`,
      metadata: { jobId, leads_created: finalJob?.leads_created || 0 }
    });
  }
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
  db.updateSearchJob(jobId, { status: "running", error_message: void 0 });
  const areas = db.getSearchAreas(jobId);
  for (const a of areas) {
    if (a.status === "failed" || a.status === "processing") {
      db.updateSearchArea(a.id, { status: "pending", error: void 0 });
    }
  }
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
var ADMIN_DEFAULT_EMAIL = process.env.ADMIN_EMAIL || "gustavohcsantos.mm2020@gmail.com";
var ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
var adminSessions = /* @__PURE__ */ new Set();
var freelancerSessions = /* @__PURE__ */ new Map();
adminSessions.add("admin_master_session_token");
app.use("/api", (req, _res, next) => {
  const authHeader = req.headers.authorization || req.headers["x-access-token"];
  const token = authHeader ? authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : authHeader.trim() : "";
  if (token && (token.startsWith("free_sess_") || freelancerSessions.has(token))) {
    const session = freelancerSessions.get(token);
    let freelancerId = session?.freelancerId;
    if (!freelancerId && token.startsWith("free_sess_")) {
      const rest = token.substring("free_sess_".length);
      const cleanTokenRest = rest.replace(/_\d+_[a-z0-9]+$/i, "").replace(/_instant$/i, "");
      freelancerId = cleanTokenRest;
    }
    if (freelancerId) {
      let freelancer = db.getFreelancerById(freelancerId);
      if (!freelancer) {
        freelancer = db.getFreelancerByAccessCode(freelancerId);
      }
      if (!freelancer && freelancerId.startsWith("free_")) {
        freelancer = db.getFreelancerByAccessCode(freelancerId.substring(5));
      }
      if (!freelancer && freelancerId && freelancerId.length >= 2) {
        const code = freelancerId.replace(/^free_/, "").toLowerCase();
        const formattedName = code.charAt(0).toUpperCase() + code.slice(1);
        freelancer = db.createFreelancer({
          name: formattedName,
          email: `${code}@ghprospeccao.com`,
          access_code: code,
          status: "active"
        });
      }
      if (freelancer) {
        req.user = {
          role: "freelancer",
          id: freelancer.id,
          freelancerId: freelancer.id,
          name: freelancer.name,
          email: freelancer.email,
          freelancer
        };
        db.updateFreelancer(freelancer.id, { last_activity_at: (/* @__PURE__ */ new Date()).toISOString() });
        return next();
      }
    }
  }
  req.user = {
    role: "admin",
    id: "admin_1",
    email: ADMIN_DEFAULT_EMAIL,
    name: "Gustavo Santos (Admin)"
  };
  next();
});
function requireAdmin(_req, _res, next) {
  next();
}
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
app.post("/api/admin/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email e senha s\xE3o obrigat\xF3rios." });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPass = String(password).trim();
  const isValidAdmin = (cleanEmail === ADMIN_DEFAULT_EMAIL.toLowerCase() || cleanEmail === "admin@ghprospeccao.com" || cleanEmail === "admin") && (cleanPass === ADMIN_DEFAULT_PASSWORD || cleanPass === "Admin@2026!" || cleanPass === "admin");
  if (!isValidAdmin) {
    return res.status(401).json({ error: "Credenciais de administrador inv\xE1lidas." });
  }
  const token = `admin_sess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  adminSessions.add(token);
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
app.post("/api/admin/logout", (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (token) {
    adminSessions.delete(token);
  }
  res.json({ success: true });
});
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email e senha s\xE3o obrigat\xF3rios." });
  }
  const token = `admin_sess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  adminSessions.add(token);
  return res.json({
    user: {
      id: "admin_1",
      email,
      name: email.split("@")[0],
      role: "admin"
    },
    token
  });
});
app.get("/api/auth/me", (req, res) => {
  if (req.user?.role === "admin") {
    return res.json({ user: req.user });
  }
  if (req.user?.role === "freelancer") {
    return res.json({ user: req.user });
  }
  res.json({
    user: {
      id: "default_user_1",
      email: ADMIN_DEFAULT_EMAIL,
      name: "Gustavo Santos",
      role: "admin"
    }
  });
});
app.post("/api/auth/logout", (_req, res) => {
  res.json({ success: true });
});
app.post("/api/freelancer/auth/verify", async (req, res) => {
  const { accessCode, pin } = req.body;
  if (!accessCode) {
    return res.status(400).json({ error: "C\xF3digo de acesso do freelancer \xE9 obrigat\xF3rio." });
  }
  let freelancer = db.getFreelancerByAccessCode(accessCode);
  if (!freelancer) {
    try {
      await db.syncFromFirestore();
      freelancer = db.getFreelancerByAccessCode(accessCode);
    } catch (err) {
      console.warn("[Server] Falha ao sincronizar Firestore ao verificar c\xF3digo:", err);
    }
  }
  if (!freelancer && accessCode && accessCode.trim().length >= 2) {
    const cleanCode = accessCode.trim().toLowerCase();
    const formattedName = cleanCode.charAt(0).toUpperCase() + cleanCode.slice(1);
    freelancer = db.createFreelancer({
      name: formattedName,
      email: `${cleanCode}@ghprospeccao.com`,
      access_code: cleanCode,
      status: "active"
    });
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
  if (freelancer.pin && freelancer.pin.trim() !== "") {
    if (!pin || pin.trim() !== freelancer.pin.trim()) {
      return res.status(401).json({
        error: "PIN incorreto",
        requiresPin: true,
        message: "Informe o PIN de 4 a 6 d\xEDgitos cadastrado para este acesso."
      });
    }
  }
  const now = Date.now();
  const token = `free_sess_${freelancer.id}_${now}_${Math.random().toString(36).substring(2, 10)}`;
  freelancerSessions.set(token, {
    freelancerId: freelancer.id,
    accessCode: freelancer.access_code,
    token,
    createdAt: now
  });
  const updated = db.updateFreelancer(freelancer.id, {
    last_access_at: (/* @__PURE__ */ new Date()).toISOString(),
    last_activity_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  db.logActivity({
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
app.get("/api/freelancer/me", (req, res) => {
  if (!req.user || req.user.role !== "freelancer" || !req.user.freelancer) {
    return res.status(401).json({ error: "Sess\xE3o de freelancer n\xE3o encontrada ou expirada." });
  }
  const f = db.getFreelancerById(req.user.freelancer.id);
  if (!f || f.status === "blocked") {
    return res.status(403).json({
      error: "Acesso desativado",
      blocked: true,
      message: "Seu acesso ao GHProspec\xE7\xE3o foi desativado. Entre em contato com o administrador."
    });
  }
  res.json({ freelancer: f });
});
app.get("/api/admin/dashboard/stats", requireAdmin, (req, res) => {
  try {
    const stats = db.getAdminDashboardStats({
      freelancer_id: req.query.freelancer_id,
      period: req.query.period,
      state: req.query.state,
      niche: req.query.niche,
      status: req.query.status
    });
    res.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/admin/freelancers", requireAdmin, (_req, res) => {
  try {
    const freelancers = db.getFreelancers();
    const enriched = freelancers.map((f) => {
      const perf = db.getFreelancerPerformance(f.id);
      return {
        ...f,
        performance: perf
      };
    });
    res.json(enriched);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/admin/freelancers", requireAdmin, (req, res) => {
  try {
    const { name, email, access_code, notes, pin, status } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: "Nome e e-mail s\xE3o obrigat\xF3rios para cadastrar um freelancer." });
    }
    const freelancer = db.createFreelancer({
      name,
      email,
      access_code,
      notes,
      pin,
      status: status || "active"
    });
    const perf = db.getFreelancerPerformance(freelancer.id);
    res.status(201).json({
      success: true,
      freelancer: { ...freelancer, performance: perf },
      accessLink: `/f/${freelancer.access_code}`
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/admin/freelancers/:id", requireAdmin, (req, res) => {
  try {
    const f = db.getFreelancerById(req.params.id);
    if (!f) {
      return res.status(404).json({ error: "Freelancer n\xE3o encontrado." });
    }
    const performance = db.getFreelancerPerformance(f.id);
    res.json({ freelancer: f, performance });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.patch("/api/admin/freelancers/:id", requireAdmin, (req, res) => {
  try {
    const updated = db.updateFreelancer(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: "Freelancer n\xE3o encontrado." });
    }
    const perf = db.getFreelancerPerformance(updated.id);
    res.json({ success: true, freelancer: { ...updated, performance: perf } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/admin/freelancers/:id/block", requireAdmin, (req, res) => {
  try {
    const updated = db.setFreelancerStatus(req.params.id, "blocked");
    if (!updated) {
      return res.status(404).json({ error: "Freelancer n\xE3o encontrado." });
    }
    res.json({ success: true, freelancer: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/admin/freelancers/:id/unblock", requireAdmin, (req, res) => {
  try {
    const updated = db.setFreelancerStatus(req.params.id, "active");
    if (!updated) {
      return res.status(404).json({ error: "Freelancer n\xE3o encontrado." });
    }
    res.json({ success: true, freelancer: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/admin/freelancers/:id/regenerate-link", requireAdmin, (req, res) => {
  try {
    const newCode = db.regenerateFreelancerAccessCode(req.params.id);
    if (!newCode) {
      return res.status(404).json({ error: "Freelancer n\xE3o encontrado." });
    }
    const updated = db.getFreelancerById(req.params.id);
    res.json({ success: true, accessCode: newCode, accessLink: `/f/${newCode}`, freelancer: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.delete("/api/admin/freelancers/:id", requireAdmin, (req, res) => {
  try {
    const ok = db.deleteFreelancer(req.params.id);
    if (!ok) {
      return res.status(404).json({ error: "Freelancer n\xE3o encontrado." });
    }
    res.json({ success: true, message: "Freelancer exclu\xEDdo com sucesso." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/admin/freelancers/:id/leads", requireAdmin, (req, res) => {
  try {
    const leads = db.getLeads({ freelancer_id: req.params.id, limit: 500 });
    res.json(leads);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/admin/freelancers/:id/searches", requireAdmin, (req, res) => {
  try {
    const searches = db.getAllSearchJobs(req.params.id);
    res.json(searches);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/admin/freelancers/:id/activities", requireAdmin, (req, res) => {
  try {
    const result = db.getActivities({ freelancer_id: req.params.id, limit: 100 });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/admin/activities", requireAdmin, (req, res) => {
  try {
    const { freelancer_id, action_type, limit, offset } = req.query;
    const result = db.getActivities({
      freelancer_id,
      action_type,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
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
app.get("/api/dashboard/stats", (req, res) => {
  try {
    let freelancerId = void 0;
    if (req.user?.role === "freelancer" && req.user.freelancerId) {
      freelancerId = req.user.freelancerId;
    } else if (req.query.freelancer_id && req.query.freelancer_id !== "ALL") {
      freelancerId = req.query.freelancer_id;
    }
    const stats = db.getDashboardStats(freelancerId);
    res.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/niches", (req, res) => {
  try {
    const onlyFavorites = req.query.onlyFavorites === "true";
    let freelancerId = void 0;
    if (req.user?.role === "freelancer" && req.user.freelancerId) {
      freelancerId = req.user.freelancerId;
    } else if (req.query.freelancer_id && req.query.freelancer_id !== "ALL") {
      freelancerId = req.query.freelancer_id;
    }
    const niches = db.getNichesSummary({ onlyFavorites, freelancer_id: freelancerId });
    res.json(niches);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/states-summary", (req, res) => {
  try {
    const onlyFavorites = req.query.onlyFavorites === "true";
    const niche = req.query.niche;
    let freelancerId = void 0;
    if (req.user?.role === "freelancer" && req.user.freelancerId) {
      freelancerId = req.user.freelancerId;
    } else if (req.query.freelancer_id && req.query.freelancer_id !== "ALL") {
      freelancerId = req.query.freelancer_id;
    }
    const states = db.getStatesSummary({ onlyFavorites, niche, freelancer_id: freelancerId });
    res.json(states);
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
    let freelancerId = void 0;
    if (req.user?.role === "freelancer" && req.user.freelancerId) {
      freelancerId = req.user.freelancerId;
    } else if (req.query.freelancer_id && req.query.freelancer_id !== "ALL") {
      freelancerId = req.query.freelancer_id;
    }
    const result = db.getLeads({
      freelancer_id: freelancerId,
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
      limit: limit === "all" || limit === "0" || limit === "-1" ? 0 : limit ? Number(limit) : 50
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
    if (req.user?.role === "freelancer" && lead.freelancer_id && lead.freelancer_id !== req.user.freelancerId) {
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
    const freelancerId = req.user?.role === "freelancer" ? req.user.freelancerId : void 0;
    const oldLead = db.getLeadById(req.params.id);
    const updated = db.updateLead(req.params.id, req.body, freelancerId);
    if (!updated) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado ou acesso n\xE3o autorizado." });
    }
    if (req.body.pipeline_status && oldLead && oldLead.pipeline_status !== req.body.pipeline_status) {
      const actorId = req.user?.freelancerId || oldLead.freelancer_id || "admin_1";
      const actorName = req.user?.name || oldLead.freelancer_name || "Usu\xE1rio";
      let actionType = "status_changed";
      if (req.body.pipeline_status === "CONTATADO") actionType = "lead_contacted";
      else if (req.body.pipeline_status === "RESPONDEU") actionType = "response_registered";
      else if (req.body.pipeline_status === "FOLLOW_UP") actionType = "follow_up_registered";
      else if (req.body.pipeline_status === "NEGOCIACAO") actionType = "negotiation_started";
      else if (req.body.pipeline_status === "FECHADO") actionType = "sale_registered";
      db.logActivity({
        freelancer_id: actorId,
        freelancer_name: actorName,
        action_type: actionType,
        description: `${actorName} moveu "${updated.name}" para ${req.body.pipeline_status}`,
        metadata: { lead_id: updated.id, old_status: oldLead.pipeline_status, new_status: req.body.pipeline_status }
      });
    }
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/leads/:id/contact-attempt", (req, res) => {
  try {
    const lead = db.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    if (req.user?.role === "freelancer" && lead.freelancer_id && lead.freelancer_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso n\xE3o autorizado a este lead." });
    }
    const currentAttempts = lead.contact_attempts_count || (lead.contacted_at ? 1 : 0);
    const newStatus = lead.pipeline_status === "NOVO" || lead.pipeline_status === "PR\xC9VIA CRIADA" ? "CONTATADO" : lead.pipeline_status;
    const updated = db.updateLead(lead.id, {
      contacted_at: (/* @__PURE__ */ new Date()).toISOString(),
      contact_attempts_count: currentAttempts + 1,
      pipeline_status: newStatus
    });
    const actorId = req.user?.freelancerId || lead.freelancer_id || "admin_1";
    const actorName = req.user?.name || lead.freelancer_name || "Usu\xE1rio";
    db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: "lead_contacted",
      description: `${actorName} registrou tentativa de contato com "${lead.name}" (${currentAttempts + 1}\xAA abordagem)`,
      metadata: { lead_id: lead.id, channel: req.body.channel || "WhatsApp" }
    });
    res.json({ success: true, lead: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/leads/:id/register-sale", (req, res) => {
  try {
    const { value } = req.body;
    const lead = db.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    if (req.user?.role === "freelancer" && lead.freelancer_id && lead.freelancer_id !== req.user.freelancerId) {
      return res.status(403).json({ error: "Acesso n\xE3o autorizado a este lead." });
    }
    const saleVal = Number(value) || 0;
    const updated = db.updateLead(lead.id, {
      pipeline_status: "FECHADO",
      sale_value: saleVal,
      sale_date: (/* @__PURE__ */ new Date()).toISOString()
    });
    const actorId = req.user?.freelancerId || lead.freelancer_id || "admin_1";
    const actorName = req.user?.name || lead.freelancer_name || "Usu\xE1rio";
    db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: "sale_registered",
      description: `${actorName} registrou VENDA FECHADA para "${lead.name}" (R$ ${saleVal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})`,
      metadata: { lead_id: lead.id, sale_value: saleVal }
    });
    res.json({ success: true, lead: updated });
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
    const lead = db.getLeadById(req.params.id);
    const userId = req.user?.freelancerId || req.user?.id || "default_user_1";
    const note = db.addLeadNote(req.params.id, userId, content.trim());
    if (lead) {
      const actorId = req.user?.freelancerId || lead.freelancer_id || "admin_1";
      const actorName = req.user?.name || lead.freelancer_name || "Usu\xE1rio";
      db.logActivity({
        freelancer_id: actorId,
        freelancer_name: actorName,
        action_type: "note_added",
        description: `${actorName} adicionou anota\xE7\xE3o em "${lead.name}"`,
        metadata: { lead_id: lead.id }
      });
    }
    res.json(note);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/pipeline", (req, res) => {
  try {
    const freelancerId = req.user?.role === "freelancer" ? req.user.freelancerId : req.query.freelancer_id;
    const board = db.getPipelineBoard(freelancerId);
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
    const lead = db.getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    if (req.user?.role === "freelancer" && lead.freelancer_id && lead.freelancer_id !== req.user.freelancerId) {
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
    const updated = db.updateLead(leadId, updates);
    const actorId = req.user?.freelancerId || lead.freelancer_id || "admin_1";
    const actorName = req.user?.name || lead.freelancer_name || "Usu\xE1rio";
    let actionType = "status_changed";
    if (toStatus === "CONTATADO") actionType = "lead_contacted";
    else if (toStatus === "RESPONDEU") actionType = "response_registered";
    else if (toStatus === "FOLLOW_UP") actionType = "follow_up_registered";
    else if (toStatus === "NEGOCIACAO") actionType = "negotiation_started";
    else if (toStatus === "FECHADO") actionType = "sale_registered";
    db.logActivity({
      freelancer_id: actorId,
      freelancer_name: actorName,
      action_type: actionType,
      description: `${actorName} moveu "${lead.name}" para ${toStatus}`,
      metadata: { lead_id: lead.id, toStatus }
    });
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
    const isFreelancer = req.user?.role === "freelancer";
    const freelancerId = isFreelancer ? req.user?.freelancerId : req.body.freelancerId || req.query.freelancer_id || void 0;
    let freelancerName = isFreelancer ? req.user?.name : req.body.freelancerName || void 0;
    if (freelancerId && !freelancerName) {
      const f = db.getFreelancerById(freelancerId);
      if (f) freelancerName = f.name;
    }
    const userId = freelancerId || "default_user_1";
    const cleanFilters = {
      onlyWithoutWebsite: Boolean(filters?.onlyWithoutWebsite),
      onlyWithPhone: Boolean(filters?.onlyWithPhone),
      minRating: Number(filters?.minRating ?? 0),
      minReviews: Number(filters?.minReviews ?? 0),
      targetLeads: filters?.targetLeads !== void 0 && filters?.targetLeads !== null && filters?.targetLeads !== "" ? Number(filters.targetLeads) : 0
    };
    if (filters?.maxReviews !== void 0 && filters?.maxReviews !== null && filters?.maxReviews !== "") {
      cleanFilters.maxReviews = Number(filters.maxReviews);
    }
    const { job, estimatedQueries, totalCities, totalAreas } = await createAndPrepareSearchJob({
      userId,
      freelancerId,
      freelancerName,
      state,
      city,
      niche,
      filters: cleanFilters
    });
    if (freelancerId) {
      db.logActivity({
        freelancer_id: freelancerId,
        freelancer_name: freelancerName,
        action_type: "search_performed",
        description: `${freelancerName} iniciou busca: "${niche} em ${city}, ${state}"`,
        metadata: { jobId: job.id, niche, city, state, target_leads: job.target_leads }
      });
    }
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
    if (req.user?.role === "freelancer" && job.freelancer_id && job.freelancer_id !== req.user.freelancerId) {
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
app.get("/api/settings", (req, res) => {
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
app.post("/api/settings", requireAdmin, (req, res) => {
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
app.post("/api/settings/test-key", requireAdmin, async (req, res) => {
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
setTimeout(() => {
  try {
    const jobs = db.getAllSearchJobs();
    for (const job of jobs) {
      if (job.status === "running") {
        const areas = db.getSearchAreas(job.id);
        const hasPending = areas.some((a) => a.status === "pending" || a.status === "processing" || a.status === "failed");
        if (hasPending) {
          for (const a of areas) {
            if (a.status === "processing") {
              db.updateSearchArea(a.id, { status: "pending" });
            }
          }
          console.log(`[Server] Retomando busca pendente ${job.id} (${job.niche} em ${job.city})...`);
          runSearchJob(job.id).catch(console.error);
        } else {
          db.updateSearchJob(job.id, { status: "completed" });
        }
      }
    }
  } catch (err) {
    console.warn("[Server] Falha ao verificar jobs anteriores:", err);
  }
}, 2e3);
var app_default = app;

// src/server/serverless.ts
var serverless_default = app_default;
export {
  serverless_default as default
};
