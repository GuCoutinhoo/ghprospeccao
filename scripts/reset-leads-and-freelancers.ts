import fs from 'fs';
import path from 'path';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  writeBatch,
  doc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

async function resetAllLeadsAndFreelancers() {
  console.log('--- INICIANDO RESET GERAL DE LEADS E FREELANCERS ---');

  // 1. Reset no Firestore
  try {
    const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    const databaseId = firebaseConfig.firestoreDatabaseId || 'ai-studio-prospectaplacesb-a0f0acf2-92de-4dc6-84d3-27efdba900e9';
    const db = getFirestore(app, databaseId);

    console.log(`[Firestore] Conectado ao banco: ${databaseId}`);

    // Limpar 'leads'
    const leadsSnap = await getDocs(collection(db, 'leads')).catch((err) => {
      console.warn('[Firestore] Erro ao listar leads:', err.message);
      return null;
    });

    if (leadsSnap && !leadsSnap.empty) {
      console.log(`[Firestore] Encontrados ${leadsSnap.size} leads para exclusão.`);
      const docs = leadsSnap.docs;
      for (let i = 0; i < docs.length; i += 200) {
        const chunk = docs.slice(i, i + 200);
        const batch = writeBatch(db);
        for (const d of chunk) {
          batch.delete(d.ref);
        }
        await batch.commit();
        console.log(`[Firestore] Deletados ${Math.min(i + 200, docs.length)} / ${docs.length} leads.`);
      }
    } else {
      console.log('[Firestore] Nenhum lead para deletar na coleção leads.');
    }

    // Limpar 'deleted_leads'
    const delSnap = await getDocs(collection(db, 'deleted_leads')).catch(() => null);
    if (delSnap && !delSnap.empty) {
      console.log(`[Firestore] Encontrados ${delSnap.size} registros em deleted_leads.`);
      const docs = delSnap.docs;
      for (let i = 0; i < docs.length; i += 200) {
        const chunk = docs.slice(i, i + 200);
        const batch = writeBatch(db);
        for (const d of chunk) {
          batch.delete(d.ref);
        }
        await batch.commit();
      }
      console.log('[Firestore] Coleção deleted_leads limpa.');
    }

    // Limpar 'freelancers'
    const freeSnap = await getDocs(collection(db, 'freelancers')).catch((err) => {
      console.warn('[Firestore] Erro ao listar freelancers:', err.message);
      return null;
    });

    if (freeSnap && !freeSnap.empty) {
      console.log(`[Firestore] Encontrados ${freeSnap.size} freelancers para exclusão.`);
      const docs = freeSnap.docs;
      for (let i = 0; i < docs.length; i += 200) {
        const chunk = docs.slice(i, i + 200);
        const batch = writeBatch(db);
        for (const d of chunk) {
          batch.delete(d.ref);
        }
        await batch.commit();
      }
      console.log('[Firestore] Coleção freelancers limpa (0 freelancers).');
    } else {
      console.log('[Firestore] Nenhum freelancer cadastrado no Firestore.');
    }

    // Limpar 'activities'
    const actSnap = await getDocs(collection(db, 'activities')).catch(() => null);
    if (actSnap && !actSnap.empty) {
      console.log(`[Firestore] Encontradas ${actSnap.size} atividades de log para exclusão.`);
      const docs = actSnap.docs;
      for (let i = 0; i < docs.length; i += 200) {
        const chunk = docs.slice(i, i + 200);
        const batch = writeBatch(db);
        for (const d of chunk) {
          batch.delete(d.ref);
        }
        await batch.commit();
      }
      console.log('[Firestore] Coleção activities limpa.');
    }

  } catch (err: any) {
    console.warn('[Firestore] Aviso na comunicação com Firestore:', err.message);
  }

  // 2. Reset em .data/db.json
  const dbPath = path.resolve(process.cwd(), '.data', 'db.json');
  if (fs.existsSync(dbPath)) {
    try {
      const raw = fs.readFileSync(dbPath, 'utf8');
      const data = JSON.parse(raw);
      const prevLeadsCount = data.leads?.length || 0;
      const prevFreeCount = data.freelancers?.length || 0;

      // Zera leads, notas e freelancers mantendo places e settings intactos
      data.leads = [];
      data.lead_notes = [];
      data.deleted_lead_ids = [];
      data.freelancers = [];
      data.activities = [];

      // Desvincula eventuais referências de jobs a freelancers
      if (Array.isArray(data.search_jobs)) {
        for (const j of data.search_jobs) {
          delete j.freelancer_id;
          delete j.freelancer_name;
        }
      }

      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[Local db.json] Reset concluído com sucesso!`);
      console.log(`- Leads resetados: ${prevLeadsCount} -> 0`);
      console.log(`- Freelancers resetados: ${prevFreeCount} -> 0`);
      console.log(`- Places preservados: ${data.places?.length || 0}`);
    } catch (err: any) {
      console.error('[Local db.json] Erro ao atualizar db.json:', err);
    }
  }

  console.log('--- RESET FINALIZADO COM SUCESSO ---');
}

resetAllLeadsAndFreelancers()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
