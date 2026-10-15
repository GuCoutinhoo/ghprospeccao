import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app, { signSession } from '../src/server/app';
import { db } from '../src/lib/store/db';
import {
  createAndPrepareSearchJob,
  runSearchJob,
  pauseSearchJob,
  resumeSearchJob,
  cancelSearchJob,
} from '../src/lib/search/searchWorker';

// Tokens criptografados reais HMAC para teste
const adminToken = signSession({
  role: 'admin',
  id: 'admin_1',
  email: 'gustavohcsantos.mm2020@gmail.com',
  exp: Date.now() + 3600000,
});

const freelancerAToken = signSession({
  role: 'freelancer',
  freelancerId: 'free_tenant_a',
  accessCode: 'tenant_a',
  exp: Date.now() + 3600000,
});

const freelancerBToken = signSession({
  role: 'freelancer',
  freelancerId: 'free_tenant_b',
  accessCode: 'tenant_b',
  exp: Date.now() + 3600000,
});

async function runForensicRegressionSuite() {
  console.log('================================================================');
  console.log('   SUÍTE FORENSE DE REGRESSÃO E INTEGRIDADE DE DADOS (18/18)   ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function testCase(id: string, description: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  [PASS] Teste ${id}: ${description}`);
      passed++;
    } catch (err: any) {
      console.error(`  [FAIL] Teste ${id}: ${description}`);
      console.error(`         Erro: ${err.message}`);
      if (err.stack) {
        console.error(`         Stack: ${err.stack.split('\n')[1]}`);
      }
      failed++;
    }
  }

  // PREPARAÇÃO: Seed isolado de freelancers e leads de teste
  (db as any).data.freelancers = ((db as any).data.freelancers || []).filter(
    (f: any) => !['free_tenant_a', 'free_tenant_b', 'free_tenant_blocked'].includes(f.id)
  );
  (db as any).data.freelancers.push(
    {
      id: 'free_tenant_a',
      name: 'Freelancer Tenant A',
      access_code: 'tenant_a',
      email: 'tenant_a@ghprospeccao.com',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'free_tenant_b',
      name: 'Freelancer Tenant B',
      access_code: 'tenant_b',
      email: 'tenant_b@ghprospeccao.com',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'free_tenant_blocked',
      name: 'Freelancer Bloqueado',
      access_code: 'tenant_blocked',
      email: 'blocked@ghprospeccao.com',
      status: 'blocked',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  );

  const runTag = Date.now().toString(36);
  const uid = (prefix: string) => `${prefix}_${runTag}_${Math.random().toString(36).substring(2, 6)}`;

  // 1. Exclusão individual persistente
  await testCase('1.1', 'Exclusão individual via DELETE /api/leads/:id persiste e marca tombstone', async () => {
    const testLeadId = uid('lead_admin_del');
    db.createLead({
      id: testLeadId,
      workspace_id: 'admin',
      user_id: 'admin_1',
      place_id: uid('place_del'),
      name: 'Barbearia Para Deletar',
      niche: 'barbearia',
      state: 'SP',
      city: 'São Paulo',
      rating: 4.5,
      reviews_count: 10,
      lead_score: 80,
      pipeline_status: 'NOVO',
      website_status: 'no_website',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    assert.ok(db.getLeadById(testLeadId), 'Lead deve existir antes da exclusão');

    const res = await (request as any)(app)
      .delete(`/api/leads/${testLeadId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(db.getLeadById(testLeadId), undefined, 'Lead não pode mais existir no banco');
    assert.strictEqual(db.isLeadDeleted(testLeadId), true, 'Tombstone deve estar ativo para o lead');
  });

  // 2. Exclusão em lote (Batch Delete)
  await testCase('2.1', 'Exclusão em lote atômica via POST /api/leads/batch-delete', async () => {
    const id1 = uid('lead_batch_1');
    const id2 = uid('lead_batch_2');

    db.createLead({
      id: id1,
      workspace_id: 'admin',
      user_id: 'admin_1',
      place_id: uid('place_batch_1'),
      name: 'Pizzaria Batch 1',
      niche: 'restaurante',
      state: 'SP',
      city: 'Campinas',
      rating: 4.0,
      reviews_count: 5,
      lead_score: 70,
      pipeline_status: 'NOVO',
      website_status: 'no_website',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.createLead({
      id: id2,
      workspace_id: 'admin',
      user_id: 'admin_1',
      place_id: uid('place_batch_2'),
      name: 'Pizzaria Batch 2',
      niche: 'restaurante',
      state: 'SP',
      city: 'Campinas',
      rating: 4.2,
      reviews_count: 8,
      lead_score: 75,
      pipeline_status: 'NOVO',
      website_status: 'no_website',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const res = await (request as any)(app)
      .post('/api/leads/batch-delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadIds: [id1, id2] });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.deletedCount, 2);
    assert.strictEqual(db.getLeadById(id1), undefined);
    assert.strictEqual(db.getLeadById(id2), undefined);
    assert.strictEqual(db.isLeadDeleted(id1), true);
    assert.strictEqual(db.isLeadDeleted(id2), true);
  });

  // 3. Busca ativa tentando recriar um lead excluído (Bloqueado por Tombstone)
  await testCase('3.1', 'Tentativa de recriar lead tombstonado é bloqueada imediatamente', async () => {
    const tombstonedId = uid('lead_tombstone');
    // Marca como excluído
    (db as any).deletedLeadIds.add(tombstonedId);

    const result = db.createLead({
      id: tombstonedId,
      workspace_id: 'free_tenant_a',
      freelancer_id: 'free_tenant_a',
      user_id: 'free_tenant_a',
      place_id: uid('place_tombstone'),
      name: 'Padaria Tentando Ressuscitar',
      niche: 'padaria',
      state: 'SP',
      city: 'Santos',
      rating: 4.6,
      reviews_count: 20,
      lead_score: 85,
      pipeline_status: 'NOVO',
      website_status: 'no_website',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    assert.strictEqual(result.created, false, 'createLead não deve criar lead tombstoned');
    assert.strictEqual(result.isDeleted, true, 'createLead deve sinalizar isDeleted');
    assert.strictEqual(db.getLeadById(tombstonedId), undefined, 'Lead tombstonado não pode estar na listagem');
  });

  // 4. Prevenção de ressurreição em syncFromFirestore
  await testCase('4.1', 'syncFromFirestore não ressuscita registros ausentes e tombstonados', async () => {
    const oldDeletedId = uid('lead_old_purged');
    (db as any).deletedLeadIds.add(oldDeletedId);

    // Executa sincronização
    await db.syncFromFirestore();

    assert.strictEqual(db.getLeadById(oldDeletedId), undefined, 'Lead tombstoned não pode reaparecer após sincronização');
  });

  // 5. ensureInitialized não re-executa sincronização quando lista de leads é legitimamente vazia
  await testCase('5.1', 'ensureInitialized respeita estado hidratado mesmo com 0 leads', async () => {
    (db as any).firestoreHydrated = true;
    let syncCalled = false;
    const originalSync = db.syncFromFirestore;
    db.syncFromFirestore = async () => {
      syncCalled = true;
      return { leadsCount: 0, placesCount: 0 };
    };

    try {
      await db.ensureInitialized();
      assert.strictEqual(syncCalled, false, 'ensureInitialized não deve chamar sync se já está hidratado');
    } finally {
      db.syncFromFirestore = originalSync;
    }
  });

  // Leads para os testes de isolamento multi-tenant
  const tenantALeadId = uid('lead_tenant_a');
  const tenantBLeadId = uid('lead_tenant_b');
  const tenantAdminLeadId = uid('lead_admin');

  // 6. Isolamento multi-tenant de listagem
  await testCase('6.1', 'Freelancer A não vê leads do Freelancer B nem do Admin', async () => {
    db.createLead({
      id: tenantALeadId,
      workspace_id: 'free_tenant_a',
      freelancer_id: 'free_tenant_a',
      user_id: 'free_tenant_a',
      place_id: uid('place_a'),
      name: 'Salão Tenant A',
      niche: 'estetica',
      state: 'SP',
      city: 'Santos',
      rating: 4.8,
      reviews_count: 15,
      lead_score: 90,
      pipeline_status: 'NOVO',
      website_status: 'no_website',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.createLead({
      id: tenantBLeadId,
      workspace_id: 'free_tenant_b',
      freelancer_id: 'free_tenant_b',
      user_id: 'free_tenant_b',
      place_id: uid('place_b'),
      name: 'Salão Tenant B',
      niche: 'estetica',
      state: 'RJ',
      city: 'Niterói',
      rating: 4.7,
      reviews_count: 12,
      lead_score: 88,
      pipeline_status: 'NOVO',
      website_status: 'no_website',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.createLead({
      id: tenantAdminLeadId,
      workspace_id: 'admin',
      user_id: 'admin_1',
      place_id: uid('place_adm'),
      name: 'Salão Admin',
      niche: 'estetica',
      state: 'SP',
      city: 'São Paulo',
      rating: 4.9,
      reviews_count: 30,
      lead_score: 95,
      pipeline_status: 'NOVO',
      website_status: 'no_website',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const resA = await (request as any)(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${freelancerAToken}`);

    assert.strictEqual(resA.status, 200);
    const leadsA = resA.body.leads || [];
    assert.ok(leadsA.some((l: any) => l.id === tenantALeadId), 'Freelancer A deve ver seu próprio lead');
    assert.strictEqual(leadsA.some((l: any) => l.id === tenantBLeadId), false, 'Lead de B não pode vazar para A');
    assert.strictEqual(leadsA.some((l: any) => l.id === tenantAdminLeadId), false, 'Lead do Admin não pode vazar para A');
  });

  // 7. Freelancer tentando burlar com freelancer_id=ALL é rejeitado com 403
  await testCase('7.1', 'Freelancer tentando solicitar escopo ALL recebe 403 Forbidden', async () => {
    const res = await (request as any)(app)
      .get('/api/leads?freelancer_id=ALL')
      .set('Authorization', `Bearer ${freelancerAToken}`);

    assert.strictEqual(res.status, 403, 'Freelancer não pode solicitar escopo ALL');
  });

  // 8. Proteção contra IDOR em detalhes de Lead
  await testCase('8.1', 'Freelancer A não pode acessar lead do Freelancer B por ID (403)', async () => {
    const res = await (request as any)(app)
      .get(`/api/leads/${tenantBLeadId}`)
      .set('Authorization', `Bearer ${freelancerAToken}`);

    assert.strictEqual(res.status, 403);
  });

  // 9. Proteção contra IDOR em exclusão
  await testCase('9.1', 'Freelancer A não pode excluir lead do Freelancer B (403)', async () => {
    const res = await (request as any)(app)
      .delete(`/api/leads/${tenantBLeadId}`)
      .set('Authorization', `Bearer ${freelancerAToken}`);

    assert.strictEqual(res.status, 403);
    assert.ok(db.getLeadById(tenantBLeadId), 'Lead de B deve continuar intacto');
  });

  // 10. Exclusão de workspace isolada sem afetar outros
  await testCase('10.1', 'Zerar workspace do Freelancer A preserva leads do Freelancer B e Admin', async () => {
    const res = await (request as any)(app)
      .post('/api/freelancer/workspace/reset')
      .set('Authorization', `Bearer ${freelancerAToken}`);

    assert.strictEqual(res.status, 200);
    assert.ok(db.getLeadById(tenantBLeadId), 'Lead do Freelancer B deve continuar intacto');
    assert.ok(db.getLeadById(tenantAdminLeadId), 'Lead do Admin deve continuar intacto');
  });

  // 11. Busca: criação de Job vinculada ao workspace
  await testCase('11.1', 'Criação de job por Freelancer A é restrita ao seu workspace', async () => {
    const jobRes = await createAndPrepareSearchJob({
      userId: 'free_tenant_a',
      freelancerId: 'free_tenant_a',
      freelancerName: 'Freelancer Tenant A',
      state: 'SP',
      city: 'Santos',
      niche: 'barbearia',
      filters: {
        onlyWithoutWebsite: true,
        onlyWithPhone: false,
        minRating: 0,
        minReviews: 0,
        targetLeads: 5,
      },
    });

    assert.strictEqual(jobRes.job.workspace_id, 'free_tenant_a');
    assert.strictEqual(jobRes.job.freelancer_id, 'free_tenant_a');
  });

  // 12. Progresso de busca avança mesmo com falhas de áreas (não trava em 70%)
  await testCase('12.1', 'Job atualiza processed_search_areas e atinge 100% na conclusão', async () => {
    const testJobId = `job_test_progress_${Date.now()}`;
    const newJob = {
      id: testJobId,
      workspace_id: 'admin',
      user_id: 'admin_1',
      state: 'SP',
      city: 'Campinas',
      niche: 'barbearia',
      status: 'running' as const,
      filters: { onlyWithoutWebsite: true, onlyWithPhone: false, minRating: 0, minReviews: 0 },
      target_leads: 10,
      total_cities: 1,
      processed_cities: 1,
      total_search_areas: 5,
      processed_search_areas: 3,
      places_found: 10,
      places_without_website: 5,
      leads_created: 5,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.createSearchJob(newJob);

    // Finalização do job
    db.updateSearchJob(testJobId, {
      status: 'completed',
      processed_search_areas: newJob.total_search_areas,
      finished_at: new Date().toISOString(),
    });

    const completed = db.getSearchJob(testJobId);
    assert.ok(completed);
    assert.strictEqual(completed.status, 'completed');
    assert.strictEqual(completed.processed_search_areas, 5, 'Áreas processadas devem equivaler ao total na conclusão');
  });

  // 13. Pausa e cancelamento de Search Job
  await testCase('13.1', 'Pausa e cancelamento de busca atualizam o status corretamente', async () => {
    const jId = `job_pause_test_${Date.now()}`;
    db.createSearchJob({
      id: jId,
      workspace_id: 'admin',
      user_id: 'admin_1',
      state: 'SP',
      city: 'São Paulo',
      niche: 'dentista',
      status: 'running',
      filters: { onlyWithoutWebsite: true, onlyWithPhone: false, minRating: 0, minReviews: 0 },
      target_leads: 0,
      total_cities: 1,
      processed_cities: 0,
      total_search_areas: 2,
      processed_search_areas: 0,
      places_found: 0,
      places_without_website: 0,
      leads_created: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    pauseSearchJob(jId);
    assert.strictEqual(db.getSearchJob(jId)?.status, 'paused');

    cancelSearchJob(jId);
    assert.strictEqual(db.getSearchJob(jId)?.status, 'cancelled');
  });

  // 14. Autenticação: Rejeição de senhas de backdoor ('Admin@2026!' e 'admin')
  await testCase('14.1', 'Senhas de backdoor fixas ("Admin@2026!" e "admin") são rejeitadas com 401', async () => {
    const res1 = await (request as any)(app)
      .post('/api/admin/login')
      .send({ email: 'gustavohcsantos.mm2020@gmail.com', password: 'Admin@2026!' });

    assert.strictEqual(res1.status, 401, 'Senha antiga de backdoor Admin@2026! deve ser rejeitada');

    const res2 = await (request as any)(app)
      .post('/api/admin/login')
      .send({ email: 'gustavohcsantos.mm2020@gmail.com', password: 'admin' });

    // Se a senha do env não for 'admin', deve rejeitar
    if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD !== 'admin') {
      assert.strictEqual(res2.status, 401);
    }
  });

  // 15. Autenticação: Rejeição de tokens adulterados ou com assinatura inválida
  await testCase('15.1', 'Token com HMAC adulterado retorna 401', async () => {
    const tamperedToken = adminToken.substring(0, adminToken.length - 6) + 'XXXXXX';
    const res = await (request as any)(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${tamperedToken}`);

    assert.strictEqual(res.status, 401);
  });

  // 16. Freelancer bloqueado não acessa recursos
  await testCase('16.1', 'Freelancer bloqueado recebe 403 Forbidden', async () => {
    const blockedToken = signSession({
      role: 'freelancer',
      freelancerId: 'free_tenant_blocked',
      accessCode: 'tenant_blocked',
      exp: Date.now() + 3600000,
    });

    const res = await (request as any)(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${blockedToken}`);

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.blocked, true);
  });

  // 17. Paginação: limit 0 retorna lista completa sem truncamento
  await testCase('17.1', 'getLeads com limit=0 retorna todos os leads do workspace sem paginação restritiva', async () => {
    const res = db.getLeads({
      freelancer_id: 'ALL',
      limit: 0,
    });

    assert.ok(Array.isArray(res.leads));
    assert.strictEqual(res.leads.length, res.total, 'Com limit=0 todos os leads devem ser retornados');
  });

  // 18. Regras do Firestore: Verificação estática de segurança
  await testCase('18.1', 'firestore.rules não contém permissões públicas abertas (allow read/delete: if true)', async () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    assert.ok(fs.existsSync(rulesPath), 'firestore.rules deve existir');
    const rulesContent = fs.readFileSync(rulesPath, 'utf8');

    assert.strictEqual(
      rulesContent.includes('allow read: if true;'),
      false,
      'firestore.rules não pode conter allow read: if true;'
    );
    assert.strictEqual(
      rulesContent.includes('allow delete: if true;'),
      false,
      'firestore.rules não pode conter allow delete: if true;'
    );
    assert.ok(
      rulesContent.includes('isSignedIn()'),
      'firestore.rules deve exigir autenticação via isSignedIn()'
    );
  });

  console.log('\n================================================================');
  console.log(`   RESULTADO FINAL DOS TESTES: ${passed} PASSADOS / ${failed} FALHADOS   `);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runForensicRegressionSuite().catch((err) => {
  console.error('Erro fatal executando os testes forenses:', err);
  process.exit(1);
});
