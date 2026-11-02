import React, { useState } from 'react';
import {
  ArrowLeft, ArrowRight, Building2, Check, ChevronRight, ClipboardList, Database,
  Download, ExternalLink, Filter, LayoutDashboard, MapPin, Menu, Phone, Search,
  ShieldCheck, SlidersHorizontal, Star, X,
} from 'lucide-react';

/**
 * Local-only TEST workspace while the Supabase subscription is restricted.
 * This component NEVER imports the real API client, store, or Supabase SDK.
 * It deliberately uses the same key as the earlier temporary release so new
 * temporary leads already captured by the user remain intact.
 */
type Lead = {
  id: string; name: string; city: string; state: string; niche: string;
  address: string; phone: string; website: string; rating: number;
  reviews: number; mapsUrl: string; capturedAt: string;
  notes?: string; status?: string; hidden?: boolean;
};
type GoogleResult = { leads?: Lead[]; nextPageToken?: string | null; scanned?: number; error?: string };
type View = 'dashboard' | 'search' | 'leads';
const STORAGE_KEY = 'gh_temporary_test_prospecting_v1';
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const STATUSES = ['NOVO', 'CONTATADO', 'INTERESSADO', 'FOLLOW_UP', 'FECHADO', 'PERDIDO'];

function loadSaved(): Lead[] {
  try {
    const input: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    return input.filter((l): l is Lead => {
      if (!l || typeof l.id !== 'string' || typeof l.name !== 'string' || !l.id || seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
  } catch { return []; }
}
function saveFile(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvField(value: unknown): string {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function LinkExternal({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href || !/^https?:\/\//i.test(href)) return <span className="text-neutral-400">—</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex gap-1 items-center text-blue-600 hover:underline">{children}<ExternalLink size={12} /></a>;
}

export default function TemporaryProspectingView() {
  const [view, setView] = useState<View>('leads');
  const [saved, setSaved] = useState<Lead[]>(loadSaved);
  const [state, setState] = useState('SP');
  const [city, setCity] = useState('');
  const [niche, setNiche] = useState('clínicas odontológicas');
  const [quantity, setQuantity] = useState(20);
  const [onlyWithoutWebsite, setOnlyWithoutWebsite] = useState(true);
  const [onlyWithPhone, setOnlyWithPhone] = useState(false);
  const [minRating, setMinRating] = useState('0');
  const [maxRating, setMaxRating] = useState('');
  const [minReviews, setMinReviews] = useState('0');
  const [maxReviews, setMaxReviews] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastResult, setLastResult] = useState<Lead[]>([]);
  const [nextPageToken, setNextPageToken] = useState('');
  const [querySignature, setQuerySignature] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [filterWithoutSite, setFilterWithoutSite] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState('');
  const [draftStatus, setDraftStatus] = useState('NOVO');
  const [mobileMenu, setMobileMenu] = useState(false);

  const currentQuery = JSON.stringify({
    state, city: city.trim(), niche: niche.trim(),
    onlyWithoutWebsite, onlyWithPhone, minRating, maxRating, minReviews, maxReviews,
  });
  const canContinue = Boolean(nextPageToken) && querySignature === currentQuery;

  const totalLeads = saved.length;
  const visible = saved.filter(l => {
    if (!showHidden && l.hidden) return false;
    if (filterWithoutSite && l.website) return false;
    if (!filterText.trim()) return true;
    const q = filterText.trim().toLocaleLowerCase('pt-BR');
    return [l.name, l.city, l.niche, l.phone, l.address, l.notes || ''].some(x => (x || '').toLocaleLowerCase('pt-BR').includes(q));
  });

  function persist(next: Lead[]): boolean {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSaved(next);
      return true;
    } catch {
      setError('Não foi possível salvar no navegador. O armazenamento pode estar bloqueado ou cheio. Exporte um backup JSON.');
      return false;
    }
  }
  function updateLead(id: string, updates: Partial<Lead>) {
    return persist(saved.map(lead => lead.id === id ? { ...lead, ...updates } : lead));
  }
  function openEditor(lead: Lead) {
    setDraftNotes(lead.notes || '');
    setDraftStatus(lead.status || 'NOVO');
    setEditing(lead.id);
    setError('');
  }
  function saveEditor() {
    if (!editing) return;
    if (updateLead(editing, { notes: draftNotes.slice(0, 4000), status: draftStatus })) {
      setEditing(null);
      setNotice('Anotações salvas neste navegador.');
    }
  }
  function exportCsv() {
    const headers = ['Estabelecimento', 'Telefone', 'Site', 'Endereço', 'Cidade', 'UF', 'Nicho', 'Nota', 'Avaliações', 'Google Maps', 'Status', 'Anotações', 'Oculto', 'Capturado em', 'Place ID'];
    const rows = saved.map(l => [l.name, l.phone, l.website, l.address, l.city, l.state, l.niche, l.rating, l.reviews, l.mapsUrl, l.status || 'NOVO', l.notes || '', l.hidden ? 'Sim' : 'Não', l.capturedAt, l.id]);
    saveFile('gh-prospeccao-test-leads.csv', '\uFEFF' + [headers, ...rows].map(row => row.map(csvField).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }
  function exportBackup() {
    saveFile('gh-prospeccao-test-backup.json', JSON.stringify({
      workspace: 'test-local', exportedAt: new Date().toISOString(), leads: saved,
    }, null, 2), 'application/json');
  }

  async function runSearch(next = false) {
    if (!city.trim() || !niche.trim()) { setError('Selecione a cidade e informe o nicho.'); return; }
    if (next && !canContinue) return;
    setSearching(true);
    setError('');
    setNotice('');
    if (!next) { setLastResult([]); setNextPageToken(''); }
    try {
      const response = await fetch('/api/temporary/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state, city: city.trim(), niche: niche.trim(),
          pageToken: next ? nextPageToken : '',
          filters: {
            onlyWithoutWebsite, onlyWithPhone, minRating: Number(minRating) || 0,
            maxRating: maxRating === '' ? undefined : Number(maxRating),
            minReviews: Number(minReviews) || 0,
            maxReviews: maxReviews === '' ? undefined : Number(maxReviews),
          },
        }),
      });
      const data = await response.json().catch(() => ({})) as GoogleResult;
      if (!response.ok) throw new Error(data.error || 'A busca do Google Places falhou.');
      const found = Array.isArray(data.leads) ? data.leads.slice(0, Math.max(1, Math.min(200, quantity))) : [];
      const ids = new Set(saved.map(l => l.id));
      const additions = found.filter(l => {
        if (!l.id || ids.has(l.id)) return false;
        ids.add(l.id);
        return true;
      });
      if (persist([...saved, ...additions])) {
        setNotice(String(additions.length) + ' leads novos salvos no navegador. ' +
          String(data.scanned || 0) + ' locais analisados nesta página. ' +
          (data.nextPageToken ? 'Clique em "Continuar busca" para mais locais.' : 'Fim dos resultados disponíveis nesta pesquisa.'));
      }
      setLastResult(found);
      setNextPageToken(data.nextPageToken || '');
      setQuerySignature(currentQuery);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na consulta. Tente novamente.');
    } finally { setSearching(false); }
  }
  function navigate(to: View) { setView(to); setMobileMenu(false); setError(''); setNotice(''); }

  const navigation: { id: View; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard', label: 'Visão Geral', icon: LayoutDashboard },
    { id: 'search', label: 'Buscar Novos Leads', icon: Search },
    { id: 'leads', label: 'Meus Estabelecimentos', icon: Building2 },
  ];
  const heading = view === 'dashboard' ? 'Visão Geral' : view === 'search' ? 'Buscar Novos Leads' : 'Meus Estabelecimentos & Leads';
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex">
      {mobileMenu && <button aria-label="Fechar menu" onClick={() => setMobileMenu(false)} className="fixed inset-0 bg-black/50 z-30 lg:hidden" />}
      <aside className={'fixed z-40 inset-y-0 left-0 w-64 bg-neutral-950 text-white flex flex-col border-r border-neutral-800 transition-transform lg:translate-x-0 ' + (mobileMenu ? 'translate-x-0' : '-translate-x-full')}>
        <div className="p-6 border-b border-neutral-800">
          <div className="font-extrabold text-xl tracking-tight">GH <span className="text-amber-400">Prospecção</span></div>
          <div className="text-xs text-neutral-400 mt-1">Workspace TEST</div>
        </div>
        <div className="px-3 py-5 flex-1 space-y-1">
          <div className="text-[10px] font-semibold tracking-widest text-neutral-500 uppercase px-3 mb-3">PROSPECÇÃO</div>
          {navigation.map(item => <button key={item.id} onClick={() => navigate(item.id)} className={'w-full text-left flex items-center gap-3 py-3 px-3 rounded-lg text-sm transition-colors ' + (view === item.id ? 'bg-amber-400/15 text-amber-400 font-bold' : 'text-neutral-300 hover:bg-neutral-800')}>
            <item.icon size={17} />{item.label}
          </button>)}
        </div>
        <div className="p-4 border-t border-neutral-800 space-y-2">
          <div className="text-xs text-emerald-400 flex items-center gap-2"><Database size={15} /> Dados locais no navegador</div>
          <p className="text-xs text-neutral-500">Temporário até o Supabase voltar. Sem alterações nos leads antigos.</p>
          <a href="/f/test" className="text-xs text-neutral-500 underline">Link da workspace TEST</a>
        </div>
      </aside>
      <div className="min-w-0 flex-1 lg:pl-64">
        <header className="bg-white border-b border-neutral-200 px-4 sm:px-8 py-5 flex items-center gap-3 sticky top-0 z-20">
          <button onClick={() => setMobileMenu(true)} aria-label="Abrir menu" className="lg:hidden p-2"><Menu size={21} /></button>
          <div className="flex-1 min-w-0">
            <h1 className="font-extrabold text-xl sm:text-2xl">{heading}</h1>
            <p className="text-neutral-500 text-xs mt-1">Workspace TEST · Seus leads novos são salvos neste dispositivo</p>
          </div>
          <button onClick={() => navigate('search')} className="hidden sm:flex gap-2 items-center rounded-lg bg-amber-400 hover:bg-amber-300 px-4 py-2.5 text-sm font-bold"><Search size={16} /> Nova Busca</button>
        </header>
        <main className="max-w-7xl mx-auto p-4 sm:p-7 space-y-6">
          <div className="border border-amber-200 bg-amber-50 rounded-xl px-4 py-3 flex items-start gap-3">
            <ShieldCheck size={18} className="text-amber-700 shrink-0 mt-0.5" />
            <p className="text-xs sm:text-sm text-amber-950">Modo de armazenamento no navegador: os leads antigos do Supabase e a workspace DANILO não são acessados nem alterados. Os novos dados ficam <strong>somente neste navegador</strong>, inclusive as anotações. Faça backup antes de limpar os dados do site ou trocar de dispositivo.</p>
          </div>
          {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">{error}</div>}
          {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-4 py-3 flex gap-2"><Check size={18} />{notice}</div>}
          {view === 'dashboard' && <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { title: 'Leads salvos', value: totalLeads, note: 'Somente neste navegador' },
                { title: 'Sem site', value: saved.filter(l => !l.website).length, note: 'Oportunidades encontradas' },
                { title: 'Contatados', value: saved.filter(l => l.status === 'CONTATADO').length, note: 'Atualizados localmente' },
              ].map(box => <div key={box.title} className="bg-white rounded-xl border border-neutral-200 p-6 shadow-sm"><p className="text-sm text-neutral-500">{box.title}</p><div className="text-3xl font-black mt-2">{box.value}</div><p className="text-xs text-neutral-400 mt-2">{box.note}</p></div>)}
            </div>
            <div className="bg-white rounded-xl border border-neutral-200 p-6">
              <h2 className="font-bold text-xl">Continue prospectando</h2>
              <p className="text-sm text-neutral-500 mt-2">Pesquise negócios no Google, salve contatos, registre observações e acompanhe as oportunidades sem depender do Supabase.</p>
              <button onClick={() => navigate('search')} className="mt-5 bg-amber-400 rounded-lg px-5 py-3 font-semibold flex gap-2 items-center hover:bg-amber-300">Iniciar nova busca <ArrowRight size={17} /></button>
            </div>
          </>}
          {view === 'search' && <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-5 sm:p-7 space-y-6">
            <div className="flex items-start gap-3 border-b border-neutral-100 pb-5"><div className="bg-amber-100 text-amber-700 p-3 rounded-lg"><Search size={22} /></div><div><h2 className="font-extrabold text-xl">Nova Busca de Leads</h2><p className="text-neutral-500 text-sm mt-1">Configure onde e quais negócios deseja encontrar.</p></div></div>
            <form onSubmit={e => { e.preventDefault(); void runSearch(); }} className="space-y-6">
              <div><div className="font-bold text-base mb-3 flex gap-2 items-center"><MapPin size={18} /> 1. Local da pesquisa</div><div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <label className="text-sm font-semibold md:col-span-1">Estado<select value={state} onChange={e => setState(e.target.value)} className="mt-2 block border border-neutral-300 rounded-lg p-3 w-full bg-white">{UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}</select></label>
                <label className="text-sm font-semibold md:col-span-4">Cidade<input maxLength={75} required value={city} onChange={e => setCity(e.target.value)} placeholder="Ex.: São Paulo" className="mt-2 block border border-neutral-300 rounded-lg p-3 w-full" /></label>
              </div></div>
              <div><div className="font-bold text-base mb-3 flex gap-2 items-center"><Building2 size={18} /> 2. Segmento</div><label className="text-sm font-semibold">Nicho de mercado<input maxLength={75} required value={niche} onChange={e => setNiche(e.target.value)} placeholder="Ex.: clínicas odontológicas" className="mt-2 block border border-neutral-300 rounded-lg p-3 w-full" /></label></div>
              <div><div className="font-bold text-base mb-3 flex gap-2 items-center"><SlidersHorizontal size={18} /> 3. Quantidade e filtros</div>
                <div className="mb-4"><label className="text-sm font-semibold">Quantidade desejada: {quantity} leads</label><input type="range" min={10} max={60} step={10} value={quantity} onChange={e => setQuantity(Number(e.target.value))} className="block mt-3 w-full accent-amber-500" /><p className="text-xs text-neutral-500 mt-1">Google Places retorna até 20 locais por página. Use “Continuar busca” para ampliar, até o limite de resultados disponível.</p></div>
                <div className="flex flex-wrap gap-x-6 gap-y-3 mb-4">
                  <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={onlyWithoutWebsite} onChange={e => setOnlyWithoutWebsite(e.target.checked)} /> Apenas sem site</label>
                  <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={onlyWithPhone} onChange={e => setOnlyWithPhone(e.target.checked)} /> Apenas com telefone</label>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <label className="text-xs font-semibold">Nota mínima<input type="number" min="0" max="5" step=".1" value={minRating} onChange={e => setMinRating(e.target.value)} className="block mt-2 w-full border rounded-lg p-3" /></label>
                  <label className="text-xs font-semibold">Nota máxima<input type="number" min="0" max="5" step=".1" placeholder="Sem limite" value={maxRating} onChange={e => setMaxRating(e.target.value)} className="block mt-2 w-full border rounded-lg p-3" /></label>
                  <label className="text-xs font-semibold">Mínimo avaliações<input type="number" min="0" step="1" value={minReviews} onChange={e => setMinReviews(e.target.value)} className="block mt-2 w-full border rounded-lg p-3" /></label>
                  <label className="text-xs font-semibold">Máximo avaliações<input type="number" min="0" step="1" placeholder="Sem limite" value={maxReviews} onChange={e => setMaxReviews(e.target.value)} className="block mt-2 w-full border rounded-lg p-3" /></label>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button disabled={searching} type="submit" className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 rounded-lg px-5 py-3 font-bold text-sm flex gap-2 items-center"><Search size={17} />{searching ? 'Pesquisando...' : 'INICIAR BUSCA DE LEADS'}</button>
                {canContinue && <button disabled={searching} type="button" onClick={() => void runSearch(true)} className="border border-neutral-300 hover:bg-neutral-100 disabled:opacity-50 rounded-lg px-5 py-3 font-bold text-sm flex items-center gap-2">Continuar busca <ChevronRight size={17} /></button>}
                <button type="button" onClick={() => navigate('leads')} className="border border-neutral-300 hover:bg-neutral-100 rounded-lg px-4 py-3 text-sm font-medium">Ver meus leads</button>
              </div>
              <p className="text-xs text-neutral-500">As consultas ao Google Places podem consumir cota e gerar custos. Os resultados ficam no navegador, sem envio ao Supabase.</p>
            </form>
            {lastResult.length > 0 && <div className="border-t pt-5"><h3 className="font-semibold mb-3">{lastResult.length} resultados qualificados na última página</h3><div className="grid md:grid-cols-2 gap-3">{lastResult.map(l => <div key={l.id} className="rounded-lg border p-3 flex justify-between gap-3"><div><p className="font-bold text-sm">{l.name}</p><p className="text-xs text-neutral-500 mt-1">{l.phone || 'Sem telefone'} · {l.website ? 'Com site' : 'Sem site'}</p></div><button type="button" onClick={() => { navigate('leads'); openEditor(l); }} className="text-xs font-semibold text-amber-700 flex items-center gap-1 shrink-0">Anotar <ArrowRight size={14} /></button></div>)}</div></div>}
          </div>}
          {view === 'leads' && <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-extrabold text-lg">Meus leads <span className="text-neutral-400 font-normal">({visible.length})</span></h2><p className="text-xs text-neutral-500 mt-1">Leads e anotações armazenados neste navegador</p></div><div className="flex flex-wrap gap-2">
              <button onClick={exportCsv} disabled={!saved.length} className="rounded-lg bg-neutral-950 text-white px-3 py-2 text-xs sm:text-sm font-semibold disabled:opacity-40 flex gap-2 items-center"><Download size={15} /> Exportar CSV</button>
              <button onClick={exportBackup} disabled={!saved.length} className="rounded-lg border px-3 py-2 text-xs sm:text-sm font-semibold disabled:opacity-40">Backup JSON</button>
            </div></div>
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px]"><Search size={16} className="absolute left-3 top-3.5 text-neutral-400"/><input value={filterText} onChange={e => setFilterText(e.target.value)} className="border rounded-lg pl-10 pr-3 py-3 w-full text-sm" placeholder="Buscar estabelecimento, telefone, nota..." /></div>
              <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={filterWithoutSite} onChange={e => setFilterWithoutSite(e.target.checked)} /> Somente sem site</label>
              <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} /> Exibir ocultos</label>
            </div>
            {!saved.length ? <div className="text-center py-12"><Search className="mx-auto text-neutral-300 mb-4" size={34}/><h3 className="font-bold">Nenhum lead salvo ainda</h3><p className="text-sm text-neutral-500 mt-2">Pesquise para encontrar seus primeiros estabelecimentos.</p><button onClick={() => navigate('search')} className="bg-amber-400 px-5 py-3 rounded-lg font-bold text-sm mt-5">Buscar leads</button></div> :
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-neutral-100"><tr>{['Estabelecimento','Contato','Site','Avaliações','Status','Anotações','Ações'].map(h => <th key={h} className="p-3 font-bold whitespace-nowrap text-xs">{h}</th>)}</tr></thead>
                <tbody>{visible.map(l => <tr key={l.id} className={'border-b border-neutral-100 hover:bg-neutral-50 ' + (l.hidden ? 'opacity-50' : '')}>
                  <td className="p-3 min-w-[210px]"><p className="font-semibold">{l.name}</p><p className="text-xs text-neutral-500 mt-1">{l.address || (l.city + '/' + l.state)}</p></td>
                  <td className="p-3 whitespace-nowrap">{l.phone ? <a href={'tel:' + l.phone} className="text-blue-600 inline-flex gap-1 items-center"><Phone size={13} /> {l.phone}</a> : '—'}</td>
                  <td className="p-3">{l.website ? <LinkExternal href={l.website}>Visitar</LinkExternal> : <span className="text-amber-700 font-semibold text-xs">Sem site</span>}</td>
                  <td className="p-3 whitespace-nowrap"><span className="inline-flex gap-1 items-center"><Star size={13} className="text-amber-500" /> {l.rating || '—'}</span><div className="text-xs text-neutral-500">{l.reviews} avaliações</div></td>
                  <td className="p-3 whitespace-nowrap text-xs">{l.status || 'NOVO'}</td>
                  <td className="p-3 max-w-48"><span className="text-xs line-clamp-2">{l.notes || 'Sem anotações'}</span></td>
                  <td className="p-3"><div className="flex gap-3 items-center whitespace-nowrap">
                    <button title="Anotar ou mudar status" onClick={() => openEditor(l)} className="text-amber-700 font-semibold text-xs flex gap-1 items-center"><ClipboardList size={15} /> Anotar</button>
                    <button title="Ocultar apenas neste navegador" onClick={() => updateLead(l.id, { hidden: !l.hidden })} className="text-xs text-neutral-500 underline">{l.hidden ? 'Mostrar' : 'Ocultar'}</button>
                    {l.mapsUrl && <LinkExternal href={l.mapsUrl}>Mapa</LinkExternal>}
                  </div></td>
                </tr>)}</tbody>
              </table>
              {!visible.length && <p className="text-center text-sm text-neutral-500 py-8">Nenhum lead corresponde aos filtros.</p>}
            </div>}
          </div>}
        </main>
      </div>
      {editing && <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Anotações do lead">
        <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-5 sm:p-7 space-y-5">
          <div className="flex justify-between items-start gap-3"><div><h2 className="font-extrabold text-xl">Anotações do lead</h2><p className="text-xs text-neutral-500 mt-1">{saved.find(l => l.id === editing)?.name}</p></div><button title="Fechar" onClick={() => setEditing(null)}><X size={21}/></button></div>
          <label className="block text-sm font-semibold">Status comercial<select className="mt-2 border rounded-lg p-3 w-full bg-white" value={draftStatus} onChange={e => setDraftStatus(e.target.value)}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
          <label className="block text-sm font-semibold">Anotações<textarea className="block mt-2 border rounded-lg w-full p-3 min-h-40 resize-y" maxLength={4000} value={draftNotes} onChange={e => setDraftNotes(e.target.value)} placeholder="Ex.: Falei com a recepcionista, retornar na terça-feira..." /></label>
          <div className="flex gap-3 justify-end"><button onClick={() => setEditing(null)} className="border rounded-lg px-4 py-2.5 text-sm">Cancelar</button><button onClick={saveEditor} className="bg-amber-400 rounded-lg px-5 py-2.5 font-bold text-sm flex items-center gap-2"><Check size={16}/> Salvar anotações</button></div>
          <p className="text-xs text-neutral-500">Essas informações permanecem após F5, mas apenas neste navegador. Exporte o backup regularmente.</p>
        </div>
      </div>}
    </div>
  );
}
