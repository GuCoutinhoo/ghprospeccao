import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  setLogLevel,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  deleteDoc,
  writeBatch,
  query,
  where,
  limit,
  orderBy,
  getCountFromServer,
  Firestore,
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { Place, Lead, LeadNote, SearchJob, SearchArea, AppSettings, Freelancer, Activity } from '../../types';
import firebaseConfigJson from '../../../firebase-applet-config.json';

try {
  setLogLevel('error');
} catch {}

let dbInstance: Firestore | null = null;

export function getFirestoreDb(): Firestore | null {
  if (dbInstance) return dbInstance;
  try {
    let config = firebaseConfigJson as Record<string, string>;
    if (!config || !config.projectId) {
      const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    }
    if (!config || !config.projectId) {
      console.warn('[Firebase] Configuração do Firebase não encontrada.');
      return null;
    }
    const app = !getApps().length ? initializeApp(config) : getApp();
    const databaseId =
      config.firestoreDatabaseId ||
      process.env.FIRESTORE_DATABASE_ID ||
      'ai-studio-prospectaplacesb-a0f0acf2-92de-4dc6-84d3-27efdba900e9';

    try {
      dbInstance = initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true,
        ignoreUndefinedProperties: true,
      }, databaseId);
    } catch {
      dbInstance = getFirestore(app, databaseId);
    }
    return dbInstance;
  } catch (err) {
    console.warn('[Firebase] Não foi possível inicializar Firestore:', err);
    return null;
  }
}

// --- DETECTORES DE ERRO DE COTA ---
export function isFirestoreQuotaError(err: unknown): boolean {
  if (!err) return false;
  const str = err instanceof Error ? err.message : String(err);
  return (
    str.includes('RESOURCE_EXHAUSTED') ||
    str.includes('Quota exceeded') ||
    str.includes('quota metric') ||
    str.includes('Free daily read units') ||
    (err as any)?.code === 'resource-exhausted'
  );
}

export function isGooglePlacesQuotaError(err: unknown): boolean {
  if (!err) return false;
  const str = err instanceof Error ? err.message : String(err);
  return (
    str.includes('OVER_QUERY_LIMIT') ||
    str.includes('RESOURCE_EXHAUSTED') ||
    str.includes('cota') ||
    str.includes('quota') ||
    str.includes('rate limit')
  );
}

// 1. CARREGAMENTO LEVE DE CONFIGURAÇÕES GLOBAIS (SEM SCAN DE LEADS)
export async function fetchGlobalConfigFromFirestore(): Promise<{
  settings?: AppSettings;
  freelancers: Freelancer[];
  deletedLeadIds: Set<string>;
  recentJobs: SearchJob[];
} | null> {
  const db = getFirestoreDb();
  if (!db) return null;

  try {
    const [settingsSnap, freelancersSnap, deletedSnap, jobsSnap] = await Promise.all([
      getDoc(doc(db, 'settings', 'config')).catch(() => null),
      getDocs(collection(db, 'freelancers')).catch(() => null),
      getDocs(query(collection(db, 'deleted_leads'), limit(500))).catch(() => null),
      getDocs(query(collection(db, 'search_jobs'), limit(50))).catch(() => null),
    ]);

    const deletedLeadIds = new Set<string>();
    if (deletedSnap) {
      deletedSnap.forEach((d) => deletedLeadIds.add(d.id));
    }

    const freelancers: Freelancer[] = [];
    if (freelancersSnap) {
      freelancersSnap.forEach((d) => {
        const f = d.data() as Freelancer;
        if (f && f.id) freelancers.push(f);
      });
    }

    const recentJobs: SearchJob[] = [];
    if (jobsSnap) {
      jobsSnap.forEach((d) => {
        const j = d.data() as SearchJob;
        if (j && j.id) recentJobs.push(j);
      });
    }

    const settings = settingsSnap && settingsSnap.exists()
      ? (settingsSnap.data() as AppSettings)
      : undefined;

    return { settings, freelancers, deletedLeadIds, recentJobs };
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      console.warn('[Firebase] COTA EXCEDIDA ao carregar configuração global:', err);
    } else {
      console.warn('[Firebase] Erro ao carregar configuração global do Firestore:', err);
    }
    return null;
  }
}

// 2. CONSULTAS DE LEADS INDEXADAS POR WORKSPACE COM LIMITE E PAGINAÇÃO
export async function fetchWorkspaceLeadsFromFirestore(
  workspaceId: string,
  limitCount = 0
): Promise<Lead[]> {
  const db = getFirestoreDb();
  if (!db) return [];

  const targetClean = (workspaceId || '').toLowerCase().trim().replace(/^free_/, '');
  const isTargetAdmin = !targetClean || targetClean === 'admin' || targetClean === 'administrador';

  try {
    let q;
    if (workspaceId === 'ALL') {
      q = collection(db, 'leads');
    } else if (isTargetAdmin) {
      q = limitCount > 0
        ? query(collection(db, 'leads'), where('workspace_id', '==', 'admin'), limit(limitCount))
        : query(collection(db, 'leads'), where('workspace_id', '==', 'admin'));
    } else {
      q = limitCount > 0
        ? query(collection(db, 'leads'), where('workspace_id', '==', workspaceId), limit(limitCount))
        : query(collection(db, 'leads'), where('workspace_id', '==', workspaceId));
    }

    const snap = await getDocs(q);
    const leads: Lead[] = [];
    snap.forEach((d) => {
      const l = d.data() as Lead;
      if (l && l.id) leads.push(l);
    });

    // Se freelancer não tiver workspace_id indexado, tenta por freelancer_id
    if (!isTargetAdmin && workspaceId !== 'ALL' && leads.length === 0) {
      const qAlt = limitCount > 0
        ? query(collection(db, 'leads'), where('freelancer_id', '==', workspaceId), limit(limitCount))
        : query(collection(db, 'leads'), where('freelancer_id', '==', workspaceId));
      const snapAlt = await getDocs(qAlt);
      snapAlt.forEach((d) => {
        const l = d.data() as Lead;
        if (l && l.id) leads.push(l);
      });
    }

    return leads;
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      console.error('[Firebase] COTA DO FIRESTORE EXCEDIDA ao buscar leads:', err);
      throw new Error('FIRESTORE_QUOTA_EXCEEDED: Limite de cota do Firestore atingido.');
    }
    console.warn(`[Firebase] Erro ao buscar leads indexados para ${workspaceId}:`, err);
    return [];
  }
}

// 3. AGREGAÇÕES SERVER-SIDE (0 DOCUMENT READS)
export async function countWorkspaceLeadsInFirestore(workspaceId: string): Promise<number> {
  const db = getFirestoreDb();
  if (!db) return 0;

  const targetClean = (workspaceId || '').toLowerCase().trim().replace(/^free_/, '');
  const isTargetAdmin = !targetClean || targetClean === 'admin' || targetClean === 'administrador';

  try {
    let q;
    if (isTargetAdmin) {
      q = query(collection(db, 'leads'), where('workspace_id', '==', 'admin'));
    } else {
      q = query(collection(db, 'leads'), where('workspace_id', '==', workspaceId));
    }
    const snap = await getCountFromServer(q);
    return snap.data().count;
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      console.warn('[Firebase] COTA DO FIRESTORE EXCEDIDA ao agregar contagem de leads:', err);
    }
    return 0;
  }
}

// 4. PERSISTÊNCIA DURÁVEL E LEITURA DE SEARCH AREAS
export async function syncSearchAreaToFirestore(area: SearchArea): Promise<void> {
  const db = getFirestoreDb();
  if (!db || !area.id) return;
  try {
    await setDoc(doc(db, 'search_areas', area.id), cleanForFirestore(area), { merge: true });
  } catch (err) {
    console.warn(`[Firebase] Erro ao sincronizar área ${area.id}:`, err);
  }
}

export async function syncSearchAreasToFirestore(areas: SearchArea[]): Promise<void> {
  const db = getFirestoreDb();
  if (!db || !areas || areas.length === 0) return;
  try {
    for (let i = 0; i < areas.length; i += 200) {
      const chunk = areas.slice(i, i + 200);
      const batch = writeBatch(db);
      for (const area of chunk) {
        if (!area || !area.id) continue;
        batch.set(doc(db, 'search_areas', area.id), cleanForFirestore(area), { merge: true });
      }
      await batch.commit();
    }
  } catch (err) {
    console.warn('[Firebase] Erro ao sincronizar lote de search_areas:', err);
  }
}

export async function fetchJobAreasFromFirestore(jobId: string): Promise<SearchArea[]> {
  const db = getFirestoreDb();
  if (!db || !jobId) return [];
  try {
    const q = query(collection(db, 'search_areas'), where('search_job_id', '==', jobId));
    const snap = await getDocs(q);
    const list: SearchArea[] = [];
    snap.forEach((d) => {
      const a = d.data() as SearchArea;
      if (a && a.id) list.push(a);
    });
    return list;
  } catch (err) {
    console.warn(`[Firebase] Erro ao buscar search_areas do job ${jobId}:`, err);
    return [];
  }
}

// 5. GRAVAÇÃO EM LOTE COM CONFIRMAÇÃO DE LEADS E PLACES
export async function batchSyncLeadsToFirestore(
  leads: Lead[]
): Promise<{ success: boolean; count: number; error?: string; quotaExceeded?: boolean }> {
  const db = getFirestoreDb();
  if (!db || !leads || leads.length === 0) {
    return { success: true, count: 0 };
  }

  try {
    for (let i = 0; i < leads.length; i += 200) {
      const chunk = leads.slice(i, i + 200);
      const batch = writeBatch(db);
      for (const lead of chunk) {
        if (!lead || !lead.id) continue;
        batch.set(doc(db, 'leads', lead.id), cleanForFirestore(lead), { merge: true });
      }
      await batch.commit();
    }
    return { success: true, count: leads.length };
  } catch (err) {
    const quota = isFirestoreQuotaError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Firebase] Erro no commit do batch de leads:', msg);
    return {
      success: false,
      count: 0,
      error: quota ? 'FIRESTORE_QUOTA_EXCEEDED: Limite de cota do Firestore atingido.' : msg,
      quotaExceeded: quota,
    };
  }
}

export async function batchSyncPlacesToFirestore(places: Place[]): Promise<void> {
  const db = getFirestoreDb();
  if (!db || !places || places.length === 0) return;
  try {
    for (let i = 0; i < places.length; i += 200) {
      const chunk = places.slice(i, i + 200);
      const batch = writeBatch(db);
      for (const place of chunk) {
        if (!place || !place.id) continue;
        batch.set(doc(db, 'places', place.id), cleanForFirestore(place), { merge: true });
      }
      await batch.commit();
    }
  } catch (err) {
    console.warn('[Firebase] Erro ao sincronizar batch de places:', err);
  }
}

export async function fetchAllFromFirestore(): Promise<{
  places: Place[];
  leads: Lead[];
  jobs: SearchJob[];
  settings?: AppSettings;
  freelancers?: Freelancer[];
  activities?: Activity[];
  deletedLeadIds: Set<string>;
} | null> {
  const db = getFirestoreDb();
  if (!db) return null;

  try {
    // Carrega configuração global e toda a base de dados sincronizada sem limites arbitrários
    const [settingsSnap, freelancersSnap, deletedSnap, jobsSnap, allLeadsSnap, placesSnap, activitiesSnap] = await Promise.all([
      getDoc(doc(db, 'settings', 'config')).catch(() => null),
      getDocs(collection(db, 'freelancers')).catch(() => null),
      getDocs(collection(db, 'deleted_leads')).catch(() => null),
      getDocs(collection(db, 'search_jobs')).catch(() => null),
      getDocs(collection(db, 'leads')).catch(() => null),
      getDocs(collection(db, 'places')).catch(() => null),
      getDocs(query(collection(db, 'activities'), limit(200))).catch(() => null),
    ]);

    const deletedLeadIds = new Set<string>();
    if (deletedSnap) {
      deletedSnap.forEach((d) => deletedLeadIds.add(d.id));
    }

    const leads: Lead[] = [];
    if (allLeadsSnap) {
      allLeadsSnap.forEach((d) => {
        if (!deletedLeadIds.has(d.id)) {
          const l = d.data() as Lead;
          if (l && l.id && !deletedLeadIds.has(l.id)) {
            // Garante consistência de workspace_id no lead
            if (!l.workspace_id) {
              l.workspace_id = l.freelancer_id || 'admin';
            }
            leads.push(l);
          }
        }
      });
    }

    const places: Place[] = [];
    if (placesSnap) {
      placesSnap.forEach((d) => {
        const p = d.data() as Place;
        if (p && p.id) places.push(p);
      });
    }

    const jobs: SearchJob[] = [];
    if (jobsSnap) {
      jobsSnap.forEach((d) => {
        const j = d.data() as SearchJob;
        if (j && j.id) jobs.push(j);
      });
    }

    const freelancers: Freelancer[] = [];
    if (freelancersSnap) {
      freelancersSnap.forEach((d) => {
        const f = d.data() as Freelancer;
        if (f && f.id) freelancers.push(f);
      });
    }

    const activities: Activity[] = [];
    if (activitiesSnap) {
      activitiesSnap.forEach((d) => {
        const a = d.data() as Activity;
        if (a && a.id) activities.push(a);
      });
    }

    const settings = settingsSnap && settingsSnap.exists()
      ? (settingsSnap.data() as AppSettings)
      : undefined;

    return { places, leads, jobs, settings, freelancers, activities, deletedLeadIds };
  } catch (err) {
    console.warn('[Firebase] Erro ao carregar dados do Firestore:', err);
    return null;
  }
}

function cleanForFirestore<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) {
    return data.map(cleanForFirestore) as unknown as T;
  }
  if (typeof data === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (v !== undefined) {
        clean[k] = cleanForFirestore(v);
      }
    }
    return clean as T;
  }
  return data;
}

export async function syncLeadToFirestore(lead: Lead): Promise<void> {
  const db = getFirestoreDb();
  if (!db || !lead.id) return;
  try {
    const cleanLead = { ...lead };
    if (!cleanLead.workspace_id) {
      cleanLead.workspace_id = cleanLead.freelancer_id || 'admin';
    }
    await setDoc(doc(db, 'leads', lead.id), cleanForFirestore(cleanLead), { merge: true });
    // Remove de deleted_leads caso tenha sido anteriormente marcado como deletado
    await deleteDoc(doc(db, 'deleted_leads', lead.id)).catch(() => {});
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      console.warn(`[Firebase] Cota excedida ao sincronizar lead ${lead.id}`);
    } else {
      console.warn(`[Firebase] Erro ao sincronizar lead ${lead.id}:`, err);
    }
  }
}

export async function syncPlaceToFirestore(place: Place): Promise<void> {
  const db = getFirestoreDb();
  if (!db || !place.id) return;
  try {
    await setDoc(doc(db, 'places', place.id), cleanForFirestore(place), { merge: true });
  } catch (err) {
    console.warn(`[Firebase] Erro ao sincronizar place ${place.id}:`, err);
  }
}

export async function syncJobToFirestore(job: SearchJob): Promise<void> {
  const db = getFirestoreDb();
  if (!db || !job.id) return;
  try {
    await setDoc(doc(db, 'search_jobs', job.id), cleanForFirestore(job), { merge: true });
  } catch (err) {
    console.warn(`[Firebase] Erro ao sincronizar job ${job.id}:`, err);
  }
}

export async function syncSettingsToFirestore(settings: AppSettings): Promise<void> {
  const db = getFirestoreDb();
  if (!db) return;
  try {
    await setDoc(doc(db, 'settings', 'config'), cleanForFirestore(settings), { merge: true });
  } catch (err) {
    console.warn('[Firebase] Erro ao salvar configurações no Firestore:', err);
  }
}

export async function syncFreelancerToFirestore(freelancer: Freelancer): Promise<void> {
  const db = getFirestoreDb();
  if (!db || !freelancer.id) return;
  try {
    await setDoc(doc(db, 'freelancers', freelancer.id), cleanForFirestore(freelancer), { merge: true });
  } catch (err) {
    console.warn(`[Firebase] Erro ao sincronizar freelancer ${freelancer.id}:`, err);
  }
}

export async function deleteFreelancerFromFirestore(id: string): Promise<void> {
  const db = getFirestoreDb();
  if (!db || !id) return;
  try {
    await deleteDoc(doc(db, 'freelancers', id));
  } catch (err) {
    console.warn(`[Firebase] Erro ao deletar freelancer ${id} do Firestore:`, err);
  }
}

export async function deleteFreelancerAndAllDataFromFirestore(
  freelancerId: string,
  accessCode?: string,
  name?: string
): Promise<{ leadsDeleted: number; jobsDeleted: number; activitiesDeleted: number }> {
  const db = getFirestoreDb();
  if (!db) return { leadsDeleted: 0, jobsDeleted: 0, activitiesDeleted: 0 };

  const rawIdentifiers = [
    freelancerId,
    accessCode,
    `free_${accessCode}`,
    freelancerId?.replace(/^free_/, ''),
    name,
    name?.toLowerCase(),
  ].filter(Boolean) as string[];

  const normIdentifiers = Array.from(
    new Set(rawIdentifiers.map((s) => s.toLowerCase().trim()))
  );

  let leadsDeleted = 0;
  let jobsDeleted = 0;
  let activitiesDeleted = 0;

  try {
    // 1. Exclui TODOS os leads vinculados a este freelancer no Firestore
    const leadsSnap = await getDocs(collection(db, 'leads')).catch(() => null);
    if (leadsSnap) {
      const matchedDocs: Array<{ ref: any; id: string }> = [];
      leadsSnap.forEach((d) => {
        const data = d.data();
        const fid = (data.freelancer_id || '').toLowerCase().trim();
        const uid = (data.user_id || '').toLowerCase().trim();
        const fname = (data.freelancer_name || '').toLowerCase().trim();
        const docId = d.id.toLowerCase();

        const matches =
          normIdentifiers.some((id) => fid === id || fid === `free_${id}` || (id.startsWith('free_') && fid === id.substring(5))) ||
          normIdentifiers.some((id) => uid === id || uid === `free_${id}` || (id.startsWith('free_') && uid === id.substring(5))) ||
          (name && fname === name.toLowerCase().trim()) ||
          (accessCode && docId.includes(accessCode.toLowerCase().trim()) && docId.startsWith('lead_'));

        if (matches) {
          matchedDocs.push({ ref: d.ref, id: d.id });
        }
      });

      leadsDeleted = matchedDocs.length;
      for (let i = 0; i < matchedDocs.length; i += 200) {
        const chunk = matchedDocs.slice(i, i + 200);
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.delete(item.ref);
          batch.set(doc(db, 'deleted_leads', item.id), {
            id: item.id,
            deleted_at: new Date().toISOString(),
          });
        }
        await batch.commit().catch((err) => {
          console.warn('[Firebase] Erro ao commitar batch de leads:', err);
        });
      }
    }

    // 2. Exclui buscas do freelancer no Firestore
    const jobsSnap = await getDocs(collection(db, 'search_jobs')).catch(() => null);
    if (jobsSnap) {
      const deletePromises: Promise<void>[] = [];
      jobsSnap.forEach((d) => {
        const data = d.data();
        const fid = (data.freelancer_id || '').toLowerCase().trim();
        if (normIdentifiers.some((id) => fid === id || fid === `free_${id}`)) {
          jobsDeleted++;
          deletePromises.push(deleteDoc(d.ref).catch(() => {}));
        }
      });
      await Promise.all(deletePromises);
    }

    // 3. Exclui atividades de auditoria do freelancer no Firestore
    const actSnap = await getDocs(collection(db, 'activities')).catch(() => null);
    if (actSnap) {
      const deletePromises: Promise<void>[] = [];
      actSnap.forEach((d) => {
        const data = d.data();
        const fid = (data.freelancer_id || '').toLowerCase().trim();
        const fname = (data.freelancer_name || '').toLowerCase().trim();
        if (
          normIdentifiers.some((id) => fid === id || fid === `free_${id}`) ||
          (name && fname === name.toLowerCase().trim())
        ) {
          activitiesDeleted++;
          deletePromises.push(deleteDoc(d.ref).catch(() => {}));
        }
      });
      await Promise.all(deletePromises);
    }

    // 4. Exclui o cadastro do freelancer na coleção freelancers
    const freePromises: Promise<void>[] = [];
    if (freelancerId) {
      freePromises.push(deleteDoc(doc(db, 'freelancers', freelancerId)).catch(() => {}));
      const cleanFid = freelancerId.replace(/^free_/, '');
      if (cleanFid !== freelancerId) {
        freePromises.push(deleteDoc(doc(db, 'freelancers', cleanFid)).catch(() => {}));
      }
    }
    if (accessCode) {
      freePromises.push(deleteDoc(doc(db, 'freelancers', accessCode)).catch(() => {}));
      freePromises.push(deleteDoc(doc(db, 'freelancers', `free_${accessCode}`)).catch(() => {}));
    }

    // Varre também coleção freelancers por nome ou código para não deixar nenhum documento duplicado
    const freeSnap = await getDocs(collection(db, 'freelancers')).catch(() => null);
    if (freeSnap) {
      freeSnap.forEach((d) => {
        const data = d.data();
        const dName = (data.name || '').toLowerCase().trim();
        const dCode = (data.access_code || '').toLowerCase().trim();
        if (
          (name && dName === name.toLowerCase().trim()) ||
          (accessCode && dCode === accessCode.toLowerCase().trim()) ||
          normIdentifiers.includes(d.id.toLowerCase())
        ) {
          freePromises.push(deleteDoc(d.ref).catch(() => {}));
        }
      });
    }

    await Promise.all(freePromises);
  } catch (err) {
    console.warn('[Firebase] Erro na exclusão completa do workspace:', err);
  }

  return { leadsDeleted, jobsDeleted, activitiesDeleted };
}

export async function deleteLeadFromFirestore(id: string): Promise<void> {
  const db = getFirestoreDb();
  if (!db) {
    throw new Error('Banco de dados Firestore não inicializado para exclusão.');
  }
  if (!id) return;

  const batch = writeBatch(db);
  batch.delete(doc(db, 'leads', id));
  batch.set(doc(db, 'deleted_leads', id), {
    id,
    deleted_at: new Date().toISOString(),
  });
  await batch.commit();

  // Verificação de segurança: confirmação de que o documento original foi removido
  const verificationSnap = await getDoc(doc(db, 'leads', id)).catch(() => null);
  if (verificationSnap && verificationSnap.exists()) {
    await deleteDoc(doc(db, 'leads', id));
  }
}

export async function deleteMultipleLeadsFromFirestore(ids: string[]): Promise<number> {
  const db = getFirestoreDb();
  if (!db || !ids || ids.length === 0) return 0;
  let confirmedCount = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const batch = writeBatch(db);
    for (const id of chunk) {
      batch.delete(doc(db, 'leads', id));
      batch.set(doc(db, 'deleted_leads', id), {
        id,
        deleted_at: new Date().toISOString(),
      });
    }
    await batch.commit();
    confirmedCount += chunk.length;
  }
  return confirmedCount;
}

export function isLeadInWorkspace(
  lead: { freelancer_id?: string | null; workspace_id?: string | null; user_id?: string | null },
  targetWorkspaceId?: string | null
): boolean {
  if (targetWorkspaceId === 'ALL') return true;

  const targetClean = (targetWorkspaceId || '').toLowerCase().trim().replace(/^free_/, '');
  const isTargetAdmin = !targetClean || targetClean === 'admin' || targetClean === 'administrador';

  const fid = (lead.freelancer_id || '').toLowerCase().trim();
  const wid = (lead.workspace_id || '').toLowerCase().trim();
  const uid = (lead.user_id || '').toLowerCase().trim();

  const cleanFid = fid.startsWith('free_') ? fid.substring(5) : fid;
  const cleanWid = wid.startsWith('free_') ? wid.substring(5) : wid;
  const cleanUid = uid.startsWith('free_') ? uid.substring(5) : uid;

  const isAdminFid = !cleanFid || cleanFid === 'admin' || cleanFid === 'administrador' || cleanFid.startsWith('admin_');
  const isAdminWid = !cleanWid || cleanWid === 'admin' || cleanWid === 'administrador' || cleanWid === 'default' || cleanWid.startsWith('admin_');
  const isAdminUid = !cleanUid || cleanUid === 'admin' || cleanUid === 'administrador' || cleanUid.startsWith('admin_') || cleanUid.startsWith('default_user');

  // Um lead pertence a um freelancer se tiver identificador explícito de freelancer
  const isLeadOwnedByFreelancer = !isAdminFid || (!isAdminWid && cleanWid !== '') || (uid.startsWith('free_') && !isAdminUid);

  if (isTargetAdmin) {
    // Para o workspace do Admin, o lead pertence ao admin se NÃO pertencer a nenhum freelancer
    return !isLeadOwnedByFreelancer;
  }

  // Para um workspace de freelancer específico:
  if (!isLeadOwnedByFreelancer) {
    return false;
  }

  const leadOwner = (!isAdminFid && cleanFid) ? cleanFid : ((!isAdminWid && cleanWid) ? cleanWid : cleanUid);
  return leadOwner === targetClean || cleanFid === targetClean || cleanWid === targetClean || cleanUid === targetClean;
}

export async function deleteLeadsForTenantFromFirestore(targetFreelancerId?: string): Promise<number> {
  const db = getFirestoreDb();
  if (!db) {
    throw new Error('Banco de dados Firestore indisponível para exclusão de leads do workspace.');
  }

  const snap = await getDocs(collection(db, 'leads'));
  if (!snap) return 0;
  const matchedDocs: Array<{ ref: any; id: string }> = [];

  snap.forEach((d) => {
    const data = d.data() as Lead;
    if (isLeadInWorkspace(data, targetFreelancerId)) {
      matchedDocs.push({ ref: d.ref, id: d.id });
    }
  });

  let confirmedCount = 0;
  for (let i = 0; i < matchedDocs.length; i += 200) {
    const chunk = matchedDocs.slice(i, i + 200);
    const batch = writeBatch(db);
    for (const item of chunk) {
      batch.delete(item.ref);
      batch.set(doc(db, 'deleted_leads', item.id), {
        id: item.id,
        deleted_at: new Date().toISOString(),
      });
    }
    await batch.commit();
    confirmedCount += chunk.length;
  }

  return confirmedCount;
}

export async function deleteJobFromFirestore(id: string): Promise<void> {
  const db = getFirestoreDb();
  if (!db || !id) return;
  try {
    await deleteDoc(doc(db, 'search_jobs', id));
  } catch (err) {
    console.warn(`[Firebase] Erro ao deletar job ${id} do Firestore:`, err);
  }
}

export async function deleteActivityFromFirestore(id: string): Promise<void> {
  const db = getFirestoreDb();
  if (!db || !id) return;
  try {
    await deleteDoc(doc(db, 'activities', id));
  } catch (err) {
    console.warn(`[Firebase] Erro ao deletar atividade ${id} do Firestore:`, err);
  }
}

export async function syncActivityToFirestore(activity: Activity): Promise<void> {
  const db = getFirestoreDb();
  if (!db || !activity.id) return;
  try {
    await setDoc(doc(db, 'activities', activity.id), cleanForFirestore(activity), { merge: true });
  } catch (err) {
    console.warn(`[Firebase] Erro ao sincronizar atividade ${activity.id}:`, err);
  }
}

export async function purgeAllLeadsFromFirestore(knownIds: string[] = []): Promise<number> {
  const db = getFirestoreDb();
  if (!db) {
    throw new Error('Banco de dados Firestore indisponível para exclusão global de leads.');
  }

  const idsSet = new Set<string>(knownIds.filter(Boolean));

  // Tenta varrer coleção 'leads' caso haja cota de leitura disponível
  try {
    const snap = await getDocs(collection(db, 'leads'));
    if (snap) {
      snap.forEach((d) => idsSet.add(d.id));
    }
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      console.warn('[Firebase] Cota de leitura atingida ao listar leads. Prosseguindo com exclusão em lote dos IDs mapeados...');
    } else {
      console.warn('[Firebase] Aviso ao listar coleção leads:', err);
    }
  }

  // Tenta varrer coleção 'deleted_leads'
  try {
    const delSnap = await getDocs(collection(db, 'deleted_leads'));
    if (delSnap) {
      delSnap.forEach((d) => idsSet.add(d.id));
    }
  } catch {}

  const allIds = Array.from(idsSet);
  if (allIds.length === 0) return 0;

  let deletedCount = 0;
  // 1. Exclui permanentemente todos os leads da coleção 'leads' em lotes de 200
  for (let i = 0; i < allIds.length; i += 200) {
    const chunk = allIds.slice(i, i + 200);
    const batch = writeBatch(db);
    for (const id of chunk) {
      batch.delete(doc(db, 'leads', id));
    }
    await batch.commit();
    deletedCount += chunk.length;
  }

  // 2. Limpa todos os registros da coleção 'deleted_leads' em lotes de 200
  for (let i = 0; i < allIds.length; i += 200) {
    const chunk = allIds.slice(i, i + 200);
    const batch = writeBatch(db);
    for (const id of chunk) {
      batch.delete(doc(db, 'deleted_leads', id));
    }
    try {
      await batch.commit();
    } catch (delErr) {
      console.warn('[Firebase] Aviso ao limpar deleted_leads:', delErr);
    }
  }

  return deletedCount;
}

