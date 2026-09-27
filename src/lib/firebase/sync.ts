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
import { Place, Lead, LeadNote, SearchJob, AppSettings } from '../../types';
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
} | null> {
  const db = getFirestoreDb();
  if (!db) return null;

  try {
    const [leadsSnap, placesSnap, jobsSnap, settingsSnap] = await Promise.all([
      getDocs(collection(db, 'leads')).catch(() => null),
      getDocs(collection(db, 'places')).catch(() => null),
      getDocs(collection(db, 'search_jobs')).catch(() => null),
      getDoc(doc(db, 'settings', 'config')).catch(() => null),
    ]);

    const leads: Lead[] = [];
    if (leadsSnap) {
      leadsSnap.forEach((d) => leads.push(d.data() as Lead));
    }

    const places: Place[] = [];
    if (placesSnap) {
      placesSnap.forEach((d) => places.push(d.data() as Place));
    }

    const jobs: SearchJob[] = [];
    if (jobsSnap) {
      jobsSnap.forEach((d) => jobs.push(d.data() as SearchJob));
    }

    const settings = settingsSnap && settingsSnap.exists()
      ? (settingsSnap.data() as AppSettings)
      : undefined;

    return { places, leads, jobs, settings };
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
