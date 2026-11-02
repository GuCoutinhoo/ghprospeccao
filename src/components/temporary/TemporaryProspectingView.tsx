import React, { useState } from 'react';
import { ArrowRight, Download, ExternalLink, LockKeyhole, MapPin, Search, ShieldCheck, Database, AlertTriangle } from 'lucide-react';

type TempLead = {
  id: string;
  name: string;
  city: string;
  state: string;
  niche: string;
  address: string;
  phone: string;
  website: string;
  rating: number;
  reviews: number;
  mapsUrl: string;
  capturedAt: string;
};
type SearchResponse = { leads?: TempLead[]; nextPageToken?: string | null; scanned?: number; error?: string };
const STORAGE_KEY = 'gh_temporary_test_prospecting_v1';
const SESSION_KEY = 'gh_temporary_test_session_v1';
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

function loadLeads(): TempLead[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((lead) => lead && typeof lead.id === 'string' && typeof lead.name === 'string') : [];
  } catch { return []; }
}
function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export default function TemporaryProspectingView() {
  const [token, setToken] = useState(() => sessionStorage.getItem(SESSION_KEY) || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [saved, setSaved] = useState<TempLead[]>(loadLeads);
  const [state, setState] = useState('SP');
  const [city, setCity] = useState('');
  const [niche, setNiche] = useState('clínicas odontológicas');
  const [onlyWithoutWebsite, setOnlyWithoutWebsite] = useState(true);
  const [onlyWithPhone, setOnlyWithPhone] = useState(false);
  const [minRating, setMinRating] = useState('0');
  const [maxReviews, setMaxReviews] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lastResult, setLastResult] = useState<TempLead[]>([]);
  const [nextPageToken, setNextPageToken] = useState('');
  const [lastQuery, setLastQuery] = useState('');

  const activeQuery = JSON.stringify({ state, city: city.trim(), niche: niche.trim(), onlyWithoutWebsite, onlyWithPhone, minRating, maxReviews });
  const canContinue = Boolean(nextPageToken) && activeQuery === lastQuery;

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const res = await fetch('/api/temporary/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.token) throw new Error(body.error || 'Não foi possível acessar.');
      sessionStorage.setItem(SESSION_KEY, body.token);
      setToken(body.token);
      setPassword('');
    } catch (err) { setAuthError(err instanceof Error ? err.message : 'Falha de autenticação.'); }
    finally { setAuthLoading(false); }
  }

  async function findLeads(next = false) {
    if (!city.trim() || !niche.trim()) { setError('Informe cidade e nicho.'); return; }
    if (next && !canContinue) return;
    setSearching(true);
    setError('');
    setMessage('');
    const querySignature = activeQuery;
    if (!next) { setLastResult([]); setNextPageToken(''); }
    try {
      const res = await fetch('/api/temporary/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-temporary-token': token },
        body: JSON.stringify({
          state, city: city.trim(), niche: niche.trim(),
          pageToken: next ? nextPageToken : '',
          filters: {
            onlyWithoutWebsite, onlyWithPhone,
            minRating: Number(minRating) || 0,
            maxReviews: maxReviews === '' ? undefined : Number(maxReviews),
          },
        }),
      });
      const data: SearchResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          sessionStorage.removeItem(SESSION_KEY);
          setToken('');
        }
        throw new Error(data.error || 'Não foi possível completar a pesquisa.');
      }
      const currentPage = Array.isArray(data.leads) ? data.leads : [];
      const existing = new Set(saved.map(lead => lead.id));
      const combined = saved.slice();
      for (const lead of currentPage) if (!existing.has(lead.id)) {
        existing.add(lead.id);
        combined.push(lead);
      }
      // Write a separate key only; never write, read or synchronize the real lead database.
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(combined));
        setSaved(combined);
        setMessage(String(combined.length - saved.length) + ' novos leads salvos neste navegador. ' + String(data.scanned ?? 0) + ' estabelecimentos analisados nesta página.');
      } catch {
        setError('O armazenamento do navegador está cheio ou bloqueado. Exporte seus leads antes de sair.');
        setMessage('A consulta terminou, mas os novos leads não foram salvos no navegador.');
      }
      setLastResult(currentPage);
      setLastQuery(querySignature);
      setNextPageToken(data.nextPageToken || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na busca.');
    } finally { setSearching(false); }
  }

  function exportCsv() {
    const headers = ['Nome', 'Telefone', 'Site', 'Endereço', 'Cidade', 'UF', 'Nicho', 'Nota', 'Avaliações', 'Google Maps', 'Capturado em', 'Place ID'];
    const rows = saved.map(lead => [lead.name, lead.phone, lead.website, lead.address, lead.city, lead.state, lead.niche, lead.rating, lead.reviews, lead.mapsUrl, lead.capturedAt, lead.id]);
    downloadFile('gh-leads-temporarios-test.csv', '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }
  function exportBackup() {
    downloadFile('gh-backup-temporario-test.json', JSON.stringify({ workspace: 'test-temporary', exportedAt: new Date().toISOString(), leads: saved }, null, 2), 'application/json');
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-4">
        <form onSubmit={login} className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-7 space-y-5 shadow-2xl">
          <div className="flex items-center gap-3"><LockKeyhole className="text-amber-400" /><div><h1 className="text-xl font-bold">GH Prospecção · Emergencial</h1><p className="text-xs text-neutral-400 mt-1">Workspace temporário TEST · sem Supabase</p></div></div>
          <p className="text-sm text-neutral-300">Entre com o mesmo e-mail e senha do administrador. Seus leads antigos não serão acessados ou modificados.</p>
          <label className="block text-sm">E-mail do administrador<input className="block mt-2 w-full rounded-lg bg-neutral-950 border border-neutral-700 p-3 text-white" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          <label className="block text-sm">Senha<input className="block mt-2 w-full rounded-lg bg-neutral-950 border border-neutral-700 p-3 text-white" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
          {authError && <p role="alert" className="text-sm text-red-400">{authError}</p>}
          <button disabled={authLoading} className="w-full rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-neutral-950 p-3 font-bold">{authLoading ? 'Verificando...' : 'Acessar modo temporário'}</button>
          <a href="/f/test" className="block text-xs text-neutral-400 text-center underline">Voltar para workspace original</a>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="bg-neutral-950 text-white px-4 py-5"><div className="max-w-6xl mx-auto flex flex-wrap gap-3 items-center justify-between"><div><h1 className="text-xl font-extrabold">GH Prospecção <span className="text-amber-400">Temporário</span></h1><p className="text-xs text-neutral-400 mt-1">Área independente · Workspace TEST · Google Places</p></div><button className="text-xs underline text-neutral-300" onClick={() => { sessionStorage.removeItem(SESSION_KEY); setToken(''); }}>Sair do modo temporário</button></div></header>
      <main className="max-w-6xl mx-auto p-4 sm:p-7 space-y-6">
        <section className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm space-y-2">
          <div className="flex items-center gap-2 font-bold"><ShieldCheck className="w-5 h-5" /> Sem alterações nos leads do Supabase</div>
          <p>Os novos leads são salvos <strong>somente neste navegador e neste dispositivo</strong>. Não aparecem automaticamente nas outras workspaces nem serão sincronizados quando o Supabase voltar. Exporte CSV e backup JSON regularmente; limpar os dados do navegador pode apagá-los.</p>
        </section>
        <section className="bg-white rounded-xl border border-neutral-200 p-5 sm:p-7 shadow-sm">
          <div className="flex items-center gap-2 mb-5"><Search className="w-5 h-5" /><h2 className="font-bold text-lg">Buscar novos locais</h2></div>
          <form onSubmit={e => {e.preventDefault(); void findLeads(false);}} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
              <label className="sm:col-span-1 text-sm font-medium">UF<select className="mt-1 w-full border rounded-lg p-3 bg-white" value={state} onChange={e => setState(e.target.value)}>{UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}</select></label>
              <label className="sm:col-span-2 text-sm font-medium">Cidade<input className="mt-1 w-full border rounded-lg p-3" placeholder="Ex.: Campinas" maxLength={75} value={city} onChange={e => setCity(e.target.value)} required /></label>
              <label className="sm:col-span-3 text-sm font-medium">Nicho<input className="mt-1 w-full border rounded-lg p-3" placeholder="Ex.: clínicas odontológicas" maxLength={75} value={niche} onChange={e => setNiche(e.target.value)} required /></label>
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyWithoutWebsite} onChange={e => setOnlyWithoutWebsite(e.target.checked)} /> Apenas sem site</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyWithPhone} onChange={e => setOnlyWithPhone(e.target.checked)} /> Com telefone</label>
              <label className="text-sm">Nota mínima<input className="block border rounded-lg p-2 mt-1 w-28" type="number" min="0" max="5" step=".1" value={minRating} onChange={e => setMinRating(e.target.value)} /></label>
              <label className="text-sm">Máximo de avaliações<input className="block border rounded-lg p-2 mt-1 w-36" type="number" min="0" step="1" placeholder="Sem limite" value={maxReviews} onChange={e => setMaxReviews(e.target.value)} /></label>
            </div>
            <div className="flex flex-wrap gap-3 items-center"><button disabled={searching} type="submit" className="flex items-center gap-2 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 px-5 py-3 font-bold"><Search className="w-4 h-4" />{searching ? 'Pesquisando...' : 'Buscar e salvar leads'}</button>{canContinue && <button type="button" disabled={searching} onClick={() => void findLeads(true)} className="flex items-center gap-2 rounded-lg border border-neutral-300 px-5 py-3 font-semibold disabled:opacity-50">Buscar próxima página <ArrowRight className="w-4 h-4"/></button>}<span className="text-xs text-neutral-500">Até 20 locais analisados por página. Consultas ao Google podem gerar cobrança.</span></div>
          </form>
          {error && <p className="mt-4 rounded-lg bg-red-50 text-red-700 p-3 flex gap-2 items-center text-sm" role="alert"><AlertTriangle className="w-4 h-4 shrink-0"/>{error}</p>}
          {message && <p className="mt-4 rounded-lg bg-green-50 text-green-800 p-3 text-sm">{message}</p>}
          {lastResult.length > 0 && <p className="mt-3 text-xs text-neutral-500">{lastResult.length} locais aprovados nos filtros da última página.</p>}
        </section>
        <section className="bg-white rounded-xl border border-neutral-200 p-5 sm:p-7 shadow-sm space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-3"><div className="flex items-center gap-2"><Database className="w-5 h-5"/><h2 className="font-bold text-lg">Leads salvos: {saved.length}</h2></div><div className="flex flex-wrap gap-2"><button disabled={!saved.length} onClick={exportCsv} className="flex items-center gap-2 rounded-lg bg-neutral-950 text-white px-4 py-2 text-sm font-semibold disabled:opacity-40"><Download className="w-4 h-4"/>Exportar CSV</button><button disabled={!saved.length} onClick={exportBackup} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40">Backup JSON</button></div></div>
          {!saved.length ? <p className="text-sm text-neutral-500 py-8 text-center">Nenhum lead temporário salvo ainda. Faça sua primeira pesquisa acima.</p> :
          <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm text-left"><thead className="bg-neutral-100"><tr>{['Estabelecimento','Telefone','Site','Google','Avaliações','Cidade/UF'].map(label => <th key={label} className="p-3 whitespace-nowrap">{label}</th>)}</tr></thead><tbody>{saved.map(lead => <tr key={lead.id} className="border-b border-neutral-100"><td className="p-3"><strong className="block">{lead.name}</strong><span className="block text-xs text-neutral-500 mt-1">{lead.address}</span></td><td className="p-3 whitespace-nowrap">{lead.phone || 'Não informado'}</td><td className="p-3">{lead.website ? <a href={lead.website} target="_blank" rel="noreferrer" className="text-blue-700 underline">Site <ExternalLink className="w-3 h-3 inline"/></a> : <span className="text-amber-700 font-semibold">Sem site</span>}</td><td className="p-3">{lead.mapsUrl ? <a href={lead.mapsUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline flex gap-1 items-center"><MapPin className="w-3 h-3"/>Ver</a> : '—'}</td><td className="p-3 whitespace-nowrap">{lead.rating ? lead.rating.toFixed(1) : '—'} · {lead.reviews}</td><td className="p-3 whitespace-nowrap">{lead.city}/{lead.state}</td></tr>)}</tbody></table></div>}
        </section>
        <p className="text-center text-xs text-neutral-500 pb-8">Armazenamento local isolado da base original. Não apague os dados do navegador sem exportar uma cópia.</p>
      </main>
    </div>
  );
}
