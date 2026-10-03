import React, { useState, useEffect } from 'react';
import {
  Search,
  Filter,
  ArrowUpDown,
  ExternalLink,
  MessageCircle,
  Phone,
  Eye,
  CheckCircle,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Building,
  Globe,
  FileSpreadsheet,
  LayoutGrid,
  List,
  Compass,
  MapPin,
  Star,
  Store,
  Scissors,
  Stethoscope,
  Zap,
  Wrench,
  Utensils,
  Home,
  Check,
  Copy,
  Tags,
  Layers,
  Heart,
} from 'lucide-react';
import { Lead, PipelineStatus } from '../../types';
import { api } from '../../lib/api';
import { getScoreColorClass } from '../../lib/scoring/leadScore';
import { formatBrazilianPhone, getWhatsAppUrl } from '../../utils/whatsapp';
import { BRAZILIAN_STATES } from '../../lib/ibge/ibgeService';

const STATE_NAMES: Record<string, string> = {
  SP: 'São Paulo',
  RJ: 'Rio de Janeiro',
  MG: 'Minas Gerais',
  ES: 'Espírito Santo',
  PR: 'Paraná',
  SC: 'Santa Catarina',
  RS: 'Rio Grande do Sul',
  BA: 'Bahia',
  PE: 'Pernambuco',
  CE: 'Ceará',
  GO: 'Goiás',
  DF: 'Distrito Federal',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  PA: 'Pará',
  AM: 'Amazonas',
  MA: 'Maranhão',
  PB: 'Paraíba',
  RN: 'Rio Grande do Norte',
  AL: 'Alagoas',
  SE: 'Sergipe',
  PI: 'Piauí',
  TO: 'Tocantins',
  RO: 'Rondônia',
  AC: 'Acre',
  AP: 'Amapá',
  RR: 'Roraima',
};

interface LeadsTableViewProps {
  onSelectLead: (lead: Lead) => void;
  initialNicheFilter?: string;
  initialStateFilter?: string;
  onStartSpeedOutreach?: () => void;
}

function getNicheIcon(niche: string) {
  const n = niche.toLowerCase();
  if (n.includes('barbearia') || n.includes('cabelo') || n.includes('salao')) return Scissors;
  if (n.includes('odonto') || n.includes('dent') || n.includes('clinica')) return Stethoscope;
  if (n.includes('eletri') || n.includes('solar') || n.includes('energia')) return Zap;
  if (n.includes('mecan') || n.includes('oficina') || n.includes('auto')) return Wrench;
  if (n.includes('restaur') || n.includes('pizza') || n.includes('comida')) return Utensils;
  if (n.includes('imobil')) return Home;
  return Store;
}

export const LeadsTableView: React.FC<LeadsTableViewProps> = ({
  onSelectLead,
  initialNicheFilter,
  initialStateFilter,
  onStartSpeedOutreach,
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);

  // Modo de visualização: 'cards' (Vitrine de Lojas) ou 'table' (Tabela de Dados)
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  // Filtros
  const [search, setSearch] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<string>(initialStateFilter || 'ALL');
  const [cityFilter, setCityFilter] = useState<string>('ALL');
  const [nicheFilter, setNicheFilter] = useState<string>(initialNicheFilter || 'ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [onlyWithoutWebsite, setOnlyWithoutWebsite] = useState<boolean>(false);
  const [onlyWithPhone, setOnlyWithPhone] = useState<boolean>(false);
  const [onlyFavorites, setOnlyFavorites] = useState<boolean>(false);
  const [minScore, setMinScore] = useState<number>(0);
  const [sortBy, setSortBy] = useState<'score' | 'reviews' | 'rating' | 'recent'>('score');

  // Detecção de job de busca ativo no background
  const [runningJob, setRunningJob] = useState<any | null>(null);

  // Lista dinâmica de nichos/categorias
  const [niches, setNiches] = useState<{ niche: string; count: number }[]>([]);
  // Lista dinâmica de estados com contagem
  const [statesSummary, setStatesSummary] = useState<{ state: string; count: number }[]>([]);
  // Modo de exibição das abas superiores ('both' | 'niche' | 'state')
  const [filterTab, setFilterTab] = useState<'both' | 'niche' | 'state'>('both');

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Sincroniza quando filtros iniciais forem passados (ex: ao vir da busca)
  useEffect(() => {
    if (initialNicheFilter !== undefined) {
      setNicheFilter(initialNicheFilter || 'ALL');
      setPage(1);
    }
  }, [initialNicheFilter]);

  useEffect(() => {
    if (initialStateFilter !== undefined) {
      setStateFilter(initialStateFilter || 'ALL');
      setPage(1);
    }
  }, [initialStateFilter]);

  useEffect(() => {
    loadLeads();
    loadNiches();
    loadStates();
  }, [page, stateFilter, cityFilter, nicheFilter, statusFilter, onlyWithoutWebsite, onlyWithPhone, onlyFavorites, minScore, sortBy]);

  // Monitora se há buscas rodando em segundo plano e recarrega em tempo real
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const checkRunningJobs = async () => {
      try {
        const jobs = await api.getSearchJobs();
        const active = jobs.find((j) => j.status === 'running' || j.status === 'pending');
        if (active) {
          setRunningJob(active);
          loadLeads();
          loadNiches();
          loadStates();
        } else {
          setRunningJob((prev: any) => {
            if (prev) {
              loadLeads();
              loadNiches();
              loadStates();
            }
            return null;
          });
        }
      } catch (err) {
        console.warn('Erro ao verificar status das buscas:', err);
      }
    };

    checkRunningJobs();
    interval = setInterval(checkRunningJobs, 3000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, []);

  const loadNiches = async () => {
    try {
      const data = await api.getNiches({ onlyFavorites });
      setNiches(data);
    } catch (err) {
      console.error('Erro ao carregar categorias:', err);
    }
  };

  const loadStates = async () => {
    try {
      const data = await api.getStatesSummary({
        onlyFavorites,
        niche: nicheFilter !== 'ALL' ? nicheFilter : undefined,
      });
      setStatesSummary(data);
    } catch (err) {
      console.error('Erro ao carregar estados:', err);
    }
  };

  const loadLeads = async () => {
    setLoading(true);
    try {
      const data = await api.getLeads({
        state: stateFilter,
        city: cityFilter,
        niche: nicheFilter,
        status: statusFilter,
        onlyWithoutWebsite,
        onlyWithPhone,
        onlyFavorites,
        minScore: minScore > 0 ? minScore : undefined,
        search,
        sortBy,
        page,
        limit: 50,
      });

      setLeads(data.leads);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error('Erro ao carregar leads:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFavorite = async (e: React.MouseEvent, leadId: string) => {
    e.stopPropagation();
    // Otimista
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, is_favorite: !l.is_favorite } : l))
    );
    try {
      const updated = await api.toggleLeadFavorite(leadId);
      setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadLeads();
  };

  const markAsContacted = async (lead: Lead) => {
    try {
      const updated = await api.updateLead(lead.id, {
        pipeline_status: 'CONTATADO',
        contacted_at: new Date().toISOString(),
      });
      setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } catch (err) {
      console.error(err);
    }
  };

  const copyPhone = (id: string, phone?: string) => {
    if (!phone) return;
    navigator.clipboard.writeText(phone);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Exportar CSV
  const exportToCsv = () => {
    if (leads.length === 0) return;
    const headers = ['Nome', 'Cidade', 'Estado', 'Nicho', 'Nota', 'Avaliações', 'Telefone', 'Site', 'Score', 'Status', 'Maps'];
    const rows = leads.map((l) => [
      `"${l.name.replace(/"/g, '""')}"`,
      `"${l.city}"`,
      `"${l.state}"`,
      `"${l.niche}"`,
      l.rating.toFixed(1),
      l.reviews_count,
      `"${formatBrazilianPhone(l.phone)}"`,
      `"${l.website || 'Sem site'}"`,
      l.lead_score,
      `"${l.pipeline_status}"`,
      `"${l.maps_url || ''}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(';'), ...rows.map((e) => e.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `leads_prospeccao_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const hasActiveFilters =
    (nicheFilter && nicheFilter !== 'ALL') ||
    (stateFilter && stateFilter !== 'ALL') ||
    (cityFilter && cityFilter !== 'ALL') ||
    (statusFilter && statusFilter !== 'ALL') ||
    onlyWithoutWebsite ||
    onlyWithPhone ||
    onlyFavorites ||
    minScore > 0 ||
    Boolean(search && search.trim() !== '');

  const handleClearAllFilters = () => {
    setNicheFilter('ALL');
    setStateFilter('ALL');
    setCityFilter('ALL');
    setStatusFilter('ALL');
    setOnlyWithoutWebsite(false);
    setOnlyWithPhone(false);
    setOnlyFavorites(false);
    setMinScore(0);
    setSearch('');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Banner de Varredura em Andamento em Tempo Real */}
      {runningJob && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-blue-200 bg-blue-50/90 text-blue-900 shadow-2xs animate-pulse">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
              <RotateCw className="h-5 w-5 animate-spin" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-800">
                  Varredura Ativa no Google Maps
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-200 text-blue-900 border border-blue-300">
                  {runningJob.leads_created || 0} leads adicionados
                </span>
              </div>
              <p className="text-xs text-blue-700 mt-0.5">
                Processando <strong>{runningJob.niche}</strong> em{' '}
                <strong>{runningJob.city === 'all' ? `todas as cidades de ${runningJob.state}` : `${runningJob.city}, ${runningJob.state}`}</strong>. A base é atualizada automaticamente a cada 3 segundos.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadLeads}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-900 bg-white border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer shadow-2xs self-start sm:self-auto shrink-0"
          >
            <RotateCw className="h-3.5 w-3.5" />
            <span>Atualizar Agora</span>
          </button>
        </div>
      )}

      {/* 1. Barra de Abas de Categorias / Nichos & Estados / Regiões */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-2xs space-y-3.5">
        {/* Cabeçalho com Título & Seletor de Abas (Nichos vs Estados vs Ambos) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2.5 border-b border-neutral-100">
          <div className="flex items-center gap-2">
            <div className="inline-flex p-1 rounded-xl bg-neutral-100 border border-neutral-200/80">
              <button
                type="button"
                onClick={() => setFilterTab('both')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  filterTab === 'both'
                    ? 'bg-white text-neutral-900 shadow-2xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
                title="Visualizar nichos e estados simultaneamente"
              >
                <Layers className="h-3.5 w-3.5 text-indigo-600" />
                <span>Todos os Filtros</span>
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('niche')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  filterTab === 'niche'
                    ? 'bg-white text-neutral-900 shadow-2xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
                title="Filtrar estabelecimentos por segmento comercial"
              >
                <Tags className="h-3.5 w-3.5 text-neutral-700" />
                <span>Por Nicho</span>
                {nicheFilter !== 'ALL' && (
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('state')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  filterTab === 'state'
                    ? 'bg-white text-neutral-900 shadow-2xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
                title="Filtrar estabelecimentos por estado ou região do Brasil"
              >
                <MapPin className="h-3.5 w-3.5 text-blue-600" />
                <span>Por Estado / Região</span>
                {stateFilter !== 'ALL' && (
                  <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                )}
              </button>
            </div>
          </div>

          <span className="text-[11px] text-neutral-400 hidden sm:inline">
            Clique nas abas abaixo para isolar as lojas por nicho de mercado ou estado
          </span>
        </div>

        {/* LINHA 1: NICHOS & SEGMENTOS */}
        {(filterTab === 'niche' || filterTab === 'both') && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-neutral-500 font-medium">
              <span className="flex items-center gap-1.5 uppercase font-bold tracking-wider text-neutral-700 text-[10px]">
                <Tags className="h-3 w-3 text-amber-500" />
                Segmentos Comerciais
              </span>
              {nicheFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => {
                    setNicheFilter('ALL');
                    setPage(1);
                  }}
                  className="text-neutral-400 hover:text-neutral-800 text-[10px] underline cursor-pointer"
                >
                  Ver todos os nichos
                </button>
              )}
            </div>

            {/* Abas com scroll horizontal suave */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
              {/* Aba: Todas as Categorias */}
              <button
                type="button"
                onClick={() => {
                  setNicheFilter('ALL');
                  setPage(1);
                }}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                  nicheFilter === 'ALL' && !onlyFavorites
                    ? 'bg-neutral-900 text-white shadow-xs'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200/80 hover:text-neutral-900'
                }`}
              >
                <Store className="h-3.5 w-3.5" />
                <span>Todas as Categorias</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    nicheFilter === 'ALL' && !onlyFavorites ? 'bg-white/20 text-white' : 'bg-neutral-200 text-neutral-700'
                  }`}
                >
                  {niches.reduce((acc, curr) => acc + curr.count, 0) || total}
                </span>
              </button>

              {/* Aba Especial: Favoritos */}
              <button
                type="button"
                onClick={() => {
                  setOnlyFavorites(!onlyFavorites);
                  setPage(1);
                }}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                  onlyFavorites
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                }`}
                title="Mostrar apenas leads marcados como favoritos"
              >
                <Heart className={`h-3.5 w-3.5 ${onlyFavorites ? 'fill-white text-white' : 'fill-rose-500 text-rose-500'}`} />
                <span>Favoritos</span>
                {onlyFavorites && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/20 text-white">
                    Filtro Ativo
                  </span>
                )}
              </button>

              {/* Abas dinâmicas por nicho */}
              {niches.map((item) => {
                const Icon = getNicheIcon(item.niche);
                const isSelected = nicheFilter.toLowerCase() === item.niche.toLowerCase();
                return (
                  <button
                    key={item.niche}
                    type="button"
                    onClick={() => {
                      setNicheFilter(item.niche);
                      setPage(1);
                    }}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-neutral-900 text-white shadow-xs'
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200/80 hover:text-neutral-900'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-amber-400' : 'text-neutral-500'}`} />
                    <span>{item.niche}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-neutral-200 text-neutral-700'
                      }`}
                    >
                      {item.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* LINHA 2: ESTADOS & REGIÕES DO BRASIL */}
        {(filterTab === 'state' || filterTab === 'both') && (
          <div className="space-y-1.5 pt-1 border-t border-neutral-100/80">
            <div className="flex items-center justify-between text-[11px] text-neutral-500 font-medium">
              <span className="flex items-center gap-1.5 uppercase font-bold tracking-wider text-neutral-700 text-[10px]">
                <MapPin className="h-3 w-3 text-blue-600" />
                Região & Estados do Brasil
              </span>
              {stateFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => {
                    setStateFilter('ALL');
                    setPage(1);
                  }}
                  className="text-neutral-400 hover:text-neutral-800 text-[10px] underline cursor-pointer"
                >
                  Ver todos os estados
                </button>
              )}
            </div>

            {/* Abas dinâmicas por estado com scroll suave */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
              {/* Todos os Estados */}
              <button
                type="button"
                onClick={() => {
                  setStateFilter('ALL');
                  setPage(1);
                }}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                  stateFilter === 'ALL'
                    ? 'bg-neutral-900 text-white shadow-xs'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200/80 hover:text-neutral-900'
                }`}
              >
                <span>🇧🇷 Todos os Estados</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    stateFilter === 'ALL' ? 'bg-white/20 text-white' : 'bg-neutral-200 text-neutral-700'
                  }`}
                >
                  {statesSummary.reduce((acc, curr) => acc + curr.count, 0) || total}
                </span>
              </button>

              {/* Abas dos estados presentes na base de dados */}
              {statesSummary.map((item) => {
                const uf = item.state.toUpperCase();
                const fullName = STATE_NAMES[uf] || uf;
                const isSelected = stateFilter.toUpperCase() === uf;

                return (
                  <button
                    key={uf}
                    type="button"
                    onClick={() => {
                      setStateFilter(uf);
                      setPage(1);
                    }}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-blue-50/60 text-blue-900 border border-blue-200/60 hover:bg-blue-100 hover:text-blue-950'
                    }`}
                  >
                    <MapPin className={`h-3.5 w-3.5 ${isSelected ? 'text-amber-300' : 'text-blue-600'}`} />
                    <span>{fullName} ({uf})</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {item.count}
                    </span>
                  </button>
                );
              })}

              {/* Seletor rápido para qualquer outro estado da federação */}
              <div className="shrink-0 flex items-center gap-1.5 pl-1">
                <select
                  value={statesSummary.some((s) => s.state.toUpperCase() === stateFilter.toUpperCase()) ? '' : stateFilter}
                  onChange={(e) => {
                    if (e.target.value) {
                      setStateFilter(e.target.value);
                      setPage(1);
                    }
                  }}
                  className="rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 shadow-2xs focus:border-neutral-900 focus:outline-hidden cursor-pointer"
                >
                  <option value="">+ Outro Estado</option>
                  {BRAZILIAN_STATES.map((st) => (
                    <option key={st.sigla} value={st.sigla}>
                      {st.nome} ({st.sigla})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Indicador de Filtros Ativos (Categoria / Estado / Favoritos) */}
        {(nicheFilter !== 'ALL' || stateFilter !== 'ALL' || onlyFavorites) && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-neutral-100 text-xs text-neutral-600">
            <div className="flex flex-wrap items-center gap-2">
              {nicheFilter !== 'ALL' && (
                <span className="inline-flex items-center gap-1.5 bg-neutral-100 text-neutral-800 px-2.5 py-1 rounded-lg font-medium border border-neutral-200">
                  <Tags className="h-3 w-3 text-neutral-500" />
                  Nicho: <strong className="text-neutral-900">{nicheFilter}</strong>
                </span>
              )}
              {stateFilter !== 'ALL' && (
                <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-800 border border-blue-200 px-2.5 py-1 rounded-lg font-medium">
                  <MapPin className="h-3 w-3 text-blue-600" />
                  Estado: <strong className="text-blue-900">{STATE_NAMES[stateFilter.toUpperCase()] || stateFilter} ({stateFilter.toUpperCase()})</strong>
                </span>
              )}
              {onlyFavorites && (
                <span className="inline-flex items-center gap-1.5 font-semibold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
                  <Heart className="h-3 w-3 fill-rose-500 text-rose-500" />
                  Apenas Favoritos
                </span>
              )}
              <span className="text-neutral-400 font-mono">({total} lojas encontradas)</span>
            </div>

            <button
              type="button"
              onClick={() => {
                setNicheFilter('ALL');
                setStateFilter('ALL');
                setCityFilter('ALL');
                setOnlyFavorites(false);
                setPage(1);
              }}
              className="text-[11px] font-medium text-neutral-500 hover:text-neutral-900 underline cursor-pointer"
            >
              Limpar filtros de categoria/estado
            </button>
          </div>
        )}
      </div>

      {/* 2. Barra de Filtros, Pesquisa e Alternador de Visão */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Busca por texto */}
          <form onSubmit={handleSearchSubmit} className="relative flex-1 w-full">
            <input
              type="text"
              placeholder="Buscar por nome da loja, cidade ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 pl-9 pr-4 py-2 text-xs text-neutral-800 placeholder-neutral-400 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
            />
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
          </form>

          {/* Alternador de Visualização & Botões */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            {/* Segmented Control: Vitrine vs Tabela */}
            <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-lg border border-neutral-200/80">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === 'cards'
                    ? 'bg-white text-neutral-900 shadow-2xs font-semibold'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
                title="Ver lojas em cards visuais"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>Vitrine de Lojas</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === 'table'
                    ? 'bg-white text-neutral-900 shadow-2xs font-semibold'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
                title="Ver em tabela compacta"
              >
                <List className="h-3.5 w-3.5" />
                <span>Tabela</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                loadLeads();
                loadNiches();
                loadStates();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors shadow-2xs shrink-0 cursor-pointer"
              title="Recarregar dados da lista"
            >
              <RotateCw className="h-3.5 w-3.5 text-neutral-600" />
              <span className="hidden md:inline">Atualizar</span>
            </button>

            <button
              type="button"
              onClick={exportToCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors shadow-2xs shrink-0"
              title="Exportar para planilha Excel / CSV"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-neutral-600" />
              <span className="hidden md:inline">Exportar</span>
            </button>

            {onStartSpeedOutreach && (
              <button
                type="button"
                onClick={onStartSpeedOutreach}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-neutral-950 bg-amber-400 hover:bg-amber-300 active:scale-95 rounded-lg transition-all shadow-xs shrink-0 cursor-pointer"
                title="Abrir Esteira Relâmpago para prospecção em alta velocidade"
              >
                <Zap className="h-3.5 w-3.5 fill-neutral-950" />
                <span>Esteira 1-Click</span>
              </button>
            )}
          </div>
        </div>

        {/* Dropdowns de Filtragem */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 pt-2 border-t border-neutral-100">
          {/* Ordenação */}
          <div>
            <label className="block text-[10px] font-medium text-neutral-400 mb-1">Ordenar por</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-700 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
            >
              <option value="score">Maior Score Comercial</option>
              <option value="reviews">Mais avaliações</option>
              <option value="rating">Maior nota</option>
              <option value="recent">Mais recentes</option>
            </select>
          </div>

          {/* Estado / UF */}
          <div>
            <label className="block text-[10px] font-medium text-neutral-400 mb-1">Estado (UF)</label>
            <select
              value={stateFilter}
              onChange={(e) => {
                setStateFilter(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-700 shadow-2xs focus:border-neutral-900 focus:outline-hidden font-medium"
            >
              <option value="ALL">Todos os estados</option>
              {BRAZILIAN_STATES.map((st) => (
                <option key={st.sigla} value={st.sigla}>
                  {st.nome} ({st.sigla})
                </option>
              ))}
            </select>
          </div>

          {/* Status Pipeline */}
          <div>
            <label className="block text-[10px] font-medium text-neutral-400 mb-1">Status Funil</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-700 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
            >
              <option value="ALL">Todos os status</option>
              <option value="NOVO">NOVO</option>
              <option value="PRÉVIA CRIADA">PRÉVIA CRIADA</option>
              <option value="CONTATADO">CONTATADO</option>
              <option value="RESPONDEU">RESPONDEU</option>
              <option value="INTERESSADO">INTERESSADO</option>
              <option value="FECHADO">FECHADO</option>
            </select>
          </div>

          {/* Score Mínimo */}
          <div>
            <label className="block text-[10px] font-medium text-neutral-400 mb-1">Prioridade / Score</label>
            <select
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-700 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
            >
              <option value={0}>Todos os scores</option>
              <option value={40}>Boa oportunidade (40+)</option>
              <option value={70}>Alta oportunidade (70+)</option>
            </select>
          </div>

          {/* Sem site */}
          <div className="flex items-end pb-1.5">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-700">
              <input
                type="checkbox"
                checked={onlyWithoutWebsite}
                onChange={(e) => setOnlyWithoutWebsite(e.target.checked)}
                className="rounded-sm border-neutral-300 text-neutral-900 focus:ring-neutral-900"
              />
              <span className="font-medium text-[11px]">Apenas sem site</span>
            </label>
          </div>

          {/* Com telefone */}
          <div className="flex items-end pb-1.5">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-700">
              <input
                type="checkbox"
                checked={onlyWithPhone}
                onChange={(e) => setOnlyWithPhone(e.target.checked)}
                className="rounded-sm border-neutral-300 text-neutral-900 focus:ring-neutral-900"
              />
              <span className="font-medium text-[11px]">Apenas c/ telefone</span>
            </label>
          </div>

          {/* Apenas favoritos */}
          <div className="flex items-end pb-1.5">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-700">
              <input
                type="checkbox"
                checked={onlyFavorites}
                onChange={(e) => {
                  setOnlyFavorites(e.target.checked);
                  setPage(1);
                }}
                className="rounded-sm border-neutral-300 text-rose-600 focus:ring-rose-500"
              />
              <span className="font-medium text-[11px] text-rose-700 flex items-center gap-1">
                <Heart className={`h-3 w-3 ${onlyFavorites ? 'fill-rose-500' : ''}`} />
                Apenas favoritos
              </span>
            </label>
          </div>
        </div>

        {/* Rodapé da barra de filtros com contador */}
        <div className="flex items-center justify-between pt-1 text-xs text-neutral-500 font-mono border-t border-neutral-100">
          <div>
            {stateFilter !== 'ALL' && (
              <span className="text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded font-sans font-medium text-[11px]">
                📍 Estado ativo: {STATE_NAMES[stateFilter.toUpperCase()] || stateFilter} ({stateFilter.toUpperCase()})
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            Total: <span className="font-bold text-neutral-900 ml-1 tabular-nums">{total} lojas</span>
          </div>
        </div>
      </div>

      {/* Faixa de Filtros Ativos com 1-Click para Limpar */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-amber-200 bg-amber-50/80 text-amber-950 text-xs shadow-2xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-neutral-900 flex items-center gap-1">
              <Filter className="h-3.5 w-3.5 text-amber-700" />
              Filtros ativos:
            </span>
            {nicheFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-amber-300 font-semibold text-neutral-900 shadow-2xs">
                🏷️ Nicho: {nicheFilter}
              </span>
            )}
            {stateFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-amber-300 font-semibold text-neutral-900 shadow-2xs">
                📍 Estado: {STATE_NAMES[stateFilter.toUpperCase()] || stateFilter} ({stateFilter.toUpperCase()})
              </span>
            )}
            {cityFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-amber-300 font-semibold text-neutral-900 shadow-2xs">
                🏙️ Cidade: {cityFilter}
              </span>
            )}
            {statusFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-amber-300 font-semibold text-neutral-900 shadow-2xs">
                📌 Status: {statusFilter}
              </span>
            )}
            {onlyWithoutWebsite && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-amber-300 font-semibold text-neutral-900 shadow-2xs">
                🌐 Apenas sem site
              </span>
            )}
            {onlyWithPhone && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-amber-300 font-semibold text-neutral-900 shadow-2xs">
                📞 Apenas c/ telefone
              </span>
            )}
            {minScore > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-amber-300 font-semibold text-neutral-900 shadow-2xs">
                ⭐ Score {minScore}+
              </span>
            )}
            {search && search.trim() !== '' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-amber-300 font-semibold text-neutral-900 shadow-2xs">
                🔍 "{search}"
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleClearAllFilters}
            className="flex items-center gap-1 text-xs font-bold text-neutral-950 bg-amber-300 hover:bg-amber-400 px-3 py-1.5 rounded-lg transition-all cursor-pointer shadow-2xs shrink-0"
          >
            <RotateCw className="h-3 w-3" />
            <span>Limpar Filtros e Ver Todos</span>
          </button>
        </div>
      )}

      {/* Conteúdo: Vitrine de Lojas em Cards ou Tabela */}
      {loading ? (
        <div className="py-20 text-center text-xs text-neutral-400 flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white">
          <RotateCw className="h-4 w-4 animate-spin text-neutral-500" />
          <span>Carregando estabelecimentos e dados do Maps...</span>
        </div>
      ) : leads.length === 0 ? (
        <div className="py-16 text-center space-y-3 rounded-xl border border-neutral-200 bg-white p-6 shadow-2xs">
          <Globe className="h-10 w-10 text-neutral-300 mx-auto" />
          <h4 className="text-sm font-bold text-neutral-900">
            Nenhuma loja encontrada com os filtros selecionados
          </h4>
          <p className="text-xs text-neutral-500 max-w-md mx-auto">
            {hasActiveFilters
              ? 'Os filtros atuais (nicho, estado ou opções de site/telefone) restringiram todos os resultados. Clique abaixo para limpar os filtros e visualizar todas as lojas da sua base comercial.'
              : 'Nenhum lead cadastrado no momento. Use o menu "Buscar Leads" para prospectar novas lojas via Google Maps.'}
          </p>
          {hasActiveFilters && (
            <div className="pt-2">
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg transition-all cursor-pointer shadow-xs"
              >
                <RotateCw className="h-3.5 w-3.5" />
                <span>Limpar Filtros e Ver Todos os Leads</span>
              </button>
            </div>
          )}
        </div>
      ) : viewMode === 'cards' ? (
        /* MODO 1: VITRINE DE LOJAS (CARDS RICOS E BONITOS) */
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {leads.map((lead) => {
              const { badgeBg } = getScoreColorClass(lead.lead_score);
              const waUrl = getWhatsAppUrl(lead.phone, lead.name, lead.niche);
              const NicheIcon = getNicheIcon(lead.niche);
              const mapsUrl = lead.maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lead.name} ${lead.address || `${lead.city} ${lead.state}`}`)}`;

              return (
                <div
                  key={lead.id}
                  onClick={() => onSelectLead(lead)}
                  className="group rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xs hover:border-neutral-350 hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between space-y-4 relative overflow-hidden"
                >
                  {/* Topo do Card com Ícone, Categoria e Score */}
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-900 text-white shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
                          <NicheIcon className="h-5 w-5 text-amber-400" />
                        </div>
                        <div>
                          <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">
                            {lead.niche}
                          </span>
                          <span className="text-[11px] text-neutral-400 font-mono">
                            {lead.city} - {lead.state}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleToggleFavorite(e, lead.id)}
                          className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                            lead.is_favorite
                              ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                              : 'text-neutral-300 hover:text-rose-500 hover:bg-neutral-100'
                          }`}
                          title={lead.is_favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                        >
                          <Heart
                            className={`h-4 w-4 transition-transform ${
                              lead.is_favorite ? 'fill-rose-500 text-rose-500 scale-110' : ''
                            }`}
                          />
                        </button>

                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-bold border ${badgeBg}`}
                        >
                          Score {lead.lead_score}
                        </span>
                      </div>
                    </div>

                    {/* Nome da Loja */}
                    <div>
                      <h3 className="text-sm font-bold text-neutral-900 group-hover:text-black line-clamp-1 tracking-tight">
                        {lead.name}
                      </h3>
                      <p className="text-[11px] text-neutral-500 line-clamp-1 mt-0.5 flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-neutral-400 shrink-0" />
                        <span>{lead.address || `${lead.city} - ${lead.state}`}</span>
                      </p>
                    </div>

                    {/* Avaliação Google Places com Estrelas */}
                    <div className="flex items-center justify-between rounded-lg bg-neutral-50 p-2.5 border border-neutral-100 text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="flex text-amber-400">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`h-3.5 w-3.5 ${
                                star <= Math.round(lead.rating)
                                  ? 'fill-amber-400 text-amber-400'
                                  : 'text-neutral-200'
                              }`}
                            />
                          ))}
                        </div>
                        <span className="font-bold text-neutral-900 font-mono tabular-nums">
                          {lead.rating.toFixed(1)}
                        </span>
                        <span className="text-neutral-400 text-[10px] font-mono">
                          ({lead.reviews_count})
                        </span>
                      </div>

                      <span className="text-[10px] font-bold text-amber-800 bg-amber-100/60 px-2 py-0.5 rounded">
                        Sem site
                      </span>
                    </div>

                    {/* Telefone Formatado com Copiar */}
                    <div className="flex items-center justify-between text-xs" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 font-mono text-neutral-800 font-medium">
                        <Phone className="h-3.5 w-3.5 text-neutral-400" />
                        <span>{formatBrazilianPhone(lead.phone)}</span>
                      </div>

                      {lead.phone && (
                        <button
                          type="button"
                          onClick={() => copyPhone(lead.id, lead.phone)}
                          className="text-[10px] text-neutral-500 hover:text-neutral-900 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-neutral-100"
                        >
                          {copiedId === lead.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" />
                              <span className="text-emerald-700">Copiado</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copiar</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Botões de Ação Imediata: Maps + WhatsApp */}
                  <div
                    className="pt-3 border-t border-neutral-150 grid grid-cols-2 gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Botão Ver no Google Maps */}
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-neutral-800 bg-white hover:bg-neutral-100 border border-neutral-250 rounded-xl transition-colors shadow-2xs group/btn"
                    >
                      <Compass className="h-3.5 w-3.5 text-red-500 group-hover/btn:scale-110 transition-transform" />
                      <span>Ver no Maps</span>
                    </a>

                    {/* Botão WhatsApp */}
                    {waUrl ? (
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-xs"
                      >
                        <MessageCircle className="h-3.5 w-3.5 fill-white" />
                        <span>WhatsApp</span>
                      </a>
                    ) : (
                      <button
                        onClick={() => onSelectLead(lead)}
                        className="py-2 px-3 text-xs font-medium text-neutral-500 bg-neutral-100 rounded-xl"
                      >
                        Ver Detalhes
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Paginação */}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-neutral-200 bg-white text-xs text-neutral-600 shadow-2xs">
            <span className="font-mono tabular-nums">
              Página {page} de {totalPages} ({total} lojas encontradas)
            </span>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* MODO 2: TABELA DE ALTA DENSIDADE */
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-neutral-700 divide-y divide-neutral-200">
              <thead className="bg-neutral-50/80 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Estabelecimento</th>
                  <th className="px-4 py-3">Localização</th>
                  <th className="px-3 py-3">Nicho</th>
                  <th className="px-3 py-3">Avaliações Google</th>
                  <th className="px-3 py-3">Telefone</th>
                  <th className="px-3 py-3">Website</th>
                  <th className="px-3 py-3 text-center">Score</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações Rápidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {leads.map((lead) => {
                  const { badgeBg } = getScoreColorClass(lead.lead_score);
                  const waUrl = getWhatsAppUrl(lead.phone, lead.name, lead.niche);
                  const mapsUrl = lead.maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lead.name} ${lead.address || `${lead.city} ${lead.state}`}`)}`;

                  return (
                    <tr
                      key={lead.id}
                      className="hover:bg-neutral-50/70 transition-colors group cursor-pointer"
                      onClick={() => onSelectLead(lead)}
                    >
                      {/* Empresa */}
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        <div className="truncate max-w-[200px] font-semibold" title={lead.name}>
                          {lead.name}
                        </div>
                        <div className="text-[11px] text-neutral-400 font-mono truncate max-w-[200px]">
                          {lead.address || 'Endereço não informado'}
                        </div>
                      </td>

                      {/* Localização */}
                      <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">
                        {lead.city} - {lead.state}
                      </td>

                      {/* Nicho */}
                      <td className="px-3 py-3 text-neutral-600 whitespace-nowrap">
                        {lead.niche}
                      </td>

                      {/* Avaliações Google */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="font-mono tabular-nums text-neutral-900 font-semibold flex items-center gap-1">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          <span>{lead.rating.toFixed(1)}</span>
                        </div>
                        <div className="text-[11px] text-neutral-400 font-mono tabular-nums">
                          {lead.reviews_count} avaliações
                        </div>
                      </td>

                      {/* Telefone */}
                      <td className="px-3 py-3 font-mono whitespace-nowrap text-neutral-800">
                        {formatBrazilianPhone(lead.phone)}
                      </td>

                      {/* Site */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        {lead.website ? (
                          <span className="text-neutral-500 truncate max-w-[100px] block" title={lead.website}>
                            Possui site
                          </span>
                        ) : (
                          <span className="text-amber-800 font-medium">Sem site</span>
                        )}
                      </td>

                      {/* Score Comercial */}
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border ${badgeBg}`}
                        >
                          {lead.lead_score}
                        </span>
                      </td>

                      {/* Status Funil */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-neutral-100 text-neutral-700">
                          {lead.pipeline_status}
                        </span>
                      </td>

                      {/* Ações */}
                      <td
                        className="px-4 py-3 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => handleToggleFavorite(e, lead.id)}
                            title={lead.is_favorite ? 'Remover dos favoritos' : 'Favoritar lead'}
                            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                              lead.is_favorite
                                ? 'text-rose-600 bg-rose-50 hover:bg-rose-100'
                                : 'text-neutral-400 hover:text-rose-600 hover:bg-neutral-100'
                            }`}
                          >
                            <Heart className={`h-4 w-4 ${lead.is_favorite ? 'fill-rose-500' : ''}`} />
                          </button>

                          {mapsUrl && (
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Abrir no Google Maps"
                              className="p-1.5 text-neutral-600 hover:text-red-600 hover:bg-neutral-100 rounded-md transition-colors"
                            >
                              <Compass className="h-4 w-4" />
                            </a>
                          )}

                          {waUrl && (
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Abrir WhatsApp"
                              className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-md transition-colors"
                            >
                              <MessageCircle className="h-4 w-4" />
                            </a>
                          )}

                          <button
                            onClick={() => markAsContacted(lead)}
                            title="Marcar como contatado"
                            className="p-1.5 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-md transition-colors"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Paginação Tabela */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-200/80 bg-neutral-50/50 text-xs text-neutral-600">
            <span className="font-mono tabular-nums">
              Página {page} de {totalPages} ({total} lojas)
            </span>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1 rounded border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1 rounded border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
