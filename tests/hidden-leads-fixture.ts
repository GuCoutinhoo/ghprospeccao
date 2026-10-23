import express from 'express';
import path from 'node:path';
import { createSupabaseHarness } from './helpers/supabaseHarness';
import type { Lead } from '../src/types';

// Local browser fixture: no production credentials, Supabase calls or real leads.
export async function startHiddenLeadsFixture() {
  process.env.GH_SUPABASE_URL = 'https://tests.supabase.co';
  process.env.GH_SUPABASE_SECRET_KEY = 'test-server-secret';
  process.env.SESSION_SECRET = 'browser-test-secret-at-least-32-characters';
  const harness = createSupabaseHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = harness.fetchMock;
  const { Repository } = await import('../src/lib/store/repository');
  const { DocumentStore } = await import('../src/lib/supabase/documentStore');
  const repository = new Repository(new DocumentStore());
  const freelancer = await repository.createFreelancer({name:'Workspace fictício',email:'browser@example.com',access_code:'browser-audit'});
  const seed = async (name: string, hidden = false, workspace = freelancer.id) => {
    const timestamp = '2026-10-23T12:00:00.000Z';
    const lead: Lead = {
      id:name,place_id:name,name,niche:'barbearia',state:'SP',city:'São Paulo',
      workspace_id:workspace,freelancer_id:workspace,user_id:workspace,
      website:'',website_status:'no_website',phone:'11999999999',rating:3.5,
      reviews_count:20,lead_score:80,pipeline_status:'NOVO',is_hidden:hidden,
      is_favorite:false,created_at:timestamp,updated_at:timestamp,
    };
    return (await repository.createLead(lead)).lead;
  };
  const target = await seed('AUDITORIA F5');
  const race = await seed('AUDITORIA CONCORRENCIA');
  const tableRace = await seed('AUDITORIA CONCORRENCIA TABELA');
  const failure = await seed('AUDITORIA FALHA');
  const protectedLead = await seed('OCULTO PRESERVADO',true);
  const otherWorkspace = await seed('OUTRO WORKSPACE',true,'free_other');
  const protectedRows = [protectedLead,otherWorkspace].map(lead =>
    JSON.stringify(harness.rows.get(`leads/${lead.id}`)));
  const { app } = await import('../src/server/app');
  const serverApp = express();
  serverApp.use('/api',app);
  serverApp.use(express.static(path.resolve('dist')));
  serverApp.get('*',(_req,res) => res.sendFile(path.resolve('dist/index.html')));
  const server = serverApp.listen(0,'127.0.0.1');
  await new Promise<void>(resolve => server.once('listening',resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  return {
    url:`http://127.0.0.1:${address.port}`,harness,target,race,tableRace,failure,
    protectedRows,
    currentProtectedRows:() => [protectedLead,otherWorkspace].map(lead =>
      JSON.stringify(harness.rows.get(`leads/${lead.id}`))),
    async close() {
      await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
      globalThis.fetch = originalFetch;
    },
  };
}
