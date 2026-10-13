import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app, { signSession } from '../src/server/app';
import { db } from '../src/lib/store/db';

// Setup test tokens using real cryptographically signed HMAC sessions
const adminToken = signSession({
  role: 'admin',
  id: 'admin_1',
  email: 'gustavohcsantos.mm2020@gmail.com',
  exp: Date.now() + 3600000,
});

const freelancerAToken = signSession({
  role: 'freelancer',
  freelancerId: 'free_teste_a',
  accessCode: 'teste_a',
  exp: Date.now() + 3600000,
});

const freelancerBToken = signSession({
  role: 'freelancer',
  freelancerId: 'free_teste_b',
  accessCode: 'teste_b',
  exp: Date.now() + 3600000,
});

async function runIsolationTests() {
  console.log('--- INICIANDO TESTES AUTOMATIZADOS DE ISOLAMENTO MULTI-TENANT ---');

  // Seed freelancers for testing
  (db as any).data.freelancers = ((db as any).data.freelancers || []).filter(
    (f: any) => !['free_teste_a', 'free_teste_b', 'free_teste_blocked'].includes(f.id)
  );
  (db as any).data.freelancers.push(
    {
      id: 'free_teste_a',
      name: 'Freelancer Teste A',
      access_code: 'teste_a',
      email: 'teste_a@ghprospeccao.com',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'free_teste_b',
      name: 'Freelancer Teste B',
      access_code: 'teste_b',
      email: 'teste_b@ghprospeccao.com',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'free_teste_blocked',
      name: 'Freelancer Bloqueado',
      access_code: 'teste_blocked',
      email: 'blocked@ghprospeccao.com',
      status: 'blocked',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  );

  // Seed sample leads for each workspace
  db.createLead({
    id: 'lead_admin_sample',
    place_id: 'place_admin_sample',
    workspace_id: 'admin',
    user_id: 'admin_1',
    name: 'Loja Exclusiva Admin',
    niche: 'barbearia',
    state: 'SP',
    city: 'Campinas',
    website_status: 'no_website',
    rating: 4.5,
    reviews_count: 10,
    lead_score: 80,
    pipeline_status: 'NOVO',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  db.createLead({
    id: 'lead_free_teste_a_sample',
    place_id: 'place_free_a_sample',
    workspace_id: 'free_teste_a',
    freelancer_id: 'free_teste_a',
    user_id: 'free_teste_a',
    name: 'Pizzaria do Freelancer A',
    niche: 'restaurante',
    state: 'SP',
    city: 'Santos',
    website_status: 'no_website',
    rating: 4.8,
    reviews_count: 25,
    lead_score: 90,
    pipeline_status: 'NOVO',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  db.createLead({
    id: 'lead_free_teste_b_sample',
    place_id: 'place_free_b_sample',
    workspace_id: 'free_teste_b',
    freelancer_id: 'free_teste_b',
    user_id: 'free_teste_b',
    name: 'Dentista do Freelancer B',
    niche: 'odontologia',
    state: 'RJ',
    city: 'Niterói',
    website_status: 'no_website',
    rating: 4.2,
    reviews_count: 15,
    lead_score: 75,
    pipeline_status: 'NOVO',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  let passed = 0;
  let failed = 0;

  async function testCase(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  }

  // TESTE 1: Requisições não autenticadas devem ser rejeitadas com 401
  await testCase('1.1 Rota protegida sem token retorna 401', async () => {
    const res = await (request as any)(app).get('/api/leads');
    assert.strictEqual(res.status, 401);
  });

  await testCase('1.2 Token falso (admin_master_session_token) retorna 401', async () => {
    const res = await (request as any)(app)
      .get('/api/leads')
      .set('Authorization', 'Bearer admin_master_session_token');
    assert.strictEqual(res.status, 401);
  });

  await testCase('1.3 Token falso pré-fixado free_sess_ sem assinatura retorna 401', async () => {
    const res = await (request as any)(app)
      .get('/api/leads')
      .set('Authorization', 'Bearer free_sess_free_teste_a_123456');
    assert.strictEqual(res.status, 401);
  });

  // TESTE 2: Freelancer Bloqueado deve ter acesso negado (403)
  await testCase('2. Freelancer com status bloqueado recebe 403', async () => {
    const blockedToken = signSession({
      role: 'freelancer',
      freelancerId: 'free_teste_blocked',
      accessCode: 'teste_blocked',
      exp: Date.now() + 3600000,
    });
    const res = await (request as any)(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${blockedToken}`);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.blocked, true);
  });

  // TESTE 3: Isolamento de Listagem de Leads
  await testCase('3.1 Freelancer A só visualiza leads do workspace A', async () => {
    const res = await (request as any)(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${freelancerAToken}`);
    assert.strictEqual(res.status, 200);
    const leads = res.body.leads || [];
    for (const lead of leads) {
      assert.strictEqual(lead.freelancer_id, 'free_teste_a');
    }
    const hasAdminLead = leads.some((l: any) => l.id === 'lead_admin_sample');
    const hasBLead = leads.some((l: any) => l.id === 'lead_free_teste_b_sample');
    assert.strictEqual(hasAdminLead, false, 'Lead do Admin não pode vazar para Freelancer A');
    assert.strictEqual(hasBLead, false, 'Lead do Freelancer B não pode vazar para Freelancer A');
  });

  await testCase('3.2 Freelancer A tenta burlar passando ?freelancer_id=free_teste_b na URL -> 403', async () => {
    const res = await (request as any)(app)
      .get('/api/leads?freelancer_id=free_teste_b')
      .set('Authorization', `Bearer ${freelancerAToken}`);
    assert.strictEqual(res.status, 403);
  });

  await testCase('3.3 Admin consulta workspace próprio -> Não vê leads de freelancers', async () => {
    const res = await (request as any)(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.strictEqual(res.status, 200);
    const leads = res.body.leads || [];
    const hasALead = leads.some((l: any) => l.id === 'lead_free_teste_a_sample');
    const hasBLead = leads.some((l: any) => l.id === 'lead_free_teste_b_sample');
    assert.strictEqual(hasALead, false, 'Workspace próprio do admin não contém leads do Freelancer A');
    assert.strictEqual(hasBLead, false, 'Workspace próprio do admin não contém leads do Freelancer B');
  });

  // TESTE 4: Proteção contra IDOR (Operações em Leads Individuais)
  await testCase('4.1 Freelancer A tenta ler Lead do Freelancer B por ID -> 403', async () => {
    const res = await (request as any)(app)
      .get('/api/leads/lead_free_teste_b_sample')
      .set('Authorization', `Bearer ${freelancerAToken}`);
    assert.strictEqual(res.status, 403);
  });

  await testCase('4.2 Freelancer A tenta alterar Lead do Admin -> 403', async () => {
    const res = await (request as any)(app)
      .patch('/api/leads/lead_admin_sample')
      .set('Authorization', `Bearer ${freelancerAToken}`)
      .send({ name: 'Nome Hackeado' });
    assert.strictEqual(res.status, 403);
  });

  await testCase('4.3 Freelancer A tenta favoritar Lead do Freelancer B -> 403', async () => {
    const res = await (request as any)(app)
      .post('/api/leads/lead_free_teste_b_sample/favorite')
      .set('Authorization', `Bearer ${freelancerAToken}`);
    assert.strictEqual(res.status, 403);
  });

  await testCase('4.4 Freelancer A tenta adicionar nota no Lead do Admin -> 403', async () => {
    const res = await (request as any)(app)
      .post('/api/leads/lead_admin_sample/notes')
      .set('Authorization', `Bearer ${freelancerAToken}`)
      .send({ content: 'Nota invasiva' });
    assert.strictEqual(res.status, 403);
  });

  await testCase('4.5 Freelancer A tenta deletar Lead do Freelancer B -> 403', async () => {
    const res = await (request as any)(app)
      .delete('/api/leads/lead_free_teste_b_sample')
      .set('Authorization', `Bearer ${freelancerAToken}`);
    assert.strictEqual(res.status, 403);
  });

  // TESTE 5: Criação de Buscas (Search Jobs)
  await testCase('5.1 Busca criada pelo Admin pertence exclusivamente ao workspace Admin', async () => {
    const res = await (request as any)(app)
      .post('/api/search-jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        state: 'SP',
        city: 'Campinas',
        niche: 'barbearia',
        // Tenta enviar freelancerId no body para simular resíduo de sessão
        freelancerId: 'free_teste_a',
        filters: { onlyWithoutWebsite: true, onlyWithPhone: false, minRating: 0, minReviews: 0, targetLeads: 5 },
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.job.workspace_id, 'admin', 'Workspace do job DEVE ser admin');
    assert.strictEqual(res.body.job.freelancer_id, undefined, 'Freelancer ID do job DEVE ser undefined');
  });

  await testCase('5.2 Freelancer A cria busca -> Vinculada estritamente ao seu workspace', async () => {
    const res = await (request as any)(app)
      .post('/api/search-jobs')
      .set('Authorization', `Bearer ${freelancerAToken}`)
      .send({
        state: 'SP',
        city: 'Santos',
        niche: 'pizzaria',
        filters: { onlyWithoutWebsite: true, onlyWithPhone: false, minRating: 0, minReviews: 0, targetLeads: 5 },
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.job.workspace_id, 'free_teste_a');
    assert.strictEqual(res.body.job.freelancer_id, 'free_teste_a');
  });

  await testCase('5.3 Freelancer A tenta criar busca para Freelancer B -> 403', async () => {
    const res = await (request as any)(app)
      .post('/api/search-jobs')
      .set('Authorization', `Bearer ${freelancerAToken}`)
      .send({
        state: 'RJ',
        city: 'Niterói',
        niche: 'dentista',
        freelancerId: 'free_teste_b',
        filters: { onlyWithoutWebsite: true, onlyWithPhone: false, minRating: 0, minReviews: 0, targetLeads: 5 },
      });
    assert.strictEqual(res.status, 403);
  });

  // TESTE 6: Proteção das rotas de Administrador
  await testCase('6.1 Freelancer A tenta acessar rotas de admin (/api/admin/freelancers) -> 403', async () => {
    const res = await (request as any)(app)
      .get('/api/admin/freelancers')
      .set('Authorization', `Bearer ${freelancerAToken}`);
    assert.strictEqual(res.status, 403);
  });

  await testCase('6.2 Freelancer A tenta acessar configurações do sistema (/api/settings) -> 403', async () => {
    const res = await (request as any)(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${freelancerAToken}`);
    assert.strictEqual(res.status, 403);
  });

  // TESTE 7: Reset e Exclusão Segura
  await testCase('7.1 Freelancer A só pode resetar o próprio workspace', async () => {
    const res = await (request as any)(app)
      .post('/api/freelancer/workspace/reset')
      .set('Authorization', `Bearer ${freelancerAToken}`)
      .send({ freelancerId: 'free_teste_b' }); // Tenta resetar o B
    assert.strictEqual(res.status, 200);
    // Mas o lead do B continua intacto!
    const leadB = db.getLeadById('lead_free_teste_b_sample');
    assert.ok(leadB, 'O lead do Freelancer B deve continuar intacto');
  });

  console.log('\n--- RESUMO DOS TESTES ---');
  console.log(`Total de testes: ${passed + failed}`);
  console.log(`Sucessos: ${passed}`);
  console.log(`Falhas: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log(' TODOS OS TESTES DE ISOLAMENTO PASSARAM COM SUCESSO!\n');
    process.exit(0);
  }
}

runIsolationTests().catch((err) => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
