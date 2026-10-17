// src/server/app.ts
import express from "express";
import dotenv from "dotenv";
import crypto5 from "node:crypto";

// src/lib/store/repository.ts
import crypto3 from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

// src/lib/supabase/documentStore.ts
import crypto from "node:crypto";

// src/lib/supabase/admin.ts
var allowedCollections = /* @__PURE__ */ new Set([
  "leads",
  "deleted_leads",
  "places",
  "freelancers",
  "search_jobs",
  "search_areas",
  "search_queries",
  "search_results",
  "lead_notes",
  "activities",
  "settings",
  "sessions",
  "revoked_sessions",
  "access_codes",
  "freelancer_codes",
  "auth_attempts"
]);
var SupabaseStorageError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function configuration() {
  const url = process.env.GH_SUPABASE_URL;
  const secret = process.env.GH_SUPABASE_SECRET_KEY;
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !secret) {
    throw new Error("GH Supabase backend connection is not configured.");
  }
  return { url: url.replace(/\/$/, ""), secret };
}
async function request(path, init = {}) {
  const { url, secret } = configuration();
  const method = (init.method || "GET").toUpperCase();
  const retryable = method === "GET" || method === "POST" && path === "rpc/gh_read_epoch";
  const attempts = retryable ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response;
    try {
      response = await fetch(`${url}/rest/v1/${path}`, {
        ...init,
        headers: {
          apikey: secret,
          ...!secret.startsWith("sb_secret_") ? { Authorization: `Bearer ${secret}` } : {},
          Accept: "application/json",
          ...init.body ? { "Content-Type": "application/json" } : {},
          ...init.headers
        },
        signal: init.signal || AbortSignal.timeout(15e3),
        cache: "no-store"
      });
    } catch (error) {
      if (!retryable || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }
    if (!response.ok) {
      const message = (await response.text().catch(() => "")).slice(0, 400);
      if (retryable && [429, 502, 503, 504].includes(response.status) && attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      throw new SupabaseStorageError(response.status, `Supabase storage failure (HTTP ${response.status}): ${message}`);
    }
    const raw = await response.text();
    return raw ? JSON.parse(raw) : [];
  }
  throw new Error("Supabase read retry exhausted.");
}
function validateCollection(collection) {
  if (!allowedCollections.has(collection)) throw new Error("Unsupported collection.");
}
async function getRecords(collection, filters) {
  validateCollection(collection);
  const search = new URLSearchParams({
    select: "collection,id,workspace_id,document,revision",
    collection: `eq.${collection}`,
    order: "id.asc"
  });
  if (filters?.field === "workspace_id") search.set("workspace_id", `eq.${filters.value}`);
  const records = [];
  for (let offset = 0; offset < 1e6; offset += 500) {
    const page = await request(`app_records?${search}`, {
      headers: { Range: `${offset}-${offset + 499}`, "Range-Unit": "items" }
    });
    records.push(...page);
    if (page.length < 500) break;
    if (offset >= 999500) throw new Error("Storage query exceeded safe pagination limit.");
  }
  if (!filters || filters.field === "workspace_id") return records;
  return records.filter((record) => record.document?.[filters.field] === filters.value);
}
async function getRecord(collection, id) {
  validateCollection(collection);
  const search = new URLSearchParams({
    select: "collection,id,workspace_id,document,revision",
    collection: `eq.${collection}`,
    id: `eq.${id}`,
    limit: "1"
  });
  return (await request(`app_records?${search}`))[0];
}
async function commitChanges(reads, operations) {
  reads.forEach((read) => validateCollection(read.collection));
  operations.forEach((operation) => validateCollection(operation.collection));
  await request("rpc/gh_commit_changes", {
    method: "POST",
    body: JSON.stringify({ p_reads: reads, p_operations: operations, p_epoch: null })
  });
}

// src/lib/supabase/documentStore.ts
var clone = (value) => JSON.parse(JSON.stringify(value));
var matches = (value, expression) => {
  if ("kind" in expression) return expression.filters.some((filter) => matches(value, filter));
  const actual = expression.field === "workspace_id" ? value.workspace_id ?? value.freelancer_id ?? value.user_id ?? "admin" : value[expression.field];
  if (expression.operator === "==") return actual === expression.value;
  if (expression.operator === "in") return Array.isArray(expression.value) && expression.value.includes(actual);
  throw new Error("Unsupported document query operator.");
};
var DocumentSnapshot = class {
  constructor(id, payload, revision, ref) {
    this.id = id;
    this.payload = payload;
    this.revision = revision;
    this.ref = ref;
    this.exists = payload !== void 0;
  }
  data() {
    return this.payload === void 0 ? void 0 : clone(this.payload);
  }
  get(field) {
    return this.payload?.[field];
  }
};
var QuerySnapshot = class {
  constructor(docs) {
    this.docs = docs;
    this.empty = docs.length === 0;
    this.size = docs.length;
  }
  forEach(callback) {
    this.docs.forEach(callback);
  }
};
var Query = class _Query {
  constructor(collectionName, predicates = [], maximum) {
    this.collectionName = collectionName;
    this.predicates = predicates;
    this.maximum = maximum;
  }
  where(field, operator, value) {
    const predicate = typeof field === "string" ? { field, operator: operator || "==", value } : field.__documentFilter;
    return new _Query(this.collectionName, [...this.predicates, predicate], this.maximum);
  }
  limit(count) {
    return new _Query(this.collectionName, this.predicates, count);
  }
  async get() {
    const workspace = this.predicates.find(
      (predicate) => !("kind" in predicate) && predicate.field === "workspace_id" && predicate.operator === "=="
    );
    const all = await getRecords(this.collectionName, workspace ? { field: "workspace_id", value: String(workspace.value) } : void 0);
    const docs = all.filter((record) => this.predicates.every((predicate) => matches(record.document, predicate))).slice(0, this.maximum === void 0 ? void 0 : Math.max(0, this.maximum)).map((record) => new DocumentSnapshot(record.id, record.document, record.revision, new DocumentReference(record.collection, record.id)));
    return new QuerySnapshot(docs);
  }
};
var DocumentReference = class {
  constructor(collectionName, id) {
    this.collectionName = collectionName;
    this.id = id;
  }
  async get() {
    const record = await getRecord(this.collectionName, this.id);
    return new DocumentSnapshot(this.id, record?.document, record?.revision || 0, this);
  }
  async create(data) {
    await commitChanges([], [{ collection: this.collectionName, id: this.id, op: "create", document: clone(data) }]);
  }
  async set(data, options) {
    await commitChanges([], [{ collection: this.collectionName, id: this.id, op: options?.merge ? "merge" : "set", document: clone(data) }]);
  }
  async update(data) {
    await commitChanges([], [{ collection: this.collectionName, id: this.id, op: "update", document: clone(data) }]);
  }
  async delete() {
    await commitChanges([], [{ collection: this.collectionName, id: this.id, op: "delete" }]);
  }
};
var CollectionReference = class extends Query {
  constructor(name) {
    super(name);
  }
  doc(id) {
    return new DocumentReference(this.collectionName, id || crypto.randomUUID());
  }
};
var Transaction = class {
  constructor() {
    this.reads = [];
    this.operations = [];
    this.cache = /* @__PURE__ */ new Map();
  }
  async get(source) {
    if (source instanceof DocumentReference) {
      const key = `${source.collectionName}/${source.id}`;
      let snapshot2 = this.cache.get(key);
      if (!snapshot2) {
        snapshot2 = await source.get();
        this.cache.set(key, snapshot2);
      }
      if (!this.reads.some((read) => read.collection === source.collectionName && read.id === source.id)) {
        this.reads.push({ collection: source.collectionName, id: source.id, revision: snapshot2.revision });
      }
      return snapshot2;
    }
    const snapshot = await source.get();
    for (const document of snapshot.docs) {
      if (!this.reads.some((read) => read.collection === source.collectionName && read.id === document.id)) {
        this.reads.push({ collection: source.collectionName, id: document.id, revision: document.revision });
      }
    }
    return snapshot;
  }
  async getAll(...references) {
    return Promise.all(references.map((reference) => this.get(reference)));
  }
  set(reference, data, options) {
    this.operations.push({ collection: reference.collectionName, id: reference.id, op: options?.merge ? "merge" : "set", document: clone(data) });
    return this;
  }
  create(reference, data) {
    this.operations.push({ collection: reference.collectionName, id: reference.id, op: "create", document: clone(data) });
    return this;
  }
  update(reference, data) {
    this.operations.push({ collection: reference.collectionName, id: reference.id, op: "update", document: clone(data) });
    return this;
  }
  delete(reference) {
    this.operations.push({ collection: reference.collectionName, id: reference.id, op: "delete" });
    return this;
  }
  async commit() {
    if (this.operations.length) await commitChanges(this.reads, this.operations);
  }
};
var DocumentStore = class {
  collection(name) {
    return new CollectionReference(name);
  }
  async getAll(...references) {
    return Promise.all(references.map((reference) => reference.get()));
  }
  async runTransaction(callback, options) {
    const attempts = options?.maxAttempts || 5;
    for (let index = 0; index < attempts; index++) {
      const transaction = new Transaction();
      const result = await callback(transaction);
      if (options?.readOnly) return result;
      try {
        await transaction.commit();
        return result;
      } catch (error) {
        if (index === attempts - 1 || !/GH_TX_CONFLICT|40001|serialization|23505|duplicate key/i.test(String(error))) throw error;
      }
    }
    throw new Error("Transaction retry exhausted.");
  }
};
var DocumentFilter = {
  where(field, operator, value) {
    return { __documentFilter: { field, operator, value } };
  },
  or(...filters) {
    return { __documentFilter: { kind: "or", filters: filters.map((filter) => filter.__documentFilter) } };
  }
};
var singleton = new DocumentStore();
function getDocumentStore() {
  return singleton;
}

// src/lib/store/ownership.ts
function canonicalWorkspace(id) {
  const value = (id || "").trim().toLowerCase();
  if (!value || ["admin", "administrador", "default"].includes(value) || value.startsWith("admin_") || value.startsWith("default_user")) return "admin";
  return value.startsWith("freelancer:") ? value : `freelancer:${value.replace(/^free_/, "")}`;
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
  getLeads(params, snapshots = /* @__PURE__ */ new Map()) {
    let filtered = (this.data.leads || []).filter((l) => l && l.id && !this.deletedLeadIds.has(l.id));
    if (params.search_job_id) filtered = filtered.filter((l) => l.search_job_ids?.includes(params.search_job_id));
    if (snapshots.size > 0) {
      filtered = filtered.filter((lead) => snapshots.has(lead.id)).map((lead) => ({ ...lead, ...snapshots.get(lead.id) }));
    }
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
    if (params.maxRating) {
      filtered = filtered.filter((l) => l.rating <= params.maxRating);
    }
    if (params.minReviews) {
      filtered = filtered.filter((l) => l.reviews_count >= params.minReviews);
    }
    if (params.maxReviews) {
      filtered = filtered.filter((l) => l.reviews_count <= params.maxReviews);
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
import crypto2 from "node:crypto";
function hashPin(pin) {
  const salt = crypto2.randomBytes(16).toString("hex");
  return `${salt}:${crypto2.scryptSync(pin, salt, 64).toString("hex")}`;
}

// src/lib/store/repository.ts
var actorContext = new AsyncLocalStorage();
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var digest = (value) => crypto3.createHash("sha256").update(value).digest("hex");
var leadIdentity = (workspace, place, niche) => `lead_${digest(JSON.stringify([canonicalWorkspace(workspace), place, nicheKey(niche)]))}`;
function assertOwner(record) {
  const actor = actorContext.getStore();
  if (actor?.role === "freelancer" && !isLeadInWorkspace(record, actor.freelancerId)) throw Object.assign(new Error("Acesso negado ao workspace."), { status: 403 });
}
var clean = (value) => JSON.parse(JSON.stringify(value));
var accessCodeBase = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "freelancer";
var mutableLeadFields = /* @__PURE__ */ new Set(["name", "phone", "address", "city", "state", "website", "website_status", "maps_url", "is_favorite", "is_hidden", "pipeline_status", "contacted_at", "contact_attempts_count", "response_at", "follow_up_at", "negotiation_at", "sale_value", "sale_date", "preview_url", "notes"]);
var pipelineStatuses = ["NOVO", "PR\xC9VIA CRIADA", "CONTATADO", "RESPONDEU", "INTERESSADO", "FOLLOW_UP", "NEGOCIACAO", "REUNI\xC3O", "PROPOSTA", "FECHADO", "PERDIDO", "NAO_INTERESSADO", "SEM_RESPOSTA"];
var defaults = { googleMapsApiKey: "", hasCustomKey: false, maxResultsPerJob: 0, maxCitiesPerJob: 0, requestDelayMs: 400, scoringWeights: DEFAULT_SCORING_WEIGHTS };
var Repository = class {
  constructor(supplied) {
    this.supplied = supplied;
  }
  get store() {
    return this.supplied || getDocumentStore();
  }
  async list(collection, field, value) {
    const ref = this.store.collection(collection);
    const snap = await (field ? ref.where(field, "==", value) : ref).get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  }
  async get(collection, id) {
    const snap = await this.store.collection(collection).doc(id).get();
    return snap.exists ? { ...snap.data(), id: snap.id } : void 0;
  }
  async ensureInitialized() {
    await this.store.collection("settings").doc("config").get();
  }
  async ensureWorkspaceHydrated(_workspace, _force) {
    await this.ensureInitialized();
  }
  async syncFromSupabase() {
    const [leads, places] = await Promise.all([this.list("leads"), this.list("places")]);
    return { leadsCount: leads.length, placesCount: places.length };
  }
  async isSessionRevoked(token) {
    return Boolean(await this.get("revoked_sessions", digest(token)));
  }
  async revokeSession(token) {
    const id = digest(token);
    await this.store.collection("revoked_sessions").doc(id).set({ revoked_at: now(), workspace_id: "admin" });
    return id;
  }
  async projection(includeAdmin = false, workspace) {
    return this.store.runTransaction(async (tx) => {
      const actor = actorContext.getStore();
      const target = actor?.role === "freelancer" ? actor.freelancerId : workspace;
      const base = this.store.collection("leads");
      const canonical = canonicalWorkspace(target);
      const short = canonical.replace(/^freelancer:/, "");
      const ids = [.../* @__PURE__ */ new Set([target, canonical, short, `free_${short}`])].filter(Boolean);
      const query = target && target !== "ALL" && canonical !== "admin" ? base.where(DocumentFilter.or(...["workspace_id", "freelancer_id", "user_id"].map((field) => DocumentFilter.where(field, "in", ids)))) : base;
      const leads = await tx.get(query);
      const tombs = await tx.get(this.store.collection("deleted_leads"));
      const deleted = new Set(tombs.docs.map((d) => d.id));
      const rows = leads.docs.filter((d) => !deleted.has(d.id)).map((d) => ({ ...d.data(), id: d.id })).filter((l) => actor?.role !== "freelancer" || isLeadInWorkspace(l, actor.freelancerId));
      const data = { leads: rows, freelancers: [], activities: [], search_jobs: [] };
      if (includeAdmin) {
        for (const col of ["freelancers", "activities", "search_jobs"]) {
          const snap = await tx.get(this.store.collection(col));
          data[col] = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        }
        data.activities.sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
      return new Projections(data);
    }, { readOnly: true });
  }
  async getLeads(params) {
    if (!params.search_job_id) return (await this.projection(false, params.freelancer_id)).getLeads(params);
    const job = await this.getSearchJob(params.search_job_id);
    if (!job || params.freelancer_id !== "ALL" && !isLeadInWorkspace(job, params.freelancer_id)) {
      return { leads: [], total: 0, page: 1, totalPages: 1 };
    }
    const receipts = await this.list("search_results", "job_id", job.id);
    const snapshots = /* @__PURE__ */ new Map();
    for (const receipt of receipts) {
      if (!receipt.lead_id || typeof receipt.rating !== "number" || typeof receipt.reviews_count !== "number") continue;
      snapshots.set(receipt.lead_id, {
        rating: receipt.rating,
        reviews_count: receipt.reviews_count,
        website: receipt.website ?? "",
        website_status: receipt.website_status ?? "not_verified",
        phone: receipt.phone ?? ""
      });
    }
    return (await this.projection(false, params.freelancer_id)).getLeads({
      ...params,
      onlyWithoutWebsite: Boolean(params.onlyWithoutWebsite || job.filters.onlyWithoutWebsite),
      onlyWithPhone: Boolean(params.onlyWithPhone || job.filters.onlyWithPhone),
      minRating: Math.max(params.minRating ?? 0, job.filters.minRating ?? 0),
      maxRating: job.filters.maxRating,
      minReviews: Math.max(params.minReviews ?? 0, job.filters.minReviews ?? 0),
      maxReviews: job.filters.maxReviews
    }, snapshots);
  }
  async getLeadsCount() {
    return (await this.getLeads({ freelancer_id: "ALL", limit: 0 })).total;
  }
  async getNichesSummary(params) {
    return (await this.projection(false, params?.freelancer_id)).getNichesSummary(params);
  }
  async getStatesSummary(params) {
    return (await this.projection(false, params?.freelancer_id)).getStatesSummary(params);
  }
  async getDashboardStats(id) {
    return (await this.projection(false, id)).getDashboardStats(id);
  }
  async getPipelineBoard(id) {
    return (await this.projection(false, id)).getPipelineBoard(id);
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
    const [lead, tomb] = await Promise.all([this.get("leads", id), this.get("deleted_leads", id)]);
    if (lead) assertOwner(lead);
    return tomb ? void 0 : lead;
  }
  async getPlaceByPlaceId(id) {
    return this.get("places", id);
  }
  async isLeadDeleted(id) {
    return Boolean(await this.get("deleted_leads", id));
  }
  async upsertPlace(place) {
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.collection("places").doc(place.id);
      const previous = await tx.get(ref);
      tx.set(ref, clean(place), { merge: true });
      return { place, isNew: !previous.exists };
    });
  }
  async createLead(lead) {
    assertOwner(lead);
    return this.store.runTransaction(async (tx) => this.createLeadInTransaction(tx, lead));
  }
  async createLeadInTransaction(tx, input) {
    const id = leadIdentity(ownerOf(input), input.place_id, input.niche);
    const ref = this.store.collection("leads").doc(id);
    const [sameId, existing] = await Promise.all([tx.get(ref), tx.get(this.store.collection("leads").where("place_id", "==", input.place_id))]);
    const legacyId = `lead_${input.freelancer_id || "admin"}_${input.place_id}`;
    const tombs = await tx.getAll(...[.../* @__PURE__ */ new Set([id, input.id, legacyId])].map((x) => this.store.collection("deleted_leads").doc(x)));
    if (sameId.exists) return { lead: { ...sameId.data(), id }, created: false, isDeleted: false };
    const previous = existing.docs.map((d) => ({ ...d.data(), id: d.id })).find((l) => ownerOf(l) === ownerOf(input) && nicheKey(l.niche) === nicheKey(input.niche));
    if (tombs.some((s) => s.exists)) return { lead: input, created: false, isDeleted: true };
    if (previous) return { lead: previous, created: false, isDeleted: false };
    const lead = clean({ ...input, id, workspace_id: input.workspace_id || input.freelancer_id || "admin" });
    tx.create(ref, lead);
    return { lead, created: true, isDeleted: false };
  }
  async updateLead(id, updates, freelancerId) {
    return this.mutateLead(id, (lead) => {
      if (freelancerId && !isLeadInWorkspace(lead, freelancerId)) throw Object.assign(new Error("Acesso negado."), { status: 403 });
      if (updates.pipeline_status && !pipelineStatuses.includes(updates.pipeline_status)) throw Object.assign(new Error("Status inv\xE1lido."), { status: 400 });
      const fields = Object.fromEntries(Object.entries(updates).filter(([key]) => mutableLeadFields.has(key)));
      for (const [key, value] of Object.entries(fields)) {
        const valid = ["is_favorite", "is_hidden"].includes(key) ? typeof value === "boolean" : ["sale_value", "contact_attempts_count"].includes(key) ? typeof value === "number" && Number.isFinite(value) && value >= 0 : typeof value === "string";
        if (!valid || key === "name" && !String(value).trim()) throw Object.assign(new Error("Campo comercial inv\xE1lido."), { status: 400 });
      }
      return { ...lead, ...fields };
    });
  }
  async mutateLead(id, change) {
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.collection("leads").doc(id);
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
    const note = { id: crypto3.randomUUID(), lead_id: leadId, user_id: userId, content, created_at: now() };
    await this.store.runTransaction(async (tx) => {
      const snap = await tx.get(this.store.collection("leads").doc(leadId));
      if (!snap.exists) throw new Error("Lead n\xE3o encontrado");
      assertOwner(snap.data());
      tx.create(this.store.collection("lead_notes").doc(note.id), note);
    });
    return note;
  }
  async getLeadNotes(id) {
    await this.getLeadById(id);
    return this.list("lead_notes", "lead_id", id);
  }
  async deleteLead(id, freelancerId) {
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.collection("leads").doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const lead = { ...snap.data(), id };
      assertOwner(lead);
      if (freelancerId && !isLeadInWorkspace(lead, freelancerId)) throw Object.assign(new Error("Acesso negado"), { status: 403 });
      const tomb = { deleted_at: now(), workspace_id: ownerOf(lead), lead };
      tx.set(this.store.collection("deleted_leads").doc(id), tomb);
      const identity = leadIdentity(ownerOf(lead), lead.place_id, lead.niche);
      if (identity !== id) tx.set(this.store.collection("deleted_leads").doc(identity), tomb);
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
    return { ...result, jobsCancelled, supabaseDeletedCount: result.deletedCount };
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
    const requested = accessCodeBase(data.access_code || data.name);
    const created = await this.store.runTransaction(async (tx) => {
      const existing = await tx.get(this.store.collection("freelancers"));
      const occupied = new Set(existing.docs.map((doc) => String(doc.data()?.access_code || "").toLowerCase()));
      let code = requested;
      if (occupied.has(code)) {
        do
          code = `${requested}-${crypto3.randomBytes(3).toString("hex")}`;
        while (occupied.has(code));
      }
      const f = clean({ ...data, id: `free_${crypto3.randomUUID()}`, access_code: code, status: data.status || "active", created_at: now(), updated_at: now() });
      if (f.pin) {
        f.pin_hash = hashPin(f.pin);
        delete f.pin;
      }
      tx.create(this.store.collection("freelancers").doc(f.id), f);
      return f;
    });
    await this.logActivity({ freelancer_id: created.id, action_type: "freelancer_created", description: "Freelancer cadastrado." });
    return created;
  }
  async updateFreelancer(id, updates) {
    if (updates.pin !== void 0) updates = { ...updates, pin_hash: updates.pin ? hashPin(updates.pin) : "", pin: "" };
    if (updates.access_code !== void 0) updates = { ...updates, access_code: accessCodeBase(updates.access_code) };
    const allowed = ["name", "email", "access_code", "notes", "pin", "pin_hash", "status", "last_access_at", "last_activity_at"];
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.collection("freelancers").doc(id);
      const [snap, all] = await Promise.all([tx.get(ref), tx.get(this.store.collection("freelancers"))]);
      if (!snap.exists || snap.data()?.deleted_at) return void 0;
      const accepted = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
      if (accepted.access_code && all.docs.some((doc) => doc.id !== id && String(doc.data()?.access_code || "").toLowerCase() === String(accepted.access_code).toLowerCase())) throw Object.assign(new Error("Link de acesso j\xE1 est\xE1 em uso."), { status: 409 });
      const f = clean({ ...snap.data(), ...accepted, id, updated_at: now() });
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
    const code = `${accessCodeBase(f.name)}-${crypto3.randomBytes(3).toString("hex")}`;
    await this.updateFreelancer(id, { access_code: code });
    return code;
  }
  async deleteFreelancer(id) {
    const f = await this.getFreelancerById(id);
    if (!f) return { success: false, leadsRemoved: 0, jobsRemoved: 0, activitiesRemoved: 0 };
    const jobsRemoved = await this.cancelWorkspaceJobs(id);
    await this.store.collection("freelancers").doc(id).update({ status: "blocked", deleted_at: now(), updated_at: now() });
    return { success: true, name: f.name, leadsRemoved: 0, jobsRemoved, activitiesRemoved: 0 };
  }
  async logActivity(activity) {
    const item = clean({ ...activity, id: crypto3.randomUUID(), created_at: now() });
    await this.store.collection("activities").doc(item.id).create(item);
    return item;
  }
  async getSearchJob(id) {
    const job = await this.get("search_jobs", id);
    if (job) assertOwner(job);
    return job;
  }
  async getAllSearchJobs(id) {
    const actor = actorContext.getStore();
    return (await this.list("search_jobs")).filter((j) => (id === void 0 || isLeadInWorkspace(j, id)) && (actor?.role !== "freelancer" || isLeadInWorkspace(j, actor.freelancerId))).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async claimSearchJob(id, token, leaseMs = 12e4) {
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.collection("search_jobs").doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const job = { ...snap.data(), id };
      assertOwner(job);
      if (["cancelled", "completed"].includes(job.status)) return false;
      if (job.lease_token && job.lease_token !== token && (job.lease_until || 0) > Date.now()) return false;
      tx.set(ref, clean({ ...job, status: "running", lease_token: token, lease_until: Date.now() + leaseMs, updated_at: now() }));
      return true;
    });
  }
  async renewSearchJobLease(id, token, leaseMs = 12e4) {
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.collection("search_jobs").doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()?.lease_token !== token) return false;
      tx.update(ref, { lease_until: Date.now() + leaseMs, updated_at: now() });
      return true;
    });
  }
  async releaseSearchJobLease(id, token) {
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.collection("search_jobs").doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()?.lease_token !== token) return false;
      tx.update(ref, { lease_token: "", lease_until: 0, updated_at: now() });
      return true;
    });
  }
  async createSearchJob(job, areas = []) {
    await this.store.collection("search_jobs").doc(job.id).create(clean({ ...job, area_plan: areas }));
    return job;
  }
  async updateSearchJob(id, updates) {
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.collection("search_jobs").doc(id);
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
  async addSearchAreas(areas) {
    const groups2 = /* @__PURE__ */ new Map();
    for (const area of areas) groups2.set(area.search_job_id, [...groups2.get(area.search_job_id) || [], area]);
    for (const [jobId, items] of groups2) await this.updateSearchJob(jobId, { area_plan: items });
  }
  async updateSearchArea(id, updates) {
    const jobs = await this.list("search_jobs");
    const job = jobs.find((item) => item.area_plan?.some((area) => area.id === id));
    if (!job) return void 0;
    const areas = (job.area_plan || []).map((area) => area.id === id ? clean({ ...area, ...updates, id }) : area);
    await this.updateSearchJob(job.id, { area_plan: areas });
    return areas.find((area) => area.id === id);
  }
  async logSearchQuery(query) {
    await this.store.collection("search_queries").doc(query.id).create(clean(query));
    return query;
  }
  async logSearchResult(result) {
    const id = result.id || crypto3.randomUUID();
    const item = clean({ ...result, id });
    await this.store.collection("search_results").doc(id).set(item);
    return item;
  }
  async getSettings() {
    const config = await this.get("settings", "config");
    const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || config?.googleMapsApiKey || "";
    return { ...defaults, ...config, googleMapsApiKey: key, hasCustomKey: Boolean(key) };
  }
  async updateSettings(updates) {
    const allowed = ["googleMapsApiKey", "maxResultsPerJob", "maxCitiesPerJob", "requestDelayMs", "scoringWeights"];
    await this.store.collection("settings").doc("config").set(clean(Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)))), { merge: true });
    return this.getSettings();
  }
};
var db = new Repository();

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

// src/lib/search/searchWorker.ts
import crypto4 from "node:crypto";

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
  const resolvedCity = fallbackCity && fallbackCity !== "all" ? fallbackCity : extracted.city || fallbackCity;
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

// src/lib/search/ratingFilter.ts
function matchesRatingRange(ratingValue, filters) {
  const minRating = filters.minRating || 0;
  const maxRating = filters.maxRating;
  if (minRating <= 0 && (maxRating === void 0 || maxRating === null)) {
    return true;
  }
  const rating = Number(ratingValue);
  if (!Number.isFinite(rating) || rating <= 0) {
    return false;
  }
  if (minRating > 0 && rating < minRating) {
    return false;
  }
  if (maxRating !== void 0 && maxRating !== null && rating > maxRating) {
    return false;
  }
  return true;
}

// src/lib/search/searchWorker.ts
var activeWorkers = /* @__PURE__ */ new Map();
async function createAndPrepareSearchJob(params) {
  const settings = await db.getSettings();
  let targetCities = [];
  if (params.city === "all") {
    const popular = POPULAR_CITIES_BY_STATE[params.state] || [];
    const ibgeCities = await fetchCitiesByState(params.state);
    const otherCities = ibgeCities.map((c) => c.nome).filter((nome) => !popular.includes(nome));
    const combined = [...popular, ...otherCities];
    if (settings.maxCitiesPerJob && settings.maxCitiesPerJob > 0) {
      targetCities = combined.slice(0, settings.maxCitiesPerJob);
    } else {
      targetCities = combined;
    }
    if (targetCities.length === 0) {
      targetCities = ["Capital"];
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
      const coords = CITY_COORDINATES[c];
      areas.push({
        id: `area_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        search_job_id: jobId,
        city: c,
        state: params.state,
        lat: coords ? coords.lat : 0,
        lng: coords ? coords.lng : 0,
        radius: coords ? 12e3 : 0,
        status: "pending",
        attempts: 0,
        places_found: 0
      });
    }
  }
  const workspaceId = params.freelancerId ? params.freelancerId : "admin";
  const newJob = {
    id: jobId,
    workspace_id: workspaceId,
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
  await db.createSearchJob(newJob, areas);
  return {
    job: newJob,
    estimatedQueries: areas.length,
    totalCities: targetCities.length,
    totalAreas: areas.length
  };
}
async function runSearchJob(jobId) {
  const job = await db.getSearchJob(jobId);
  if (!job) return;
  const leaseToken = crypto4.randomUUID();
  if (!await db.claimSearchJob(jobId, leaseToken)) return;
  const worker = {
    jobId,
    paused: false,
    cancelled: false
  };
  activeWorkers.set(jobId, worker);
  try {
    await db.updateSearchJob(jobId, {
      status: "running",
      started_at: job.started_at || (/* @__PURE__ */ new Date()).toISOString()
    });
    const areas = await db.getSearchAreas(jobId);
    const pendingAreas = areas.filter((a) => a.status === "pending" || a.status === "failed");
    const settings = await db.getSettings();
    const targetGoal = job.target_leads || 0;
    let persistedLeadCount = job.leads_created || 0;
    const citiesSeen = /* @__PURE__ */ new Set();
    for (const area of pendingAreas) {
      try {
        if (!await db.renewSearchJobLease(jobId, leaseToken)) return;
        if (targetGoal > 0) {
          const currentJobCheck = await db.getSearchJob(jobId);
          if (currentJobCheck && currentJobCheck.leads_created >= targetGoal) {
            break;
          }
        }
        const currentWorker = activeWorkers.get(jobId);
        if (!currentWorker || currentWorker.cancelled) {
          await db.updateSearchJob(jobId, { status: "cancelled" });
          return;
        }
        if (currentWorker.paused) {
          await db.updateSearchJob(jobId, { status: "paused" });
          return;
        }
        await db.updateSearchArea(area.id, {
          status: "processing",
          attempts: area.attempts + 1
        });
        const query = `${job.niche} em ${area.city} ${area.state}`;
        const startTime = Date.now();
        let rawPlaces = [];
        let queryError;
        const apiKey = settings.googleMapsApiKey || process.env.GOOGLE_MAPS_API_KEY || "";
        const hasRealCoords = area.lat !== 0 && area.lng !== 0;
        const res = await searchPlacesOfficial(
          query,
          apiKey,
          hasRealCoords ? {
            locationBias: {
              circle: {
                center: { latitude: area.lat, longitude: area.lng },
                radius: area.radius || 12e3
              }
            },
            maxResultCount: 20
          } : {
            maxResultCount: 20
          }
        );
        if (res.isQuotaExceeded) {
          await db.updateSearchArea(area.id, {
            status: "failed",
            error: res.error || "Limite de cota da Google Places API excedido."
          });
          const curJob = await db.getSearchJob(jobId);
          await db.updateSearchJob(jobId, {
            status: "failed",
            error_message: "Limite de cota da Google Places API excedido. A busca foi interrompida.",
            processed_search_areas: (curJob?.processed_search_areas || 0) + 1,
            finished_at: (/* @__PURE__ */ new Date()).toISOString()
          });
          return;
        } else if (res.error) {
          queryError = res.error;
        } else {
          rawPlaces = res.places;
        }
        const durationMs = Date.now() - startTime;
        await db.logSearchQuery({
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
        if (queryError) {
          await db.updateSearchArea(area.id, { status: "failed", error: queryError });
          const currentJob = await db.getSearchJob(jobId);
          if (currentJob) {
            await db.updateSearchJob(jobId, { processed_search_areas: currentJob.processed_search_areas + 1 });
          }
          continue;
        }
        let newPlacesFound = 0;
        let newWithoutWebsite = 0;
        let newLeadsCreated = 0;
        for (const raw of rawPlaces) {
          const normalizedPlace = normalizePlace(raw, area.city, area.state);
          const { isNew } = await db.upsertPlace(normalizedPlace);
          if (isNew) {
            newPlacesFound++;
          }
          if ((!normalizedPlace.website || normalizedPlace.website.trim() === "") && normalizedPlace.website_status === "no_website") {
            newWithoutWebsite++;
          }
          const isRelevant = isPlaceRelevantToNiche(normalizedPlace, job.niche);
          const matchesFilters = checkLeadFilters(normalizedPlace, job.filters);
          if (matchesFilters && isRelevant) {
            const { score } = calculateLeadScore(normalizedPlace, settings.scoringWeights);
            const workspaceId = job.workspace_id || (job.freelancer_id ? job.freelancer_id : "admin");
            const leadPrefix = job.freelancer_id ? `lead_${job.freelancer_id}_` : "lead_admin_";
            const leadId = `${leadPrefix}${normalizedPlace.place_id}`;
            if (await db.isLeadDeleted(leadId)) {
              await db.logSearchResult({
                job_id: jobId,
                workspace_id: workspaceId,
                place_id: normalizedPlace.place_id,
                result: "deleted",
                rating: normalizedPlace.rating || 0,
                reviews_count: normalizedPlace.reviews_count || 0,
                website: normalizedPlace.website || "",
                website_status: normalizedPlace.website_status,
                phone: normalizedPlace.phone || "",
                created_at: (/* @__PURE__ */ new Date()).toISOString()
              });
              continue;
            }
            const { lead: persistedLead, created, isDeleted } = await db.createLead({
              id: leadId,
              workspace_id: workspaceId,
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
            if (isDeleted) {
              continue;
            }
            await db.logSearchResult({
              job_id: jobId,
              workspace_id: workspaceId,
              place_id: normalizedPlace.place_id,
              lead_id: persistedLead.id,
              result: created ? "created" : "duplicate",
              rating: normalizedPlace.rating || 0,
              reviews_count: normalizedPlace.reviews_count || 0,
              website: normalizedPlace.website || "",
              website_status: normalizedPlace.website_status,
              phone: normalizedPlace.phone || "",
              created_at: (/* @__PURE__ */ new Date()).toISOString()
            });
            if (created) {
              newLeadsCreated++;
              persistedLeadCount++;
            }
            if (targetGoal > 0 && persistedLeadCount >= targetGoal) {
              break;
            }
          } else {
            await db.logSearchResult({
              job_id: jobId,
              workspace_id: job.workspace_id || job.freelancer_id || "admin",
              place_id: normalizedPlace.place_id,
              result: isRelevant ? "filtered" : "irrelevant",
              rating: normalizedPlace.rating || 0,
              reviews_count: normalizedPlace.reviews_count || 0,
              website: normalizedPlace.website || "",
              website_status: normalizedPlace.website_status,
              phone: normalizedPlace.phone || "",
              created_at: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
        }
        citiesSeen.add(area.city);
        await db.updateSearchArea(area.id, {
          status: "completed",
          places_found: rawPlaces.length,
          processed_at: (/* @__PURE__ */ new Date()).toISOString()
        });
        const updatedJob = await db.getSearchJob(jobId);
        if (updatedJob) {
          await db.updateSearchJob(jobId, {
            processed_search_areas: updatedJob.processed_search_areas + 1,
            processed_cities: citiesSeen.size,
            places_found: updatedJob.places_found + newPlacesFound,
            places_without_website: updatedJob.places_without_website + newWithoutWebsite,
            leads_created: updatedJob.leads_created + newLeadsCreated
          });
        }
        if (targetGoal > 0 && persistedLeadCount >= targetGoal) {
          break;
        }
        const delay = Math.max(300, settings.requestDelayMs || 600);
        await new Promise((r) => setTimeout(r, delay));
      } catch (areaErr) {
        console.warn(`[SearchWorker] Erro ao processar \xE1rea ${area.id}:`, areaErr);
        await db.updateSearchArea(area.id, {
          status: "failed",
          error: areaErr instanceof Error ? areaErr.message : String(areaErr)
        });
        const currentJob = await db.getSearchJob(jobId);
        if (currentJob) {
          await db.updateSearchJob(jobId, {
            processed_search_areas: currentJob.processed_search_areas + 1,
            processed_cities: citiesSeen.size
          });
        }
      }
    }
    const finalJob = await db.getSearchJob(jobId);
    if (finalJob && finalJob.status === "running") {
      const failedAreas = (await db.getSearchAreas(jobId)).filter((a) => a.status === "failed");
      const goalReached = (finalJob.target_leads || 0) > 0 && finalJob.leads_created >= (finalJob.target_leads || 0);
      await db.updateSearchJob(jobId, failedAreas.length > 0 && !goalReached ? { status: "failed", error_message: `${failedAreas.length} \xE1rea(s) falharam. Tente novamente para retomar.`, finished_at: (/* @__PURE__ */ new Date()).toISOString() } : { status: "completed", processed_search_areas: finalJob.total_search_areas, finished_at: (/* @__PURE__ */ new Date()).toISOString() });
    }
    if (job.freelancer_id) {
      const completedJob = await db.getSearchJob(jobId);
      await db.logActivity({
        freelancer_id: job.freelancer_id,
        freelancer_name: job.freelancer_name,
        action_type: "search_completed",
        description: `Busca finalizada: "${job.niche} em ${job.city}, ${job.state}" gerou ${completedJob?.leads_created || 0} novos leads`,
        metadata: { jobId, leads_created: completedJob?.leads_created || 0 }
      });
    }
  } catch (fatalErr) {
    console.error(`[SearchWorker] Erro fatal no job ${jobId}:`, fatalErr);
    await db.updateSearchJob(jobId, {
      status: "failed",
      error_message: fatalErr instanceof Error ? fatalErr.message : String(fatalErr),
      finished_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  } finally {
    await db.releaseSearchJobLease(jobId, leaseToken).catch(() => void 0);
    activeWorkers.delete(jobId);
  }
}
function checkLeadFilters(place, filters) {
  if (filters.onlyWithoutWebsite) {
    const hasAnyWebsite = Boolean(place.website && place.website.trim() !== "") || place.website_status !== "no_website";
    if (hasAnyWebsite) {
      return false;
    }
  }
  if (filters.onlyWithPhone && (!place.phone || place.phone.trim().length < 8)) {
    return false;
  }
  if (!matchesRatingRange(place.rating, filters)) {
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
async function pauseSearchJob(jobId) {
  const worker = activeWorkers.get(jobId);
  if (worker) {
    worker.paused = true;
    await db.updateSearchJob(jobId, { status: "paused" });
    return true;
  }
  await db.updateSearchJob(jobId, { status: "paused" });
  return true;
}
async function resumeSearchJob(jobId) {
  const job = await db.getSearchJob(jobId);
  if (!job) return false;
  const worker = activeWorkers.get(jobId);
  if (worker) {
    worker.paused = false;
  }
  const areas = await db.getSearchAreas(jobId);
  const retriedCount = areas.filter((a) => a.status === "failed").length;
  await db.updateSearchJob(jobId, {
    status: "running",
    error_message: void 0,
    processed_search_areas: Math.max(0, job.processed_search_areas - retriedCount)
  });
  for (const a of areas) {
    if (a.status === "failed" || a.status === "processing") {
      await db.updateSearchArea(a.id, { status: "pending", error: void 0 });
    }
  }
  runSearchJob(jobId).catch(console.error);
  return true;
}
async function cancelSearchJob(jobId) {
  const worker = activeWorkers.get(jobId);
  if (worker) {
    worker.cancelled = true;
  }
  await db.updateSearchJob(jobId, {
    status: "cancelled",
    finished_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  activeWorkers.delete(jobId);
  return true;
}
async function cleanupStaleJobs() {
  let cleaned = 0;
  try {
    const allJobs = await db.getAllSearchJobs();
    const now2 = Date.now();
    for (const job of allJobs) {
      if (job.status === "running") {
        const lastUpdated = job.updated_at ? new Date(job.updated_at).getTime() : 0;
        const isStale = now2 - lastUpdated > 12e4;
        if (!activeWorkers.has(job.id) && isStale) {
          await db.updateSearchJob(job.id, {
            status: "failed",
            error_message: "A execu\xE7\xE3o foi interrompida. Retome a busca para processar as \xE1reas restantes.",
            finished_at: (/* @__PURE__ */ new Date()).toISOString()
          });
          cleaned++;
          console.warn(`[SearchWorker] Busca interrompida detectada: ${job.id} (${job.niche})`);
        }
      }
    }
  } catch (err) {
    console.warn("[SearchWorker] Erro ao limpar jobs zumbis:", err);
  }
  return cleaned;
}

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
app.use((req, _res, next) => {
  const matchedPath = req.headers["x-matched-path"];
  const forwardedUri = req.headers["x-forwarded-uri"];
  const targetUri = forwardedUri && forwardedUri.startsWith("/api") ? forwardedUri : matchedPath && matchedPath.startsWith("/api") && !matchedPath.includes("index.js") ? matchedPath : void 0;
  if (targetUri) {
    req.url = targetUri;
  } else if (req.url.startsWith("/api/index.js")) {
    const queryIdx = req.url.indexOf("?");
    const queryString = queryIdx !== -1 ? req.url.substring(queryIdx) : "";
    req.url = "/api" + queryString;
  } else if (!req.url.startsWith("/api")) {
    req.url = `/api${req.url.startsWith("/") ? "" : "/"}${req.url}`;
  }
  next();
});
app.use("/api", async (req, _res, next) => {
  if (req.path === "" || req.path === "/" || req.path === "/health" || req.path.startsWith("/health/")) {
    return next();
  }
  try {
    await db.ensureInitialized();
  } catch (err) {
    console.error("[Server] Falha ao conectar ao Supabase:", err);
    return _res.status(503).json({ error: "Banco de dados temporariamente indispon\xEDvel. Tente novamente." });
  }
  next();
});
var ADMIN_DEFAULT_EMAIL = process.env.ADMIN_EMAIL || "";
var ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "";
var SESSION_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || "";
function signSession(payload) {
  if (SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET ou JWT_SECRET deve conter pelo menos 32 caracteres.");
  }
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto5.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  return `${data}.${signature}`;
}
function verifySession(token) {
  if (SESSION_SECRET.length < 32 || !token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, signature] = parts;
  const expectedSig = crypto5.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  if (signature.length !== expectedSig.length) return null;
  if (!crypto5.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (payload.exp && payload.exp < Date.now()) {
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
  if (!payload || await db.isSessionRevoked(token)) {
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
    return actorContext.run({ role: "admin" }, next);
  }
  if (payload.role === "freelancer") {
    let freelancer = await db.getFreelancerById(payload.freelancerId) || await db.getFreelancerByAccessCode(payload.accessCode);
    if (!freelancer) {
      try {
        await db.syncFromSupabase();
        freelancer = await db.getFreelancerById(payload.freelancerId) || await db.getFreelancerByAccessCode(payload.accessCode);
      } catch (syncErr) {
        console.warn("[Server] Falha ao consultar o Supabase na autentica\xE7\xE3o:", syncErr);
      }
    }
    if (!freelancer) {
      req.user = void 0;
      return next();
    }
    if (freelancer.status === "blocked") {
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
    await db.updateFreelancer(freelancer.id, { last_activity_at: (/* @__PURE__ */ new Date()).toISOString() });
    return actorContext.run({ role: "freelancer", freelancerId: freelancer.id }, next);
  }
  req.user = void 0;
  next();
});
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
app.get("/api", (_req, res) => {
  res.json({
    status: "ok",
    service: "ProspectaPlaces B2B Engine API",
    time: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.get("/api/health", async (_req, res) => {
  try {
    await db.ensureInitialized();
    const settings = await db.getSettings();
    const apiKey = settings?.googleMapsApiKey || process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || "";
    const isGooglePlacesConfigured = Boolean(apiKey && apiKey.trim().length > 10);
    return res.status(200).json({
      status: "ok",
      storage: "connected",
      googlePlacesConfigured: isGooglePlacesConfigured,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      platform: process.env.VERCEL ? "vercel" : "node"
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(503).json({
      status: "error",
      storage: "disconnected",
      googlePlacesConfigured: false,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      error: msg
    });
  }
});
app.get("/api/health/google-once", requireAdmin, async (_req, res) => {
  try {
    const settings = await db.getSettings();
    const apiKey = settings?.googleMapsApiKey || process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || "";
    let placesFound = 0;
    if (apiKey && apiKey.trim().length > 10) {
      try {
        const result = await searchPlacesOfficial("padaria", apiKey, { maxResultCount: 1 });
        if (result.places && result.places.length > 0) {
          placesFound = result.places.length;
        }
      } catch (placeErr) {
        console.warn("[Health] Erro ao testar Places na rota de health:", placeErr);
      }
    }
    return res.status(placesFound > 0 ? 200 : 503).json({
      status: "ok",
      placesFound,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (error) {
    return res.status(503).json({
      status: "error",
      placesFound: 0,
      error: error instanceof Error ? error.message : String(error),
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
});
app.post("/api/sync", requireAdmin, async (_req, res) => {
  try {
    const result = await db.syncFromSupabase();
    const stats = await db.getDashboardStats();
    res.json({
      success: true,
      message: "Conex\xE3o e leitura do Supabase confirmadas com sucesso!",
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
  if (!password) {
    return res.status(400).json({ error: "Senha \xE9 obrigat\xF3ria." });
  }
  const cleanPass = String(password).trim();
  const cleanEmail = String(email || ADMIN_DEFAULT_EMAIL).trim().toLowerCase();
  if (cleanPass === "Admin@2026!" || cleanPass === "admin") {
    return res.status(401).json({ error: "Credenciais de administrador inv\xE1lidas." });
  }
  const isValidPass = ADMIN_DEFAULT_PASSWORD.length >= 12 && cleanPass === ADMIN_DEFAULT_PASSWORD;
  const isValidEmail = Boolean(ADMIN_DEFAULT_EMAIL) && cleanEmail === ADMIN_DEFAULT_EMAIL.toLowerCase();
  if (!isValidPass || !isValidEmail) {
    return res.status(401).json({ error: "Credenciais de administrador inv\xE1lidas." });
  }
  const token = signSession({
    role: "admin",
    id: "admin_1",
    email: ADMIN_DEFAULT_EMAIL,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1e3
  });
  return res.json({
    success: true,
    user: {
      id: "admin_1",
      email: ADMIN_DEFAULT_EMAIL,
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
    await db.revokeSession(token);
  }
  res.json({ success: true });
});
app.post("/api/auth/login", (_req, res) => {
  return res.status(410).json({ error: "Rota desativada. Use /api/admin/login." });
});
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
app.post("/api/auth/logout", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (token) {
    if (verifySession(token)) await db.revokeSession(token);
  }
  res.json({ success: true });
});
app.post("/api/freelancer/auth/verify", async (req, res) => {
  const { accessCode, pin } = req.body;
  if (!accessCode) {
    return res.status(400).json({ error: "C\xF3digo de acesso do freelancer \xE9 obrigat\xF3rio." });
  }
  let freelancer = await db.getFreelancerByAccessCode(accessCode) || await db.getFreelancerById(accessCode);
  if (!freelancer) {
    try {
      await db.syncFromSupabase();
      freelancer = await db.getFreelancerByAccessCode(accessCode) || await db.getFreelancerById(accessCode);
    } catch (err) {
      console.warn("[Server] Falha ao consultar Supabase ao verificar c\xF3digo:", err);
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
    await db.revokeSession(token);
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
    res.status(500).json({ error: message });
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
    res.status(500).json({ error: message });
  }
});
app.get("/api/admin/freelancers", requireAdmin, async (_req, res) => {
  try {
    const freelancers = await db.getFreelancers();
    const enriched = await Promise.all(freelancers.map(async (f) => {
      const perf = await db.getFreelancerPerformance(f.id);
      return {
        ...f,
        performance: perf
      };
    }));
    res.json(enriched);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
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
    res.status(500).json({ error: message });
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
    res.status(500).json({ error: message });
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
    res.status(500).json({ error: message });
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
    res.status(500).json({ error: message });
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
    res.status(500).json({ error: message });
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
    res.status(500).json({ error: message });
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
      message: `O acesso ao workspace "${result.name || req.params.id}" foi desativado. Leads e hist\xF3ricos foram preservados; ${result.jobsRemoved} busca(s) ativa(s) foram canceladas.`,
      details: result
    });
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
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
    res.status(500).json({ error: message });
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
      supabaseDeletedCount: result.supabaseDeletedCount,
      message: `Opera\xE7\xE3o conclu\xEDda com sucesso: ${result.deletedCount} leads foram permanentemente removidos de todos os workspaces (Admin e Freelancers).`
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
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
        supabaseDeletedCount: result2.supabaseDeletedCount,
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
        supabaseDeletedCount: result2.supabaseDeletedCount,
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
        if (lead && !isLeadInWorkspace(lead, req.user.freelancerId)) {
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
    if (req.user.role === "freelancer" && !isLeadInWorkspace(lead, req.user.freelancerId)) {
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
    if (req.user.role === "freelancer" && !isLeadInWorkspace(lead, req.user.freelancerId)) {
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
    res.status(500).json({ error: message });
  }
});
app.get("/api/admin/freelancers/:id/searches", requireAdmin, async (req, res) => {
  try {
    const searches = await db.getAllSearchJobs(req.params.id);
    res.json(searches);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/admin/freelancers/:id/activities", requireAdmin, async (req, res) => {
  try {
    const result = await db.getActivities({ freelancer_id: req.params.id, limit: 100 });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
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
      maxRating,
      minReviews,
      maxReviews,
      minScore,
      status,
      search,
      sortBy,
      page,
      limit
    } = req.query;
    const scope = resolveWorkspaceScope(req);
    const result = await db.getLeads({
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
      maxRating: maxRating !== void 0 && maxRating !== "" ? Number(maxRating) : void 0,
      minReviews: minReviews ? Number(minReviews) : void 0,
      maxReviews: maxReviews ? Number(maxReviews) : void 0,
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
    if (req.user.role === "freelancer" && !isLeadInWorkspace(lead, req.user.freelancerId)) {
      return res.status(403).json({ error: "Acesso negado: este lead n\xE3o pertence ao seu workspace." });
    }
    const [notes, place] = await Promise.all([db.getLeadNotes(lead.id), db.getPlaceByPlaceId(lead.place_id)]);
    res.json({ lead, notes, place });
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: message });
  }
});
app.patch("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const oldLead = await db.getLeadById(req.params.id);
    if (!oldLead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !isLeadInWorkspace(oldLead, req.user.freelancerId)) {
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
    res.status(500).json({ error: message });
  }
});
app.post("/api/leads/:id/contact-attempt", requireAuth, async (req, res) => {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    if (req.user.role === "freelancer" && !isLeadInWorkspace(lead, req.user.freelancerId)) {
      return res.status(403).json({ error: "Acesso n\xE3o autorizado a este lead." });
    }
    const currentAttempts = lead.contact_attempts_count || (lead.contacted_at ? 1 : 0);
    const newStatus = lead.pipeline_status === "NOVO" || lead.pipeline_status === "PR\xC9VIA CRIADA" ? "CONTATADO" : lead.pipeline_status;
    const updated = await db.updateLead(lead.id, {
      contacted_at: (/* @__PURE__ */ new Date()).toISOString(),
      contact_attempts_count: currentAttempts + 1,
      pipeline_status: newStatus
    });
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
    res.status(500).json({ error: message });
  }
});
app.post("/api/leads/:id/register-sale", requireAuth, async (req, res) => {
  try {
    const { value } = req.body;
    const lead = await db.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    if (req.user.role === "freelancer" && !isLeadInWorkspace(lead, req.user.freelancerId)) {
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
    res.status(500).json({ error: message });
  }
});
app.post("/api/leads/:id/favorite", requireAuth, async (req, res) => {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !isLeadInWorkspace(lead, req.user.freelancerId)) {
      return res.status(403).json({ error: "Acesso negado: este lead pertence a outro workspace." });
    }
    const updated = await db.toggleFavoriteLead(req.params.id);
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/leads/:id/hide", requireAuth, async (req, res) => {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !isLeadInWorkspace(lead, req.user.freelancerId)) {
      return res.status(403).json({ error: "Acesso negado: este lead pertence a outro workspace." });
    }
    const explicitValue = typeof req.body?.is_hidden === "boolean" ? req.body.is_hidden : void 0;
    const updated = await db.toggleHideLead(req.params.id, explicitValue);
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
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
    if (req.user.role === "freelancer" && !isLeadInWorkspace(lead, req.user.freelancerId)) {
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
    res.status(500).json({ error: message });
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
    if (req.user.role === "freelancer" && !isLeadInWorkspace(lead, req.user.freelancerId)) {
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
    const updated = await db.updateLead(leadId, updates);
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
    res.status(500).json({ error: message });
  }
});
app.get("/api/search-jobs", requireAuth, async (req, res) => {
  try {
    await cleanupStaleJobs();
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
    const { state, city, niche, filters } = req.body;
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
    const minRatingValue = Number(filters?.minRating ?? 0);
    const hasMaxRating = filters?.maxRating !== void 0 && filters?.maxRating !== null && filters?.maxRating !== "";
    const maxRatingValue = hasMaxRating ? Number(filters.maxRating) : void 0;
    if (!Number.isFinite(minRatingValue) || minRatingValue < 0 || minRatingValue > 5 || maxRatingValue !== void 0 && (!Number.isFinite(maxRatingValue) || maxRatingValue <= 0 || maxRatingValue > 5 || maxRatingValue < minRatingValue)) {
      return res.status(400).json({ error: "Faixa de notas inv\xE1lida: a nota m\xE1xima deve ser maior ou igual \xE0 m\xEDnima, com valores entre 0 e 5." });
    }
    const minReviewsValue = Number(filters?.minReviews ?? 0);
    const maxReviewsValue = filters?.maxReviews !== void 0 && filters?.maxReviews !== null && filters?.maxReviews !== "" ? Number(filters.maxReviews) : void 0;
    const targetLeadsValue = filters?.targetLeads !== void 0 && filters?.targetLeads !== null && filters?.targetLeads !== "" ? Number(filters.targetLeads) : 0;
    if (!Number.isInteger(minReviewsValue) || minReviewsValue < 0 || maxReviewsValue !== void 0 && (!Number.isInteger(maxReviewsValue) || maxReviewsValue < minReviewsValue) || !Number.isInteger(targetLeadsValue) || targetLeadsValue < 0) {
      return res.status(400).json({ error: "Filtros de quantidade devem ser n\xFAmeros inteiros n\xE3o negativos; o m\xE1ximo de avalia\xE7\xF5es deve ser maior ou igual ao m\xEDnimo." });
    }
    const cleanFilters = {
      onlyWithoutWebsite: Boolean(filters?.onlyWithoutWebsite),
      onlyWithPhone: Boolean(filters?.onlyWithPhone),
      minRating: minRatingValue,
      minReviews: minReviewsValue,
      targetLeads: targetLeadsValue
    };
    if (maxRatingValue !== void 0) {
      cleanFilters.maxRating = maxRatingValue;
    }
    if (maxReviewsValue !== void 0) {
      cleanFilters.maxReviews = maxReviewsValue;
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
    runSearchJob(job.id).catch(console.error);
    res.json({ job, estimatedQueries, totalCities, totalAreas });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.get("/api/search-jobs/:id", requireAuth, async (req, res) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Search Job n\xE3o encontrado." });
    }
    if (req.user.role === "freelancer" && !isLeadInWorkspace(job, req.user.freelancerId)) {
      return res.status(403).json({ error: "Acesso negado: esta busca pertence a outro workspace." });
    }
    const [areas, queries] = await Promise.all([db.getSearchAreas(job.id), db.getSearchQueries(job.id)]);
    res.json({ job, areas, queries });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/search-jobs/:id/pause", requireAuth, async (req, res) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Search Job n\xE3o encontrado." });
    if (req.user.role === "freelancer" && !isLeadInWorkspace(job, req.user.freelancerId)) {
      return res.status(403).json({ error: "Acesso negado: esta busca pertence a outro workspace." });
    }
    const ok = await pauseSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/search-jobs/:id/resume", requireAuth, async (req, res) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Search Job n\xE3o encontrado." });
    if (req.user.role === "freelancer" && !isLeadInWorkspace(job, req.user.freelancerId)) {
      return res.status(403).json({ error: "Acesso negado: esta busca pertence a outro workspace." });
    }
    const ok = await resumeSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
app.post("/api/search-jobs/:id/cancel", requireAuth, async (req, res) => {
  try {
    const job = await db.getSearchJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Search Job n\xE3o encontrado." });
    if (req.user.role === "freelancer" && !isLeadInWorkspace(job, req.user.freelancerId)) {
      return res.status(403).json({ error: "Acesso negado: esta busca pertence a outro workspace." });
    }
    const ok = await cancelSearchJob(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
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
    res.status(500).json({ error: message });
  }
});
app.post("/api/settings", requireAdmin, async (req, res) => {
  try {
    const updates = req.body;
    if (updates.googleMapsApiKey && updates.googleMapsApiKey.includes("\u2022\u2022\u2022\u2022")) {
      delete updates.googleMapsApiKey;
    }
    const updated = await db.updateSettings(updates);
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
var recoveryTimer = setTimeout(async () => {
  try {
    await cleanupStaleJobs();
    const jobs = await db.getAllSearchJobs();
    for (const job of jobs) {
      if (job.status === "running") {
        const areas = await db.getSearchAreas(job.id);
        const hasPending = areas.some((a) => a.status === "pending" || a.status === "processing" || a.status === "failed");
        if (hasPending && areas.length > 0) {
          for (const a of areas) {
            if (a.status === "processing") {
              await db.updateSearchArea(a.id, { status: "pending" });
            }
          }
          console.log(`[Server] Retomando busca pendente ${job.id} (${job.niche} em ${job.city})...`);
          runSearchJob(job.id).catch(console.error);
        } else {
          await db.updateSearchJob(job.id, {
            status: "failed",
            error_message: "Busca interrompida durante a execu\xE7\xE3o. Retome para verificar as \xE1reas pendentes.",
            finished_at: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      }
    }
  } catch (err) {
    console.warn("[Server] Falha ao verificar jobs anteriores:", err);
  }
}, 2e3);
recoveryTimer.unref?.();
var app_default = app;

// src/server/serverless.ts
function handler(req, res) {
  return app_default(req, res);
}
export {
  app_default as app,
  handler as default
};
