import { getFirestoreDb } from '../src/lib/firebase/sync';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

async function resetLeadsAndFreelancers() {
  console.log('--- INICIANDO RESET DE LEADS E LISTA DE FREELANCERS ---');

  // 1. Limpeza no Firestore
  const db = getFirestoreDb();
  if (db) {
    console.log('[Firestore] Conectado ao Firestore. Excluindo coleções...');

    // a) Collection: leads
    try {
      const leadsSnap = await getDocs(collection(db, 'leads'));
      console.log(`[Firestore] Encontrados ${leadsSnap.size} documentos na coleção 'leads'`);
      if (leadsSnap.size > 0) {
        const docs = leadsSnap.docs;
        for (let i = 0; i < docs.length; i += 200) {
          const chunk = docs.slice(i, i + 200);
          const batch = writeBatch(db);
          for (const d of chunk) {
            batch.delete(d.ref);
          }
          await batch.commit();
        }
        console.log(`[Firestore] ${leadsSnap.size} leads excluídos com sucesso.`);
      }
    } catch (err) {
      console.warn('[Firestore] Erro ao limpar coleção leads:', err);
    }

    // b) Collection: deleted_leads
    try {
      const delSnap = await getDocs(collection(db, 'deleted_leads'));
      console.log(`[Firestore] Encontrados ${delSnap.size} documentos na coleção 'deleted_leads'`);
      if (delSnap.size > 0) {
        const docs = delSnap.docs;
        for (let i = 0; i < docs.length; i += 200) {
          const chunk = docs.slice(i, i + 200);
          const batch = writeBatch(db);
          for (const d of chunk) {
            batch.delete(d.ref);
          }
          await batch.commit();
        }
        console.log(`[Firestore] ${delSnap.size} registros em deleted_leads limpos com sucesso.`);
      }
    } catch (err) {
      console.warn('[Firestore] Erro ao limpar coleção deleted_leads:', err);
    }

    // c) Collection: freelancers
    try {
      const freeSnap = await getDocs(collection(db, 'freelancers'));
      console.log(`[Firestore] Encontrados ${freeSnap.size} documentos na coleção 'freelancers'`);
      if (freeSnap.size > 0) {
        const docs = freeSnap.docs;
        for (let i = 0; i < docs.length; i += 200) {
          const chunk = docs.slice(i, i + 200);
          const batch = writeBatch(db);
          for (const d of chunk) {
            batch.delete(d.ref);
          }
          await batch.commit();
        }
        console.log(`[Firestore] ${freeSnap.size} freelancers excluídos com sucesso. Lista zerada.`);
      }
    } catch (err) {
      console.warn('[Firestore] Erro ao limpar coleção freelancers:', err);
    }

    // d) Collection: activities
    try {
      const actSnap = await getDocs(collection(db, 'activities'));
      console.log(`[Firestore] Encontrados ${actSnap.size} documentos na coleção 'activities'`);
      if (actSnap.size > 0) {
        const docs = actSnap.docs;
        for (let i = 0; i < docs.length; i += 200) {
          const chunk = docs.slice(i, i + 200);
          const batch = writeBatch(db);
          for (const d of chunk) {
            batch.delete(d.ref);
          }
          await batch.commit();
        }
        console.log(`[Firestore] ${actSnap.size} atividades limpas com sucesso.`);
      }
    } catch (err) {
      console.warn('[Firestore] Erro ao limpar coleção activities:', err);
    }
  } else {
    console.warn('[Firestore] Instância do Firestore não disponível.');
  }

  // 2. Limpeza no arquivo local .data/db.json
  const dbPath = path.resolve(process.cwd(), '.data', 'db.json');
  if (fs.existsSync(dbPath)) {
    console.log(`[Local DB] Lendo ${dbPath}...`);
    const raw = fs.readFileSync(dbPath, 'utf8');
    const localDb = JSON.parse(raw);

    const prevLeads = localDb.leads?.length || 0;
    const prevFreelancers = localDb.freelancers?.length || 0;
    const prevActivities = localDb.activities?.length || 0;
    const prevPlaces = localDb.places?.length || 0;
    const prevJobs = localDb.search_jobs?.length || 0;

    console.log(`[Local DB] Estado anterior:`, {
      leads: prevLeads,
      freelancers: prevFreelancers,
      activities: prevActivities,
      places: prevPlaces,
      jobs: prevJobs,
    });

    // Reset leads e notas mantendo toda a estrutura intacta
    localDb.leads = [];
    localDb.lead_notes = [];
    localDb.deleted_lead_ids = [];

    // Reset freelancers: lista sem ninguém
    localDb.freelancers = [];
    localDb.activities = [];

    // Limpar referências de freelancer em search_jobs sem remover os jobs estruturais
    if (Array.isArray(localDb.search_jobs)) {
      for (const job of localDb.search_jobs) {
        delete job.freelancer_id;
        delete job.freelancer_name;
        if (job.status === 'running' || job.status === 'paused') {
          job.status = 'cancelled';
        }
      }
    }

    fs.writeFileSync(dbPath, JSON.stringify(localDb, null, 2), 'utf8');

    console.log(`[Local DB] Salvo com sucesso! Novo estado:`, {
      leads: localDb.leads.length,
      freelancers: localDb.freelancers.length,
      activities: localDb.activities.length,
      places: localDb.places?.length,
      jobs: localDb.search_jobs?.length,
    });
  }

  console.log('--- RESET FINALIZADO COM SUCESSO ---');
}

resetLeadsAndFreelancers()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Erro fatal no reset:', err);
    process.exit(1);
  });
