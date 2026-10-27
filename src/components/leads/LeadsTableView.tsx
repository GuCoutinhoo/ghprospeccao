import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createLeadMutationQueue } from '../../lib/leadMutationQueue';
import {
  Search,
  Filter,
  ArrowUpDown,
  ExternalLink,
  MessageCircle,
  Phone,
  Eye,
  EyeOff,
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
  Trash2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { Lead, PipelineStatus, UserRole, Freelancer } from '../../types';
import { api } from '../../lib/api';
import { getScoreColorClass } from '../../lib/scoring/leadScore';
import { formatBrazilianPhone, getWhatsAppUrl } from '../../utils/whatsapp';
import { BRAZILIAN_STATES } from '../../lib/ibge/ibgeService';
import { resolveRatingRange } from '../../lib/search/ratingFilter';

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
  initialSearchJobId?: string;
  onClearInitialFilters?: () => void;
  onStartSpeedOutreach?: () => void;
  onNavigateToSearch?: () => void;
  userRole?: UserRole;
  activeFreelancer?: Freelancer | null;
  refreshTrigger?: number;
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
  initialSearchJobId,
  onClearInitialFilters,
  onStartSpeedOutreach,
  onNavigateToSearch,
  userRole = 'admin',
  activeFreelancer,
  refreshTrigger,
}) => {
  const effectiveFreelancerId = userRole === 'freelancer'
    ? (activeFreelancer?.id || (activeFreelancer?.access_code ? `free_${activeFreelancer.access_code}` : undefined))
    : undefined;

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [total, setTotal] = useState<number>(0);
  const [totalOverallLeads, setTotalOverallLeads] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  // Tamanho da página: 0 = Sem limite (exibe todos os leads sem paginação)
  const [pageSize, setPageSize] = useState<number>(0);

  // Modo de visualização: 'cards' (Vitrine de Lojas) ou 'table' (Tabela de Dados)
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  // Filtros
  const [search, setSearch] = useState<string>('');
  const [activeSearch, setActiveSearch] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<string>(initialStateFilter || 'ALL');
  const [cityFilter, setCityFilter] = useState<string>('ALL');
  const [nicheFilter, setNicheFilter] = useState<string>(initialNicheFilter || 'ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [ratingFilter, setRatingFilter] = useState<string>('ALL');
  const [onlyWithoutWebsite, setOnlyWithoutWebsite] = useState<boolean>(false);
  const [onlyWithPhone, setOnlyWithPhone] = useState<boolean>(false);
  const [onlyFavorites, setOnlyFavorites] = useState<boolean>(false);
  const [excludeHidden, setExcludeHidden] = useState<boolean>(false);
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

  // Estados para exclusão de leads (individual e em massa)
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const [showConfirmDeleteAll, setShowConfirmDeleteAll] = useState<boolean>(false);
  const [deleteGlobalScope, setDeleteGlobalScope] = useState<boolean>(false);
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Garante uma nova consulta mesmo quando o usuário já está com todos os filtros limpos.
  const [filterResetVersion, setFilterResetVersion] = useState(0);

  // Ref sempre atualizada com os filtros vigentes para evitar closures defasadas
  const latestFiltersRef = useRef({
    initialSearchJobId,
    effectiveFreelancerId,
    stateFilter,
    cityFilter,
    nicheFilter,
    statusFilter,
    ratingFilter,
    onlyWithoutWebsite,
    onlyWithPhone,
    onlyFavorites,
    excludeHidden,
    minScore,
    search: activeSearch,
    sortBy,
    page,
    pageSize,
  });

  latestFiltersRef.current = {
    initialSearchJobId,
    effectiveFreelancerId,
    stateFilter,
    cityFilter,
    nicheFilter,
    statusFilter,
    ratingFilter,
    onlyWithoutWebsite,
    onlyWithPhone,
    onlyFavorites,
    excludeHidden,
    minScore,
    search: activeSearch,
    sortBy,
    page,
    pageSize,
  };

  const requestIdRef = useRef(0);
  // Impede que respostas antigas da atualização automática desfaçam uma ocultação pendente.
  const pendingHideRef = useRef(new Map<string, boolean>());
  const mutationQueuesRef = useRef(new Map<string, ReturnType<typeof createLeadMutationQueue>>());
  const enqueueLeadMutation = <T,>(leadId: string, operation: () => Promise<T>) => {
    let enqueue = mutationQueuesRef.current.get(leadId);
    if (!enqueue) {
      enqueue = createLeadMutationQueue();
      mutationQueuesRef.current.set(leadId, enqueue);
    }
    return enqueue(operation);
  };
  const [hidingLeadIds, setHidingLeadIds] = useState<string[]>([]);

  const loadLeads = useCallback(async (silent = false) => {
    const thisRequestId = ++requestIdRef.current;
    if (!silent) {
      setLoading(true);
    }
    const current = latestFiltersRef.current;

    let minRatingVal: number | undefined = undefined;
    let maxRatingVal: number | undefined = undefined;
    if (current.ratingFilter && current.ratingFilter !== 'ALL') {
      const resolved = resolveRatingRange(current.ratingFilter);
      minRatingVal = resolved.minRating > 0 ? resolved.minRating : undefined;
      maxRatingVal = resolved.maxRating;
    }

    try {
      const data = await api.getLeads({
        search_job_id: current.initialSearchJobId,
        freelancer_id: current.effectiveFreelancerId,
        state: current.stateFilter,
        city: current.cityFilter,
        niche: current.nicheFilter,
        status: current.statusFilter,
        minRating: minRatingVal,
        maxRating: maxRatingVal,
        onlyWithoutWebsite: current.onlyWithoutWebsite,
        onlyWithPhone: current.onlyWithPhone,
        onlyFavorites: current.onlyFavorites,
        excludeHidden: current.excludeHidden,
        minScore: current.minScore > 0 ? current.minScore : undefined,
        search: current.search,
        sortBy: current.sortBy,
        page: current.page,
        limit: current.pageSize,
      });

      // Se uma requisição mais recente já disparou, descarta a resposta defasada
      if (thisRequestId !== requestIdRef.current) return;

      // Atualiza os leads com a resposta exata do servidor
      setLeads((data.leads || []).map((lead) => pendingHideRef.current.has(lead.id)
        ? { ...lead, is_hidden: pendingHideRef.current.get(lead.id)! }
        : lead));
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages || 1);
      setLoadError(null);
    } catch (err) {
      if (thisRequestId === requestIdRef.current) {
        console.error('Erro ao carregar leads:', err);
        // Em falha de consulta, jamais limpa os dados válidos que já estão na tela
        setLoadError('Não foi possível consultar os leads deste workspace agora. Nenhum registro foi apagado. Tente novamente.');
      }
    } finally {
      if (thisRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // O loading termina com a resposta (ou falha) da API, nunca por um timer
  // que poderia exibir falsamente "nenhuma loja" durante uma consulta lenta.

  const loadNiches = useCallback(async () => {
    try {
      const current = latestFiltersRef.current;
      const data = await api.getNiches({
        onlyFavorites: current.onlyFavorites,
        freelancer_id: current.effectiveFreelancerId,
      });
      setNiches(data);
    } catch (err) {
      console.error('Erro ao carregar categorias:', err);
    }
  }, []);

  const loadStates = useCallback(async () => {
    try {
      const current = latestFiltersRef.current;
      const data = await api.getStatesSummary({
        onlyFavorites: current.onlyFavorites,
        niche: current.nicheFilter !== 'ALL' ? current.nicheFilter : undefined,
        freelancer_id: current.effectiveFreelancerId,
      });
      setStatesSummary(data);
    } catch (err) {
      console.error('Erro ao carregar estados:', err);
    }
  }, []);

  // Sincroniza quando filtros iniciais forem passados (ex: ao vir da busca)
  useEffect(() => {
    if (initialNicheFilter && initialNicheFilter !== 'ALL') {
      setNicheFilter(initialNicheFilter);
      setPage(1);
    }
  }, [initialNicheFilter]);

  useEffect(() => {
    if (initialStateFilter && initialStateFilter !== 'ALL') {
      setStateFilter(initialStateFilter);
      setPage(1);
    }
  }, [initialStateFilter]);

  useEffect(() => {
    loadLeads(false);
    loadNiches();
    loadStates();
  }, [
    initialSearchJobId,
    effectiveFreelancerId,
    page,
    pageSize,
    stateFilter,
    cityFilter,
    nicheFilter,
    statusFilter,
    ratingFilter,
    onlyWithoutWebsite,
    onlyWithPhone,
    onlyFavorites,
    excludeHidden,
    minScore,
    sortBy,
    activeSearch,
    refreshTrigger,
    filterResetVersion,
    loadLeads,
    loadNiches,
    loadStates,
  ]);

  // Carrega contagem global no início
  useEffect(() => {
    api.getLeads({ freelancer_id: effectiveFreelancerId, limit: 1 }).then((res) => {
      if (res && typeof res.total === 'number') {
        setTotalOverallLeads(res.total);
      }
    }).catch(() => {});
  }, [effectiveFreelancerId]);

  // Monitora se há buscas rodando em segundo plano e recarrega silenciosamente em tempo real
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let isChecking = false;

    const checkRunningJobs = async () => {
      if (isChecking) return;
      isChecking = true;
      try {
        const jobs = await api.getSearchJobs();
        const now = Date.now();
        const active = jobs.find((j) => {
          if (j.status !== 'running' && j.status !== 'pending') return false;
          const lastUpdate = j.updated_at ? new Date(j.updated_at).getTime() : new Date(j.created_at).getTime();
          // Ignora jobs zumbis que não têm atividade há mais de 8 minutos
          return (now - lastUpdate) <= 8 * 60 * 1000;
        });

        if (active) {
          setRunningJob(active);
          // Atualização silenciosa: não desmonta cards nem ativa tela cheia de loading
          await loadLeads(true);
        } else {
          setRunningJob((prev: any) => {
            if (prev) {
              loadLeads(true);
              loadNiches();
              loadStates();
            }
            return null;
          });
        }
      } catch (err) {
        console.warn('Erro ao verificar status das buscas:', err);
      } finally {
        isChecking = false;
      }
    };

    checkRunningJobs();
    interval = setInterval(checkRunningJobs, 5000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [effectiveFreelancerId, loadLeads, loadNiches, loadStates]);

  const handleCancelRunningJob = async (jobId: string) => {
    try {
      await api.cancelSearchJob(jobId);
      setRunningJob(null);
      await loadLeads(false);
    } catch (err) {
      console.error('Erro ao cancelar varredura:', err);
      setRunningJob(null);
    }
  };

  const handleToggleFavorite = async (e: React.MouseEvent, leadId: string) => {
    e.stopPropagation();
    try {
      await enqueueLeadMutation(leadId, async () => {
        const updated = await api.toggleLeadFavorite(leadId);
        setLeads((prev) => prev.map((l) => (l.id === leadId
          ? { ...l, ...updated, is_hidden: pendingHideRef.current.get(leadId) ?? updated.is_hidden }
          : l)));
      });
    } catch (err) {
      console.error('Erro ao salvar favorito:', err);
      setToastMessage({type:'error',text:'Não foi possível salvar o favorito. Tente novamente.'});
    }
  };

  const handleToggleHide = async (e: React.MouseEvent, leadId: string) => {
    e.stopPropagation();
    const targetLead = leads.find((l) => l.id === leadId);
    if (!targetLead || pendingHideRef.current.has(leadId)) return;
    const newHiddenState = !targetLead.is_hidden;
    pendingHideRef.current.set(leadId, Boolean(targetLead.is_hidden));
    setHidingLeadIds((prev) => [...prev, leadId]);
    // Descarta carregamentos iniciados antes da ação do usuário.
    requestIdRef.current += 1;

    // Não apresenta o lead como oculto antes de o servidor confirmar a gravação.
    // Se o usuário atualizar a página durante a requisição, a UI não terá
    // informado incorretamente que uma ocultação não persistida foi concluída.

    try {
      await enqueueLeadMutation(leadId, async () => {
        const updated = await api.toggleLeadHide(leadId, newHiddenState);
        requestIdRef.current += 1;
        pendingHideRef.current.set(leadId, updated.is_hidden);
        setLeads((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, ...updated } : l))
        );
        setToastMessage({
          type: 'success',
          text: newHiddenState
            ? `"${targetLead.name}" ocultado e salvo com sucesso.`
            : `"${targetLead.name}" reexibido e salvo com sucesso.`,
        });
        // Confere o estado persistido, inclusive durante varreduras simultâneas.
        await loadLeads(true);
      });
    } catch (err) {
      console.error('Erro ao alternar ocultação do lead:', err);
      pendingHideRef.current.delete(leadId);
      requestIdRef.current += 1;
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, is_hidden: targetLead.is_hidden } : l)));
      setToastMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'A ocultação não foi salva. Tente novamente.',
      });
      await loadLeads(true);
    } finally {
      pendingHideRef.current.delete(leadId);
      setHidingLeadIds((prev) => prev.filter((id) => id !== leadId));
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveSearch(search.trim());
    setPage(1);
  };

  const markAsContacted = async (lead: Lead) => {
    try {
      await enqueueLeadMutation(lead.id, async () => {
        const updated = await api.updateLead(lead.id, {
          pipeline_status: 'CONTATADO',
          contacted_at: new Date().toISOString(),
        });
        setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      });
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
      (typeof l.rating === 'number' ? l.rating : 0).toFixed(1),
      l.reviews_count ?? 0,
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

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage((cur) => (cur?.text === text ? null : cur));
    }, 4500);
  }, []);

  const handleConfirmDeleteSingle = async () => {
    if (!leadToDelete || deletingLeadId) return;
    const targetLead = leadToDelete;
    setDeletingLeadId(targetLead.id);
    try {
      await api.deleteLead(targetLead.id);
      // Remove imediatamente da interface sem chance de reaparecer
      setLeads((prev) => prev.filter((l) => l.id !== targetLead.id));
      setTotal((prev) => Math.max(0, prev - 1));
      setTotalOverallLeads((prev) => Math.max(0, prev - 1));
      setLeadToDelete(null);
      showToast('success', `Lead "${targetLead.name}" foi excluído com sucesso do banco de dados.`);
      loadNiches();
      loadStates();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao excluir lead.';
      console.error('Erro ao excluir lead:', err);
      showToast('error', msg);
    } finally {
      setDeletingLeadId(null);
    }
  };

  const handleConfirmDeleteAll = async () => {
    if (isDeletingAll) return;
    setIsDeletingAll(true);
    try {
      const isGlobal = userRole === 'admin' && (effectiveFreelancerId === 'ALL' || deleteGlobalScope);
      const res = isGlobal
        ? await api.adminPurgeGlobalLeads('ZERAR_TODOS_OS_LEADS')
        : await api.deleteAllLeads(effectiveFreelancerId);

      setLeads([]);
      setTotal(0);
      setTotalOverallLeads(0);
      setShowConfirmDeleteAll(false);
      showToast('success', `Todos os leads foram excluídos permanentemente com sucesso! (${res.deletedCount || 0} estabelecimentos removidos).`);
      loadNiches();
      loadStates();
      loadLeads(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao apagar todos os leads.';
      console.error('Erro ao apagar todos os leads:', err);
      showToast('error', msg);
    } finally {
      setIsDeletingAll(false);
    }
  };

  const hasActiveFilters =
    Boolean(initialSearchJobId) ||
    (nicheFilter && nicheFilter !== 'ALL') ||
    (stateFilter && stateFilter !== 'ALL') ||
    (cityFilter && cityFilter !== 'ALL') ||
    (statusFilter && statusFilter !== 'ALL') ||
    (ratingFilter && ratingFilter !== 'ALL') ||
    onlyWithoutWebsite ||
    onlyWithPhone ||
    onlyFavorites ||
    excludeHidden ||
    minScore > 0 ||
    Boolean(activeSearch && activeSearch.trim() !== '');

  const handleClearAllFilters = () => {
    setNicheFilter('ALL');
    setStateFilter('ALL');
    setCityFilter('ALL');
    setStatusFilter('ALL');
    setRatingFilter('ALL');
    setOnlyWithoutWebsite(false);
    setOnlyWithPhone(false);
    setOnlyFavorites(false);
    setExcludeHidden(false);
    setMinScore(0);
    setSearch('');
    setActiveSearch('');
    setSortBy('score');
    setPage(1);
    setFilterResetVersion((version) => version + 1);
    onClearInitialFilters?.();
  };

  return (
    <div className="space-y-4">
      {initialSearchJobId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <span className="font-semibold">Exibindo somente os leads novos desta busca — contatos antigos e ocultados não entram nesta lista.</span>
          <button type="button" onClick={handleClearAllFilters} className="font-semibold underline cursor-pointer">
            Ver todos os leads do workspace
          </button>
        </div>
      )}
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
          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
            <button
              type="button"
              onClick={() => loadLeads(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-900 bg-white border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer shadow-2xs"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span>Atualizar Agora</span>
            </button>
            <button
              type="button"
              onClick={() => handleCancelRunningJob(runningJob.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-50 hover:border-red-300 transition-colors cursor-pointer shadow-2xs"
              title="Encerrar ou dispensar esta varredura"
            >
              <X className="h-3.5 w-3.5" />
              <span>Encerrar Varredura</span>
            </button>
          </div>
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
                  {niches.reduce((acc, curr) => acc + curr.count, 0) || totalOverallLeads || total}
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
                  {statesSummary.reduce((acc, curr) => acc + curr.count, 0) || totalOverallLeads || total}
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
        {(initialSearchJobId || nicheFilter !== 'ALL' || stateFilter !== 'ALL' || onlyFavorites) && (
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
                onClearInitialFilters?.();
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
              onChange={(e) => {
                const val = e.target.value;
                setSearch(val);
                if (val === '') {
                  setActiveSearch('');
                  setPage(1);
                }
              }}
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
                loadLeads(false);
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

            {total > 0 && (
              <button
                type="button"
                onClick={() => setShowConfirmDeleteAll(true)}
                disabled={isDeletingAll || loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors shadow-2xs shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="Apagar permanentemente todos os leads do workspace atual"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                <span className="hidden sm:inline">Apagar todos os leads</span>
                <span className="sm:hidden">Apagar todos</span>
              </button>
            )}

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
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-2 border-t border-neutral-100">
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
                Favoritos
              </span>
            </label>
          </div>

          {/* Esconder leads cinzas / já coletados */}
          <div className="flex items-end pb-1.5">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-700">
              <input
                type="checkbox"
                checked={excludeHidden}
                onChange={(e) => {
                  setExcludeHidden(e.target.checked);
                  setPage(1);
                }}
                className="rounded-sm border-neutral-300 text-neutral-900 focus:ring-neutral-900"
              />
              <span className="font-medium text-[11px] text-neutral-600 flex items-center gap-1" title="Ocultar da lista os leads marcados como cinza / já coletados">
                <EyeOff className="h-3 w-3 text-neutral-500" />
                Sem cinzas
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
      {loadError && (
        <div className="flex items-center justify-between px-4 py-2.5 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl mb-4">
          <span>{loadError}</span>
          <button type="button" onClick={() => loadLeads(false)} className="underline font-bold ml-2 cursor-pointer hover:text-amber-950">
            Tentar novamente
          </button>
        </div>
      )}

      {loading && leads.length === 0 ? (
        <div className="py-20 text-center text-xs text-neutral-400 flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white">
          <RotateCw className="h-4 w-4 animate-spin text-neutral-500" />
          <span>Carregando estabelecimentos e dados do Maps...</span>
        </div>
      ) : loadError && leads.length === 0 ? (
        <div role="alert" className="py-16 text-center space-y-4 rounded-xl border border-amber-200 bg-white p-6 shadow-2xs">
          <AlertTriangle className="h-10 w-10 text-amber-600 mx-auto" />
          <h4 className="text-sm font-bold text-neutral-900">Não foi possível carregar os leads</h4>
          <p className="text-xs text-neutral-600 max-w-md mx-auto">
            A consulta ao servidor falhou. Seus leads continuam armazenados; uma falha de leitura não significa que o workspace foi zerado.
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={() => loadLeads(false)}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-neutral-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition-all cursor-pointer">
              <RotateCw className="h-4 w-4" />
              Tentar carregar novamente
            </button>
            <button type="button" onClick={handleClearAllFilters}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-neutral-700 bg-white border border-neutral-200 rounded-xl hover:bg-neutral-50 cursor-pointer">
              Limpar filtros e buscar todos
            </button>
          </div>
        </div>
      ) : leads.length === 0 ? (
        <div className="py-16 text-center space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-2xs">
          <Globe className="h-10 w-10 text-neutral-300 mx-auto" />
          <h4 className="text-sm font-bold text-neutral-900">
            {totalOverallLeads === 0 && !hasActiveFilters
              ? 'Workspace Limpo e Zerado'
              : 'Nenhuma loja encontrada com os filtros selecionados'}
          </h4>
          <p className="text-xs text-neutral-500 max-w-md mx-auto">
            {totalOverallLeads > 0
              ? `Você possui ${totalOverallLeads} estabelecimentos na sua base comercial. Os filtros ativos (nicho ou localização) restringiram os resultados.`
              : hasActiveFilters
              ? 'Os filtros atuais restringiram todos os resultados. Clique abaixo para limpar os filtros e visualizar todas as lojas da sua base comercial.'
              : userRole === 'freelancer'
              ? `Este workspace privado está 100% isolado e sem estabelecimentos. Somente as prospecções que você (${activeFreelancer?.name || 'Danilo'}) minerar ficarão visíveis aqui.`
              : 'Nenhum lead cadastrado no momento. Use a ferramenta "Buscar Leads" para minerar novas lojas via Google Maps.'}
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            {totalOverallLeads === 0 && !hasActiveFilters && onNavigateToSearch ? (
              <button
                type="button"
                onClick={onNavigateToSearch}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-neutral-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition-all cursor-pointer shadow-xs active:scale-95"
              >
                <Search className="h-4 w-4" />
                <span>Iniciar Busca de Leads no Maps</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-neutral-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition-all cursor-pointer shadow-xs active:scale-95"
              >
                <RotateCw className="h-4 w-4" />
                <span>Limpar Filtros e Ver Todos os Leads {totalOverallLeads > 0 ? `(${totalOverallLeads})` : ''}</span>
              </button>
            )}
          </div>
        </div>
      ) : viewMode === 'cards' ? (
        /* MODO 1: VITRINE DE LOJAS (CARDS RICOS E BONITOS) */
        <div className={`space-y-4 ${loading ? 'opacity-70 transition-opacity' : ''}`}>
          {loading && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg animate-pulse">
              <RotateCw className="h-3.5 w-3.5 animate-spin text-amber-600" />
              <span>Sincronizando estabelecimentos...</span>
            </div>
          )}
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
                  className={`group rounded-2xl border p-5 shadow-2xs transition-all duration-200 cursor-pointer flex flex-col justify-between space-y-4 relative overflow-hidden ${
                    lead.is_hidden
                      ? 'border-neutral-300 bg-neutral-100/90 grayscale-[0.85] opacity-65 hover:opacity-90 ring-1 ring-neutral-300'
                      : 'border-neutral-200 bg-white hover:border-neutral-350 hover:shadow-md'
                  }`}
                >
                  {/* Topo do Card com Ícone, Categoria e Score */}
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 shadow-2xs group-hover:scale-105 transition-transform ${
                          lead.is_hidden ? 'bg-neutral-600 text-neutral-200' : 'bg-neutral-900 text-white'
                        }`}>
                          <NicheIcon className={`h-5 w-5 ${lead.is_hidden ? 'text-neutral-300' : 'text-amber-400'}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">
                              {lead.niche}
                            </span>
                            {lead.is_hidden && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold bg-neutral-300 text-neutral-800">
                                <EyeOff className="h-2.5 w-2.5" />
                                Cinza
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-neutral-400 font-mono">
                            {lead.city} - {lead.state}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Botão de Ocultar / Deixar Cinza */}
                        <button
                          type="button"
                          onClick={(e) => handleToggleHide(e, lead.id)}
                          disabled={hidingLeadIds.includes(lead.id)}
                          className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                            lead.is_hidden
                              ? 'bg-neutral-800 text-amber-300 hover:bg-neutral-900 ring-1 ring-neutral-400'
                              : 'text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100'
                          }`}
                          title={lead.is_hidden ? 'Lead marcado como cinza (já coletado). Clique para reexibir normal' : 'Ocultar lead (deixar cinza para não pegar repetido)'}
                        >
                          {lead.is_hidden ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>

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

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLeadToDelete(lead);
                          }}
                          disabled={deletingLeadId === lead.id}
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Excluir este lead"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Banner indicativo quando o lead está ocultado/cinza */}
                    {lead.is_hidden && (
                      <div className="flex items-center justify-between px-2.5 py-1 bg-neutral-200/90 text-neutral-800 rounded-lg text-[10px] font-semibold border border-neutral-300">
                        <span className="flex items-center gap-1">
                          <EyeOff className="h-3 w-3 text-neutral-600" />
                          Ocultado / Cinza (Já coletado)
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleToggleHide(e, lead.id)}
                          className="text-neutral-900 underline hover:text-black cursor-pointer font-bold"
                        >
                          Reexibir
                        </button>
                      </div>
                    )}

                    {/* Nome da Loja */}
                    <div>
                      <h3 className={`text-sm font-bold group-hover:text-black line-clamp-1 tracking-tight ${
                        lead.is_hidden ? 'text-neutral-600 line-through' : 'text-neutral-900'
                      }`}>
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
                                star <= Math.round(lead.rating || 0)
                                  ? 'fill-amber-400 text-amber-400'
                                  : 'text-neutral-200'
                              }`}
                            />
                          ))}
                        </div>
                        <span className="font-bold text-neutral-900 font-mono tabular-nums">
                          {(typeof lead.rating === 'number' ? lead.rating : 0).toFixed(1)}
                        </span>
                        <span className="text-neutral-400 text-[10px] font-mono">
                          ({lead.reviews_count ?? 0})
                        </span>
                      </div>

                      {lead.website ? (
                        <a
                          href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded truncate max-w-[120px]"
                          title={lead.website}
                        >
                          Possui site
                        </a>
                      ) : (
                        <span className="text-[10px] font-bold text-amber-800 bg-amber-100/60 px-2 py-0.5 rounded">
                          Sem site
                        </span>
                      )}
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

                  {/* Botão de Ação Direta: Ocultar / Deixar Cinza */}
                  <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => handleToggleHide(e, lead.id)}
                      disabled={hidingLeadIds.includes(lead.id)}
                      className={`w-full py-1.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer border shadow-2xs ${
                        lead.is_hidden
                          ? 'bg-neutral-800 text-amber-300 border-neutral-700 hover:bg-neutral-900 ring-1 ring-neutral-400'
                          : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100 hover:text-neutral-900'
                      }`}
                      title={lead.is_hidden ? 'Reexibir lead normal (remover marcação cinza)' : 'Ocultar lead e deixar cinza para não pegar repetido'}
                    >
                      {lead.is_hidden ? (
                        <>
                          <Eye className="h-3.5 w-3.5 text-amber-300" />
                          <span>Reexibir Lead (Remover Cinza)</span>
                        </>
                      ) : (
                        <>
                          <EyeOff className="h-3.5 w-3.5 text-neutral-500" />
                          <span>Ocultar Lead (Deixar Cinza)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Paginação */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 rounded-xl border border-neutral-200 bg-white text-xs text-neutral-600 shadow-2xs">
            <div className="flex items-center gap-3">
              <span className="font-mono tabular-nums">
                {pageSize === 0 ? (
                  <span className="font-semibold text-neutral-900">Mostrando todos os {total} leads (Sem limite)</span>
                ) : (
                  <span>Página {page} de {totalPages} ({total} lojas encontradas)</span>
                )}
              </span>

              <div className="flex items-center gap-1.5 border-l border-neutral-200 pl-3">
                <span className="text-[11px] text-neutral-400">Exibição:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-800 focus:outline-hidden cursor-pointer"
                >
                  <option value={0}>Sem limite (Todos {total})</option>
                  <option value={50}>50 por página</option>
                  <option value={100}>100 por página</option>
                  <option value={200}>200 por página</option>
                </select>
              </div>
            </div>

            {pageSize > 0 && totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* MODO 2: TABELA DE ALTA DENSIDADE */
        <div className={`space-y-3 ${loading ? 'opacity-70 transition-opacity' : ''}`}>
          {loading && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg animate-pulse">
              <RotateCw className="h-3.5 w-3.5 animate-spin text-amber-600" />
              <span>Sincronizando estabelecimentos...</span>
            </div>
          )}
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
                      className={`transition-colors group cursor-pointer ${
                        lead.is_hidden
                          ? 'bg-neutral-100/90 text-neutral-500 opacity-60 grayscale-[0.85] hover:bg-neutral-200/70'
                          : 'hover:bg-neutral-50/70 bg-white'
                      }`}
                      onClick={() => onSelectLead(lead)}
                    >
                      {/* Empresa */}
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        <div className="flex items-center gap-1.5">
                          <div className={`truncate max-w-[180px] font-semibold ${lead.is_hidden ? 'line-through text-neutral-500' : 'text-neutral-900'}`} title={lead.name}>
                            {lead.name}
                          </div>
                          {lead.is_hidden && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold bg-neutral-300 text-neutral-800">
                              <EyeOff className="h-2.5 w-2.5" />
                              Cinza
                            </span>
                          )}
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
                          <span>{(typeof lead.rating === 'number' ? lead.rating : 0).toFixed(1)}</span>
                        </div>
                        <div className="text-[11px] text-neutral-400 font-mono tabular-nums">
                          {lead.reviews_count ?? 0} avaliações
                        </div>
                      </td>

                      {/* Telefone */}
                      <td className="px-3 py-3 font-mono whitespace-nowrap text-neutral-800">
                        {formatBrazilianPhone(lead.phone)}
                      </td>

                      {/* Site */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        {lead.website ? (
                          <a
                            href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 hover:underline truncate max-w-[120px] block text-xs"
                            title={lead.website}
                          >
                            Possui site
                          </a>
                        ) : (
                          <span className="text-amber-800 font-medium text-xs">Sem site</span>
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
                            onClick={(e) => handleToggleHide(e, lead.id)}
                            disabled={hidingLeadIds.includes(lead.id)}
                            title={lead.is_hidden ? 'Lead marcado como cinza (já coletado). Clique para reexibir' : 'Ocultar lead (deixar cinza para não pegar repetido)'}
                            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                              lead.is_hidden
                                ? 'text-amber-300 bg-neutral-800 hover:bg-neutral-900 ring-1 ring-neutral-400'
                                : 'text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100'
                            }`}
                          >
                            {lead.is_hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>

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

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLeadToDelete(lead);
                            }}
                            disabled={deletingLeadId === lead.id}
                            title="Excluir este lead"
                            className="p-1.5 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
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
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-neutral-200/80 bg-neutral-50/50 text-xs text-neutral-600">
            <div className="flex items-center gap-3">
              <span className="font-mono tabular-nums">
                {pageSize === 0 ? (
                  <span className="font-semibold text-neutral-900">Mostrando todos os {total} leads (Sem limite)</span>
                ) : (
                  <span>Página {page} de {totalPages} ({total} lojas)</span>
                )}
              </span>

              <div className="flex items-center gap-1.5 border-l border-neutral-200 pl-3">
                <span className="text-[11px] text-neutral-400">Exibição:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-800 focus:outline-hidden cursor-pointer"
                >
                  <option value={0}>Sem limite (Todos {total})</option>
                  <option value={50}>50 por página</option>
                  <option value={100}>100 por página</option>
                  <option value={200}>200 por página</option>
                </select>
              </div>
            </div>

            {pageSize > 0 && totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1 rounded border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1 rounded border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )}

      {/* Modal de Confirmação: Exclusão de Lead Individual */}
      {leadToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => !deletingLeadId && setLeadToDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-neutral-200 space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-neutral-900 leading-tight">
                  Excluir Lead
                </h3>
                <p className="text-xs text-neutral-600">
                  Tem certeza que deseja excluir este lead? Essa ação não poderá ser desfeita.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 text-xs space-y-1">
              <div className="font-bold text-neutral-900 text-sm">{leadToDelete.name}</div>
              <div className="text-neutral-500 flex items-center gap-2">
                <span>{leadToDelete.niche}</span>
                <span>·</span>
                <span>{leadToDelete.city} - {leadToDelete.state}</span>
              </div>
              {leadToDelete.phone && (
                <div className="text-neutral-600 font-mono text-[11px] pt-1">
                  📞 {formatBrazilianPhone(leadToDelete.phone)}
                </div>
              )}
            </div>

            <p className="text-[11px] text-neutral-400">
              O lead será removido permanentemente do Supabase.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setLeadToDelete(null)}
                disabled={Boolean(deletingLeadId)}
                className="px-4 py-2 text-xs font-semibold text-neutral-700 bg-white border border-neutral-200 rounded-xl hover:bg-neutral-100 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSingle}
                disabled={Boolean(deletingLeadId)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 disabled:opacity-50 rounded-xl transition-all shadow-xs cursor-pointer"
              >
                {deletingLeadId === leadToDelete.id ? (
                  <>
                    <RotateCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Excluindo...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Excluir Lead</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação: Exclusão em Massa (Apagar Todos os Leads) */}
      {showConfirmDeleteAll && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => !isDeletingAll && setShowConfirmDeleteAll(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-rose-200 space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-neutral-900 leading-tight">
                  Apagar Todos os Leads
                </h3>
                <p className="text-xs text-rose-700 font-semibold">
                  Tem certeza que deseja apagar TODOS os leads? Essa ação é permanente e não poderá ser desfeita.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3.5 text-xs text-rose-950 space-y-2">
              <p>
                Você está prestes a excluir permanentemente os leads cadastrados no sistema.
              </p>

              {userRole === 'admin' ? (
                <div className="space-y-1.5 pt-1 border-t border-rose-200/70">
                  <span className="font-semibold text-rose-900 block text-[11px]">Alcance da Exclusão:</span>
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                    <input
                      type="radio"
                      name="purgeScope"
                      checked={!deleteGlobalScope}
                      onChange={() => setDeleteGlobalScope(false)}
                      className="text-rose-600 focus:ring-rose-500"
                    />
                    <span>Apenas este workspace ({total} leads)</span>
                  </label>
                  <label className="flex items-center gap-2 text-[11px] font-bold text-rose-800 cursor-pointer">
                    <input
                      type="radio"
                      name="purgeScope"
                      checked={deleteGlobalScope}
                      onChange={() => setDeleteGlobalScope(true)}
                      className="text-rose-600 focus:ring-rose-500"
                    />
                    <span>TODOS os workspaces (Global - Admin e todos os Freelancers)</span>
                  </label>
                </div>
              ) : (
                <>
                  <p className="text-[11px] text-rose-700 font-mono">
                    Workspace do freelancer: {activeFreelancer?.name || 'Freelancer'} ({effectiveFreelancerId || 'privado'})
                  </p>
                  <p className="text-[11px] text-neutral-500 italic">
                    * Outros freelancers e contas não serão afetados (isolamento total de tenant respeitado).
                  </p>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmDeleteAll(false)}
                disabled={isDeletingAll}
                className="px-4 py-2 text-xs font-semibold text-neutral-700 bg-white border border-neutral-200 rounded-xl hover:bg-neutral-100 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteAll}
                disabled={isDeletingAll}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 disabled:opacity-50 rounded-xl transition-all shadow-xs cursor-pointer"
              >
                {isDeletingAll ? (
                  <>
                    <RotateCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Apagando todos...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Sim, apagar todos os leads</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Banner / Toast de Feedback Visual */}
      {toastMessage && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-xs font-medium animate-in slide-in-from-bottom-2 duration-200 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
              : 'bg-rose-50 text-rose-900 border-rose-300'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="ml-2 p-0.5 text-neutral-400 hover:text-neutral-800 rounded cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
