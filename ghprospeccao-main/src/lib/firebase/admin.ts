import { getSupabaseFirestoreAdapter } from '../supabase/firestoreAdapter';
import { shouldUseSupabase } from '../supabase/admin';
import 'dotenv/config';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
let instance: Firestore | undefined;
export function getServerFirestore(): Firestore {
  if (shouldUseSupabase()) return getSupabaseFirestoreAdapter();
  if (instance) return instance;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (process.env.NODE_ENV === 'test' && (!emulator || !projectId?.startsWith('demo-'))) throw new Error('Tests require a demo project and Firestore emulator.');
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID must be configured.');
  if (emulator && !/^(127\.0\.0\.1|localhost):\d+$/.test(emulator)) throw new Error('Emulator must be local.');
  const credentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const app = getApps()[0] || initializeApp({ projectId, ...(emulator ? {} : { credential: credentials ? cert(JSON.parse(credentials)) : applicationDefault() }) });
  instance = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || '(default)');
  instance.settings({ ignoreUndefinedProperties: true });
  return instance;
}
export function storageErrorCode(error: unknown): string {
  const message=error instanceof Error ? error.message : String(error||'');
  if (/PGRST003|Timed out acquiring connection from connection pool/i.test(message)) return 'STORAGE_POOL_TIMEOUT';
  const code = (error as {code?: string | number})?.code;
  return ({7:'PERMISSION_DENIED',8:'QUOTA_EXCEEDED',4:'DEADLINE_EXCEEDED',14:'UNAVAILABLE'} as Record<string,string>)[String(code)] || 'STORAGE_FAILURE';
}
