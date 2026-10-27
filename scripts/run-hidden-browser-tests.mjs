import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

await build({entryPoints:['tests/hidden-leads-fixture.ts'],outfile:'.test-dist/hidden-leads-fixture.js',bundle:true,platform:'node',format:'esm',packages:'external'});
const { startHiddenLeadsFixture } = await import(pathToFileURL(path.resolve('.test-dist/hidden-leads-fixture.js')).href);
const fixture = await startHiddenLeadsFixture();
let browser;
let checks = 0;
const check = async (label,operation) => { await operation(); checks++; console.log(`PASS ${label}`); };
try {
  browser = await chromium.launch({
    headless:true,
    ...(process.env.GH_TEST_CHROMIUM_PATH ? {executablePath:process.env.GH_TEST_CHROMIUM_PATH} : {}),
    args:['--no-sandbox'],
  });
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  // The fixture must never send browser requests to production or third parties.
  await context.route('**/*',route => new URL(route.request().url()).origin === fixture.url
    ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  const openWorkspace = () => page.goto(`${fixture.url}/f/browser-audit`);
  const row = name => page.locator('tr, div.group').filter({has:page.getByText(name,{exact:true})});
  const assertHidden = async name => {
    await row(name).getByTitle(/Lead marcado como cinza/).waitFor();
  };
  await openWorkspace();
  await check('ocultar na tabela e confirmar gravação',async () => {
    const response = page.waitForResponse(res => res.url().endsWith(`/api/leads/${fixture.target.id}/hide`) && res.request().method() === 'POST');
    await row(fixture.target.name).getByTitle('Ocultar lead (deixar cinza para não pegar repetido)',{exact:true}).click();
    assert.equal((await response).status(),200);
    await assertHidden(fixture.target.name);
    assert.equal(fixture.harness.rows.get(`leads/${fixture.target.id}`).document.is_hidden,true);
  });
  await check('F5 real mantém o lead oculto',async () => {
    await page.reload();
    await assertHidden(fixture.target.name);
  });
  await check('navegação para Favoritos e retorno mantém ocultação',async () => {
    await page.getByRole('navigation').getByRole('button',{name:'Favoritos',exact:true}).click();
    await page.getByRole('navigation').getByRole('button',{name:'Meus Leads',exact:true}).click();
    await assertHidden(fixture.target.name);
  });
  await check('nova entrada sem sessão no navegador mantém ocultação',async () => {
    await page.evaluate(() => localStorage.clear());
    await openWorkspace();
    await assertHidden(fixture.target.name);
  });
  await check('favorito lento no modal não sobrescreve a ocultação',async () => {
    await page.getByText(fixture.race.name,{exact:true}).click();
    await page.getByRole('button',{name:'Favoritar',exact:true}).waitFor();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let favoriteStarted;
    const started = new Promise(resolve => { favoriteStarted = resolve; });
    const favoritePath = `**/api/leads/${fixture.race.id}/favorite`;
    await page.route(favoritePath,async route => {
      const response = await route.fetch();
      favoriteStarted();
      await gate;
      await route.fulfill({response});
    });
    let hideRequests = 0;
    page.on('request',req => { if (req.url().endsWith(`/api/leads/${fixture.race.id}/hide`)) hideRequests++; });
    await page.getByRole('button',{name:'Favoritar',exact:true}).click();
    await started;
    await page.getByRole('button',{name:'Ocultar (Cinza)',exact:true}).click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('Ocultar (Cinza)') && button.disabled));
    assert.equal(hideRequests,0,'ocultação aguarda a ação anterior');
    release();
    await page.getByRole('button',{name:'Lead Cinza (Oculto)',exact:true}).waitFor();
    await page.getByRole('button',{name:'Favoritado',exact:true}).waitFor();
    assert.equal(fixture.harness.rows.get(`leads/${fixture.race.id}`).document.is_hidden,true);
    await page.getByRole('button',{name:'Fechar',exact:true}).click();
    await page.reload();
    await assertHidden(fixture.race.name);
  });
  await check('falha de gravação não simula sucesso nem oculta o lead',async () => {
    fixture.harness.failCommit();
    const response = page.waitForResponse(res => res.url().endsWith(`/api/leads/${fixture.failure.id}/hide`));
    await row(fixture.failure.name).getByTitle('Ocultar lead (deixar cinza para não pegar repetido)',{exact:true}).click();
    assert.equal((await response).status(),500);
    await page.getByText(/Supabase storage failure/).waitFor();
    assert.equal(fixture.harness.rows.get(`leads/${fixture.failure.id}`).document.is_hidden,false);
    await page.reload();
    await row(fixture.failure.name).getByTitle('Ocultar lead (deixar cinza para não pegar repetido)',{exact:true}).waitFor();
  });
  await check('favorito lento na tabela não sobrescreve a ocultação',async () => {
    const lead = fixture.tableRace;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let favoriteStarted;
    const started = new Promise(resolve => { favoriteStarted = resolve; });
    await page.route(`**/api/leads/${lead.id}/favorite`,async route => {
      const response = await route.fetch();
      favoriteStarted();
      await gate;
      await route.fulfill({response});
    });
    let hideRequests = 0;
    page.on('request',req => { if (req.url().endsWith(`/api/leads/${lead.id}/hide`)) hideRequests++; });
    await row(lead.name).getByTitle('Adicionar aos favoritos',{exact:true}).click();
    await started;
    const hideButton = row(lead.name).getByTitle('Ocultar lead (deixar cinza para não pegar repetido)',{exact:true});
    await hideButton.click();
    assert.equal(await hideButton.isDisabled(),true);
    assert.equal(hideRequests,0,'a tabela também aguarda o favorito anterior');
    release();
    await assertHidden(lead.name);
    await row(lead.name).getByTitle('Remover dos favoritos',{exact:true}).waitFor();
    assert.equal(fixture.harness.rows.get(`leads/${lead.id}`).document.is_hidden,true);
    await page.reload();
    await assertHidden(lead.name);
  });
  await check('leads previamente ocultos permanecem intactos e isolados',async () => {
    assert.deepEqual(fixture.currentProtectedRows(),fixture.protectedRows);
    assert.equal(await page.getByText('OUTRO WORKSPACE',{exact:true}).count(),0);
    await assertHidden('OCULTO PRESERVADO');
    assert.deepEqual(errors,[]);
  });
  await check('botão Ver Leads da Busca mostra 10 novos e nenhum histórico',async () => {
    await page.getByRole('navigation').getByRole('button',{name:'Buscar Leads',exact:true}).click();
    await page.getByText('Barbearia — São Paulo, SP',{exact:true}).click();
    await page.getByRole('button',{name:/Ver Leads da Busca \(10\)/}).click();
    await page.getByText(/Exibindo somente os leads novos desta busca/).waitFor();
    await page.getByText('BUSCA NOVA 0',{exact:true}).waitFor();
    assert.equal(await page.locator('div.group').filter({hasText:/BUSCA NOVA/}).count(),10);
    assert.equal(await page.getByText('HISTORICO 0',{exact:true}).count(),0);
    await page.reload();
    await page.getByText(/Exibindo somente os leads novos desta busca/).waitFor();
    assert.equal(await page.getByText('HISTORICO 0',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Ver todos os leads do workspace'}).click();
    await page.getByText('HISTORICO 0',{exact:true}).waitFor();
  });
  console.log(`${checks} verificações de navegador passaram; armazenamento inteiramente simulado.`);
} finally {
  await browser?.close();
  await fixture.close();
}
