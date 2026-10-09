import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  deleteDoc,
  Firestore,
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { Place, Lead, LeadNote, SearchJob, AppSettings, Freelancer, Activity } from '../../types';
import firebaseConfigJson from '../../../firebase-applet-config.json';

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
    dbInstance = getFirestore(app, databaseId);
    return dbInstance;
  } catch (err) {
    console.warn('[Firebase] Não foi possível inicializar Firestore:', err);
    return null;
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
    const [leadsSnap, placesSnap, jobsSnap, settingsSnap, freelancersSnap, activitiesSnap, deletedSnap] = await Promise.all([
      getDocs(collection(db, 'leads')).catch(() => null),
      getDocs(collection(db, 'places')).catch(() => null),
      getDocs(collection(db, 'search_jobs')).catch(() => null),
      getDoc(doc(db, 'settings', 'config')).catch(() => null),
      getDocs(collection(db, 'freelancers')).catch(() => null),
      getDocs(collection(db, 'activities')).catch(() => null),
      getDocs(collection(db, 'deleted_leads')).catch(() => null),
    ]);

    const deletedLeadIds = new Set<string>();
    if (deletedSnap) {
      deletedSnap.forEach((d) => deletedLeadIds.add(d.id));
    }

    const leads: Lead[] = [];
    if (leadsSnap) {
      leadsSnap.forEach((d) => {
        if (!deletedLeadIds.has(d.id)) {
          const l = d.data() as Lead;
          if (l && l.id && !deletedLeadIds.has(l.id)) {
            leads.push(l);
          }
        }
      });
    }

    const places: Place[] = [];
    if (placesSnap) {
      placesSnap.forEach((d) => places.push(d.data() as Place));
    }

    const jobs: SearchJob[] = [];
    if (jobsSnap) {
      jobsSnap.forEach((d) => jobs.push(d.data() as SearchJob));
    }

    const freelancers: Freelancer[] = [];
    if (freelancersSnap) {
      freelancersSnap.forEach((d) => freelancers.push(d.data() as Freelancer));
    }

    const activities: Activity[] = [];
    if (activitiesSnap) {
      activitiesSnap.forEach((d) => activities.push(d.data() as Activity));
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
    await setDoc(doc(db, 'leads', lead.id), cleanForFirestore(lead), { merge: true });
  } catch (err) {
    console.warn(`[Firebase] Erro ao sincronizar lead ${lead.id}:`, err);
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
      const deletePromises: Promise<void>[] = [];
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
          leadsDeleted++;
          const leadId = d.id;
          deletePromises.push(
            deleteDoc(d.ref).catch(() => {}),
            setDoc(doc(db, 'deleted_leads', leadId), {
              id: leadId,
              deleted_at: new Date().toISOString(),
            }).catch(() => {})
          );
        }
      });
      await Promise.all(deletePromises);
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
  if (!db || !id) return;
  try {
    await Promise.all([
      deleteDoc(doc(db, 'leads', id)).catch(() => {}),
      setDoc(doc(db, 'deleted_leads', id), {
        id,
        deleted_at: new Date().toISOString(),
      }).catch(() => {}),
    ]);
  } catch (err) {
    console.warn(`[Firebase] Erro ao deletar lead ${id} do Firestore:`, err);
  }
}

export async function deleteMultipleLeadsFromFirestore(ids: string[]): Promise<number> {
  const db = getFirestoreDb();
  if (!db || !ids || ids.length === 0) return 0;
  try {
    const promises = ids.map(async (id) => {
      await deleteDoc(doc(db, 'leads', id)).catch(() => {});
      await setDoc(doc(db, 'deleted_leads', id), {
        id,
        deleted_at: new Date().toISOString(),
      }).catch(() => {});
    });
    await Promise.all(promises);
    return ids.length;
  } catch (err) {
    console.warn('[Firebase] Erro ao deletar múltiplos leads do Firestore:', err);
    return 0;
  }
}

export async function deleteLeadsForTenantFromFirestore(targetFreelancerId?: string): Promise<number> {
  const db = getFirestoreDb();
  if (!db) return 0;
  try {
    const snap = await getDocs(collection(db, 'leads')).catch(() => null);
    if (!snap) return 0;
    let count = 0;
    const deletePromises: Promise<unknown>[] = [];

    const normTarget = targetFreelancerId ? targetFreelancerId.toLowerCase().trim() : '';
    const cleanTarget = normTarget.startsWith('free_') ? normTarget.substring(5) : normTarget;

    snap.forEach((d) => {
      const data = d.data() as Lead;
      const fid = (data.freelancer_id || '').toLowerCase().trim();
      const cleanFid = fid.startsWith('free_') ? fid.substring(5) : fid;
      const uid = (data.user_id || '').toLowerCase().trim();
      const cleanUid = uid.startsWith('free_') ? uid.substring(5) : uid;

      let shouldDelete = false;
      if (normTarget && normTarget !== 'all') {
        shouldDelete = Boolean(
          fid === normTarget ||
          cleanFid === cleanTarget ||
          (cleanTarget && fid === `free_${cleanTarget}`) ||
          uid === normTarget ||
          cleanUid === cleanTarget ||
          (cleanTarget && uid === `free_${cleanTarget}`)
        );
      } else if (!normTarget || normTarget === 'admin' || normTarget === 'administrador') {
        const hasFreelancer = Boolean(
          (fid && fid !== 'admin' && fid !== 'administrador') ||
          (uid && uid.startsWith('free_'))
        );
        shouldDelete = !hasFreelancer;
      }

      if (shouldDelete) {
        count++;
        const leadId = d.id;
        deletePromises.push(
          deleteDoc(d.ref).catch(() => {}),
          setDoc(doc(db, 'deleted_leads', leadId), {
            id: leadId,
            deleted_at: new Date().toISOString(),
          }).catch(() => {})
        );
      }
    });

    await Promise.all(deletePromises);
    return count;
  } catch (err) {
    console.warn('[Firebase] Erro ao deletar leads do tenant no Firestore:', err);
    return 0;
  }
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
