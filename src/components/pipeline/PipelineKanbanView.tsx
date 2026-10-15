import React, { useState, useEffect, useMemo } from 'react';
import {
  KanbanSquare,
  MessageCircle,
  ChevronRight,
  ChevronLeft,
  RotateCw,
  Phone,
  Building2,
  ExternalLink,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  TrendingUp,
  SlidersHorizontal,
  Copy,
  Check,
  Star,
  Globe,
  Plus,
  Users,
  Briefcase,
  ArrowRight,
} from 'lucide-react';
import { Lead, PipelineStatus } from '../../types';
import { api } from '../../lib/api';
import { getScoreColorClass } from '../../lib/scoring/leadScore';
import { formatBrazilianPhone, getWhatsAppUrl } from '../../utils/whatsapp';

interface PipelineKanbanViewProps {
  onSelectLead: (lead: Lead) => void;
  onNavigateToLeads?: () => void;
  onNavigateToSearch?: () => void;
}

interface StageConfig {
  id: PipelineStatus;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  badgeBg: string;
  borderColor: string;
  headerBg: string;
  isTerminal?: boolean;
}

const ALL_STAGES: StageConfig[] = [
  {
    id: 'NOVO',
    label: 'Novo Lead',
    shortLabel: 'Novo',
    description: 'Recém prospectado, aguardando qualificação',
    color: 'text-neutral-700',
    badgeBg: 'bg-neutral-200 text-neutral-800',
    borderColor: 'border-neutral-300',
    headerBg: 'bg-neutral-100',
  },
  {
    id: 'PRÉVIA CRIADA',
    label: 'Prévia Criada',
    shortLabel: 'Prévia',
    description: 'Mockup do site gerado para apresentar',
    color: 'text-violet-700',
    badgeBg: 'bg-violet-100 text-violet-800',
    borderColor: 'border-violet-300',
    headerBg: 'bg-violet-50/70',
  },
  {
    id: 'CONTATADO',
    label: 'Contatado',
    shortLabel: 'Contatado',
    description: 'Primeira abordagem enviada via WhatsApp',
    color: 'text-amber-700',
    badgeBg: 'bg-amber-100 text-amber-800',
    borderColor: 'border-amber-300',
    headerBg: 'bg-amber-50/70',
  },
  {
    id: 'RESPONDEU',
    label: 'Respondeu',
    shortLabel: 'Respondeu',
    description: 'Lead visualizou ou respondeu a mensagem',
    color: 'text-sky-700',
    badgeBg: 'bg-sky-100 text-sky-800',
    borderColor: 'border-sky-300',
    headerBg: 'bg-sky-50/70',
  },
  {
    id: 'INTERESSADO',
    label: 'Interessado',
    shortLabel: 'Interesse',
    description: 'Demonstrou interesse no site ou serviço',
    color: 'text-emerald-700',
    badgeBg: 'bg-emerald-100 text-emerald-800',
    borderColor: 'border-emerald-300',
    headerBg: 'bg-emerald-50/70',
  },
  {
    id: 'REUNIÃO',
    label: 'Reunião Marcada',
    shortLabel: 'Reunião',
    description: 'Agendou call de demonstração ou fechamento',
    color: 'text-blue-700',
    badgeBg: 'bg-blue-100 text-blue-800',
    borderColor: 'border-blue-300',
    headerBg: 'bg-blue-50/70',
  },
  {
    id: 'PROPOSTA',
    label: 'Proposta Enviada',
    shortLabel: 'Proposta',
    description: 'Orçamento e termos comerciais entregues',
    color: 'text-indigo-700',
    badgeBg: 'bg-indigo-100 text-indigo-800',
    borderColor: 'border-indigo-300',
    headerBg: 'bg-indigo-50/70',
  },
  {
    id: 'FOLLOW_UP',
    label: 'Follow-up',
    shortLabel: 'Follow-up',
    description: 'Acompanhamento de proposta ou retorno',
    color: 'text-orange-700',
    badgeBg: 'bg-orange-100 text-orange-800',
    borderColor: 'border-orange-300',
    headerBg: 'bg-orange-50/70',
  },
  {
    id: 'NEGOCIACAO',
    label: 'Em Negociação',
    shortLabel: 'Negociação',
    description: 'Ajuste de escopo e condições de pagamento',
    color: 'text-purple-700',
    badgeBg: 'bg-purple-100 text-purple-800',
    borderColor: 'border-purple-300',
    headerBg: 'bg-purple-50/70',
  },
  {
    id: 'FECHADO',
    label: 'Contrato Fechado',
    shortLabel: 'Fechado',
    description: 'Cliente conquistado com sucesso!',
    color: 'text-emerald-800',
    badgeBg: 'bg-emerald-600 text-white font-bold',
    borderColor: 'border-emerald-500',
    headerBg: 'bg-emerald-50',
    isTerminal: true,
  },
  {
    id: 'PERDIDO',
    label: 'Perdido',
    shortLabel: 'Perdido',
    description: 'Não fechou ou escolheu outra solução',
    color: 'text-rose-700',
    badgeBg: 'bg-rose-100 text-rose-800',
    borderColor: 'border-rose-300',
    headerBg: 'bg-rose-50/60',
    isTerminal: true,
  },
  {
    id: 'NAO_INTERESSADO',
    label: 'Não Interessado',
    shortLabel: 'Sem Interesse',
    description: 'Recusou expressamente no momento',
    color: 'text-neutral-500',
    badgeBg: 'bg-neutral-200 text-neutral-700',
    borderColor: 'border-neutral-300',
    headerBg: 'bg-neutral-100/70',
    isTerminal: true,
  },
  {
    id: 'SEM_RESPOSTA',
    label: 'Sem Resposta',
    shortLabel: 'Sem Resposta',
    description: 'Tentativas de contato sem retorno',
    color: 'text-neutral-500',
    badgeBg: 'bg-neutral-200 text-neutral-700',
    borderColor: 'border-neutral-300',
    headerBg: 'bg-neutral-100/70',
    isTerminal: true,
  },
];

const CORE_FUNNEL_IDS: PipelineStatus[] = [
  'NOVO',
  'PRÉVIA CRIADA',
  'CONTATADO',
  'RESPONDEU',
  'INTERESSADO',
  'REUNIÃO',
  'PROPOSTA',
  'FECHADO',
];

const ARCHIVED_IDS: PipelineStatus[] = [
  'FECHADO',
  'FOLLOW_UP',
  'NEGOCIACAO',
  'PERDIDO',
  'NAO_INTERESSADO',
  'SEM_RESPOSTA',
];

export const PipelineKanbanView: React.FC<PipelineKanbanViewProps> = ({
  onSelectLead,
  onNavigateToLeads,
  onNavigateToSearch,
}) => {
  const [board, setBoard] = useState<Record<PipelineStatus, Lead[]>>({
    'NOVO': [],
    'PRÉVIA CRIADA': [],
    'CONTATADO': [],
    'RESPONDEU': [],
    'INTERESSADO': [],
    'FOLLOW_UP': [],
    'NEGOCIACAO': [],
    'REUNIÃO': [],
    'PROPOSTA': [],
    'FECHADO': [],
    'PERDIDO': [],
    'NAO_INTERESSADO': [],
    'SEM_RESPOSTA': [],
  });

  const [loading, setLoading] = useState<boolean>(true);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<PipelineStatus | null>(null);

  // Filtros e Visualização
  const [viewFilter, setViewFilter] = useState<'core' | 'all' | 'archived'>('core');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedNiche, setSelectedNiche] = useState<string>('ALL');
  const [minScore, setMinScore] = useState<number>(0);
  const [onlyNoWebsite, setOnlyNoWebsite] = useState<boolean>(false);
  const [copiedPhoneId, setCopiedPhoneId] = useState<string | null>(null);

  useEffect(() => {
    loadPipeline();
  }, []);

  const loadPipeline = async () => {
    setLoading(true);
    try {
      const data = await api.getPipeline();
      setBoard(data);
    } catch (err) {
      console.error('Erro ao carregar pipeline:', err);
    } finally {
      setLoading(false);
    }
  };

  const moveLeadTo = async (leadId: string, toStatus: PipelineStatus) => {
    try {
      // Atualização otimista imediata na interface
      setBoard((prev) => {
        let movedLead: Lead | undefined;
        const newBoard: Record<PipelineStatus, Lead[]> = { ...prev };

        for (const st of Object.keys(newBoard) as PipelineStatus[]) {
          const idx = (newBoard[st] || []).findIndex((l) => l.id === leadId);
          if (idx !== -1) {
            movedLead = { ...newBoard[st][idx], pipeline_status: toStatus };
            newBoard[st] = newBoard[st].filter((l) => l.id !== leadId);
            break;
          }
        }

        if (movedLead) {
          newBoard[toStatus] = [movedLead, ...(newBoard[toStatus] || [])];
        }
        return newBoard;
      });

      await api.movePipelineLead(leadId, toStatus);
    } catch (err) {
      console.error('Falha ao mover lead:', err);
      loadPipeline();
    }
  };

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    e.dataTransfer.setData('text/plain', leadId);
    setDraggedLeadId(leadId);
  };

  const handleDragOver = (e: React.DragEvent, stageId: PipelineStatus) => {
    e.preventDefault();
    if (dragOverStage !== stageId) {
      setDragOverStage(stageId);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, toStatus: PipelineStatus) => {
    e.preventDefault();
    setDragOverStage(null);
    const leadId = e.dataTransfer.getData('text/plain') || draggedLeadId;
    if (leadId) {
      moveLeadTo(leadId, toStatus);
      setDraggedLeadId(null);
    }
  };

  const handleCopyPhone = (leadId: string, phone?: string | null) => {
    if (!phone) return;
    const clean = phone.replace(/\D/g, '');
    navigator.clipboard.writeText(clean);
    setCopiedPhoneId(leadId);
    setTimeout(() => {
      setCopiedPhoneId((curr) => (curr === leadId ? null : curr));
    }, 2000);
  };

  // Extrai lista única de nichos presentes
  const availableNiches = useMemo(() => {
    const set = new Set<string>();
    Object.values(board).forEach((leads) => {
      leads.forEach((l) => {
        if (l.niche) set.add(l.niche);
      });
    });
    return Array.from(set).sort();
  }, [board]);

  // Estágios a exibir com base no filtro de visualização
  const visibleStages = useMemo(() => {
    if (viewFilter === 'core') {
      return ALL_STAGES.filter((s) => CORE_FUNNEL_IDS.includes(s.id));
    }
    if (viewFilter === 'archived') {
      return ALL_STAGES.filter((s) => ARCHIVED_IDS.includes(s.id));
    }
    return ALL_STAGES;
  }, [viewFilter]);

  // Métricas agregadas do funil
  const metrics = useMemo(() => {
    let total = 0;
    let contactedCount = 0;
    let respondedCount = 0;
    let inNegotiation = 0;
    let closedCount = (board['FECHADO'] || []).length;

    Object.entries(board).forEach(([st, leads]) => {
      total += leads.length;
      if (['CONTATADO', 'RESPONDEU', 'INTERESSADO', 'REUNIÃO', 'PROPOSTA', 'FOLLOW_UP', 'NEGOCIACAO', 'FECHADO'].includes(st)) {
        contactedCount += leads.length;
      }
      if (['RESPONDEU', 'INTERESSADO', 'REUNIÃO', 'PROPOSTA', 'NEGOCIACAO', 'FECHADO'].includes(st)) {
        respondedCount += leads.length;
      }
      if (['INTERESSADO', 'REUNIÃO', 'PROPOSTA', 'NEGOCIACAO'].includes(st)) {
        inNegotiation += leads.length;
      }
    });

    const responseRate = contactedCount > 0 ? Math.round((respondedCount / contactedCount) * 100) : 0;
    const conversionRate = total > 0 ? Math.round((closedCount / total) * 100) : 0;

    return {
      total,
      contactedCount,
      respondedCount,
      inNegotiation,
      closedCount,
      responseRate,
      conversionRate,
    };
  }, [board]);

  // Filtra cards de cada coluna de acordo com a busca
  const filterLead = (lead: Lead): boolean => {
    if (searchTerm.trim() !== '') {
      const q = searchTerm.toLowerCase().trim();
      const matchName = lead.name.toLowerCase().includes(q);
      const matchCity = (lead.city || '').toLowerCase().includes(q);
      const matchNiche = (lead.niche || '').toLowerCase().includes(q);
      const matchPhone = (lead.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, ''));
      if (!matchName && !matchCity && !matchNiche && !matchPhone) return false;
    }

    if (selectedNiche !== 'ALL' && lead.niche !== selectedNiche) {
      return false;
    }

    if (minScore > 0 && (lead.lead_score || 0) < minScore) {
      return false;
    }

    if (onlyNoWebsite && Boolean(lead.website && lead.website.trim() !== '')) {
      return false;
    }

    return true;
  };

  const isPipelineCompletelyEmpty = metrics.total === 0;

  return (
    <div className="space-y-4">
      {/* 1. Header do Pipeline com Estética SaaS Moderna */}
      <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-xs transition-all">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-2xs">
                <KanbanSquare className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-base font-bold text-neutral-900 tracking-tight flex items-center gap-2">
                  <span>Pipeline Comercial & Funil de Conversão</span>
                </h1>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Gerencie cada lead nas etapas de prospecção, qualificação, abordagem e fechamento.
                </p>
              </div>
            </div>
          </div>

          {/* Controles de Ação no Header */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Seletor de visualização do funil */}
            <div className="inline-flex rounded-xl border border-neutral-200 bg-neutral-100 p-1 text-xs">
              <button
                type="button"
                onClick={() => setViewFilter('core')}
                className={`px-3 py-1.5 font-semibold rounded-lg transition-colors cursor-pointer ${
                  viewFilter === 'core'
                    ? 'bg-white text-neutral-900 shadow-2xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Funil Ativo ({CORE_FUNNEL_IDS.length})
              </button>
              <button
                type="button"
                onClick={() => setViewFilter('all')}
                className={`px-3 py-1.5 font-semibold rounded-lg transition-colors cursor-pointer ${
                  viewFilter === 'all'
                    ? 'bg-white text-neutral-900 shadow-2xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Todas as Etapas ({ALL_STAGES.length})
              </button>
              <button
                type="button"
                onClick={() => setViewFilter('archived')}
                className={`px-3 py-1.5 font-semibold rounded-lg transition-colors cursor-pointer ${
                  viewFilter === 'archived'
                    ? 'bg-white text-neutral-900 shadow-2xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Concluídos & Arquivados
              </button>
            </div>

            <button
              type="button"
              onClick={loadPipeline}
              disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-neutral-700 bg-white hover:bg-neutral-50 border border-neutral-200 rounded-xl transition-all shadow-2xs cursor-pointer disabled:opacity-50"
              title="Recarregar leads e posições do funil"
            >
              <RotateCw className={`h-3.5 w-3.5 text-neutral-600 ${loading ? 'animate-spin' : ''}`} />
              <span>Atualizar Funil</span>
            </button>
          </div>
        </div>

        {/* 2. Barra de Métricas Chave do Funil */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 pt-4 mt-4 border-t border-neutral-100">
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Total no Funil
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl font-bold text-neutral-900 font-mono tabular-nums">
                {metrics.total}
              </span>
              <span className="text-xs text-neutral-400">estabelecimentos</span>
            </div>
          </div>

          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Contatados
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl font-bold text-amber-700 font-mono tabular-nums">
                {metrics.contactedCount}
              </span>
              <span className="text-xs text-neutral-400">mensagens</span>
            </div>
          </div>

          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Em Negociação
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl font-bold text-blue-700 font-mono tabular-nums">
                {metrics.inNegotiation}
              </span>
              <span className="text-xs text-neutral-400">oportunidades</span>
            </div>
          </div>

          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Taxa de Resposta
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl font-bold text-sky-700 font-mono tabular-nums">
                {metrics.responseRate}%
              </span>
              <span className="text-xs text-neutral-400">conversão</span>
            </div>
          </div>

          <div className="flex flex-col col-span-2 sm:col-span-4 lg:col-span-1">
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Fechados (Ganho)
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl font-bold text-emerald-700 font-mono tabular-nums">
                {metrics.closedCount}
              </span>
              <span className="text-xs text-emerald-600 font-semibold">sucesso</span>
            </div>
          </div>
        </div>

        {/* 3. Barra de Busca e Filtros Contextuais */}
        <div className="flex flex-wrap items-center gap-2.5 pt-3.5 mt-3 border-t border-neutral-100 text-xs">
          {/* Campo de Busca Rápida */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filtrar por nome, nicho, cidade ou telefone..."
              className="w-full pl-8 pr-7 py-1.5 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:border-neutral-900 focus:outline-hidden transition-colors"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filtro por Nicho */}
          {availableNiches.length > 0 && (
            <select
              value={selectedNiche}
              onChange={(e) => setSelectedNiche(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
            >
              <option value="ALL">Todos os Nichos</option>
              {availableNiches.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}

          {/* Filtro de Score Mínimo */}
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="px-2.5 py-1.5 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
          >
            <option value="0">Todos os Scores</option>
            <option value="60">Score ≥ 60</option>
            <option value="75">Score ≥ 75</option>
            <option value="85">Score ≥ 85 (Alta Prioridade)</option>
          </select>

          {/* Checkbox Apenas Sem Site */}
          <label className="flex items-center gap-1.5 text-xs text-neutral-700 select-none cursor-pointer px-2 py-1.5 bg-neutral-50 rounded-xl hover:bg-neutral-100 transition-colors">
            <input
              type="checkbox"
              checked={onlyNoWebsite}
              onChange={(e) => setOnlyNoWebsite(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900 cursor-pointer"
            />
            <span>Apenas sem site</span>
          </label>

          {(searchTerm || selectedNiche !== 'ALL' || minScore > 0 || onlyNoWebsite) && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setSelectedNiche('ALL');
                setMinScore(0);
                setOnlyNoWebsite(false);
              }}
              className="text-neutral-500 hover:text-neutral-900 underline font-medium text-xs ml-auto"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* 4. Estado Vazio Global se não houver leads no workspace */}
      {isPipelineCompletelyEmpty && !loading && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-12 text-center shadow-xs">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400 mb-4">
            <KanbanSquare className="h-7 w-7" />
          </div>
          <h3 className="text-base font-bold text-neutral-900">
            Nenhum lead no pipeline comercial no momento
          </h3>
          <p className="text-xs text-neutral-500 max-w-md mx-auto mt-1 mb-5">
            Seu funil está pronto para receber novas oportunidades. Faça uma busca no Google Maps por cidades e nichos para alimentar seu pipeline.
          </p>
          <div className="flex items-center justify-center gap-3">
            {onNavigateToSearch && (
              <button
                type="button"
                onClick={onNavigateToSearch}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-neutral-900 hover:bg-black rounded-xl transition-all shadow-xs cursor-pointer"
              >
                <Search className="h-3.5 w-3.5" />
                <span>Buscar Novos Estabelecimentos</span>
              </button>
            )}
            {onNavigateToLeads && (
              <button
                type="button"
                onClick={onNavigateToLeads}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-neutral-700 bg-white hover:bg-neutral-50 border border-neutral-200 rounded-xl transition-all shadow-xs cursor-pointer"
              >
                <Users className="h-3.5 w-3.5" />
                <span>Ver Meus Leads</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 5. Board Kanban com Design Refinado */}
      <div className="flex gap-3.5 overflow-x-auto pb-6 pt-1 snap-x select-none">
        {visibleStages.map((stage) => {
          const rawCards = board[stage.id] || [];
          const filteredCards = rawCards.filter(filterLead);
          const isDragTarget = dragOverStage === stage.id;
          const stageIndex = ALL_STAGES.findIndex((s) => s.id === stage.id);
          const totalAll = metrics.total;
          const stagePercentage = totalAll > 0 ? Math.round((rawCards.length / totalAll) * 100) : 0;

          return (
            <div
              key={stage.id}
              onDragOver={(e) => handleDragOver(e, stage.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage.id)}
              className={`flex flex-col w-80 shrink-0 rounded-2xl border transition-all duration-150 snap-start ${
                isDragTarget
                  ? 'border-neutral-900 bg-neutral-200/90 shadow-md ring-2 ring-neutral-900/10'
                  : 'border-neutral-200/90 bg-neutral-100/70 shadow-2xs hover:border-neutral-300'
              }`}
            >
              {/* Header da Coluna */}
              <div className={`p-3.5 rounded-t-2xl border-b border-neutral-200/80 ${stage.headerBg}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-neutral-900 tracking-tight">
                      {stage.label}
                    </span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-mono font-bold ${stage.badgeBg}`}>
                      {filteredCards.length}
                    </span>
                  </div>

                  <span className="text-[10px] font-mono text-neutral-400" title={`${rawCards.length} de ${totalAll} leads`}>
                    {stagePercentage}%
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 mt-1 line-clamp-1">
                  {stage.description}
                </p>
              </div>

              {/* Área de Cards Rolável */}
              <div className="flex-1 p-2.5 space-y-2.5 overflow-y-auto max-h-[72vh] min-h-[360px]">
                {filteredCards.length === 0 ? (
                  <div
                    className={`h-48 flex flex-col items-center justify-center text-center p-4 rounded-xl border border-dashed transition-colors ${
                      isDragTarget
                        ? 'border-neutral-900 bg-white/80 text-neutral-900'
                        : 'border-neutral-200/80 text-neutral-400 bg-neutral-50/40'
                    }`}
                  >
                    <KanbanSquare className="h-5 w-5 mb-1.5 opacity-40" />
                    <span className="text-xs font-medium">Nenhum lead nesta etapa</span>
                    <span className="text-[10px] text-neutral-400 mt-0.5">
                      Arraste um card aqui para atualizar
                    </span>
                  </div>
                ) : (
                  filteredCards.map((lead) => {
                    const { badgeBg, badgeText } = getScoreColorClass(lead.lead_score);
                    const waUrl = getWhatsAppUrl(lead.phone, lead.name, lead.niche);
                    const isCopied = copiedPhoneId === lead.id;
                    const isBeingDragged = draggedLeadId === lead.id;
                    const hasWebsite = Boolean(lead.website && lead.website.trim() !== '');

                    return (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, lead.id)}
                        onClick={() => onSelectLead(lead)}
                        className={`group relative rounded-xl border bg-white p-3.5 shadow-2xs hover:shadow-md transition-all cursor-grab active:cursor-grabbing space-y-2.5 ${
                          isBeingDragged
                            ? 'opacity-40 border-neutral-400'
                            : 'border-neutral-200/90 hover:border-neutral-400'
                        }`}
                      >
                        {/* Topo do Card: Nome e Score */}
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-xs font-bold text-neutral-900 leading-snug line-clamp-2 group-hover:text-black">
                            {lead.name}
                          </h4>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold shrink-0 border ${badgeBg}`}
                            title={`Score comercial: ${lead.lead_score}/100`}
                          >
                            {lead.lead_score}
                          </span>
                        </div>

                        {/* Metadados: Nicho, Cidade e Avaliação */}
                        <div className="text-[11px] text-neutral-500 space-y-1">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-medium text-neutral-800">{lead.niche}</span>
                            <span className="text-neutral-300">·</span>
                            <span className="truncate">{lead.city} - {lead.state}</span>
                          </div>

                          {lead.rating > 0 && (
                            <div className="flex items-center gap-1 text-[10px] text-neutral-600 font-mono">
                              <Star className="h-3 w-3 fill-amber-400 text-amber-500 shrink-0" />
                              <span className="font-bold">{lead.rating.toFixed(1)}</span>
                              {lead.reviews_count > 0 && (
                                <span className="text-neutral-400">({lead.reviews_count} avaliações)</span>
                              )}
                            </div>
                          )}

                          {/* Tag de Website */}
                          <div className="pt-0.5">
                            {!hasWebsite ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                Sem site próprio
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded truncate max-w-[200px]">
                                <Globe className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">{lead.website?.replace(/^https?:\/\//i, '')}</span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Telefone e Ações Rápidas */}
                        <div
                          className="flex items-center justify-between pt-2 border-t border-neutral-100 text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Botão de Cópia do Telefone */}
                          {lead.phone ? (
                            <button
                              type="button"
                              onClick={() => handleCopyPhone(lead.id, lead.phone)}
                              className="flex items-center gap-1 text-[10px] font-mono text-neutral-600 hover:text-neutral-900 bg-neutral-50 hover:bg-neutral-100 px-2 py-1 rounded-md transition-colors"
                              title="Copiar telefone para área de transferência"
                            >
                              <Phone className="h-3 w-3 text-neutral-400" />
                              <span>{formatBrazilianPhone(lead.phone)}</span>
                              {isCopied ? (
                                <Check className="h-3 w-3 text-emerald-600" />
                              ) : (
                                <Copy className="h-3 w-3 text-neutral-400" />
                              )}
                            </button>
                          ) : (
                            <span className="text-[10px] text-neutral-400 italic">Sem telefone</span>
                          )}

                          {/* Botão Direto do WhatsApp */}
                          {waUrl && (
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Abrir WhatsApp com pitch comercial"
                              className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 rounded-md transition-all shadow-2xs"
                            >
                              <MessageCircle className="h-3 w-3 fill-white" />
                              <span>WhatsApp</span>
                            </a>
                          )}
                        </div>

                        {/* Barra de Mudança de Etapa Rápida (para cliques ou dispositivos sem drag) */}
                        <div
                          className="flex items-center justify-between pt-1 text-[10px] text-neutral-400"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {stageIndex > 0 ? (
                            <button
                              type="button"
                              onClick={() => moveLeadTo(lead.id, ALL_STAGES[stageIndex - 1].id)}
                              className="flex items-center gap-0.5 hover:text-neutral-900 transition-colors p-1 rounded hover:bg-neutral-100"
                              title={`Voltar para ${ALL_STAGES[stageIndex - 1].label}`}
                            >
                              <ChevronLeft className="h-3 w-3" />
                              <span className="hidden sm:inline">Voltar</span>
                            </button>
                          ) : (
                            <span />
                          )}

                          {/* Seletor dropdown direto para qualquer etapa */}
                          <select
                            value={lead.pipeline_status || 'NOVO'}
                            onChange={(e) => moveLeadTo(lead.id, e.target.value as PipelineStatus)}
                            className="text-[10px] bg-transparent text-neutral-500 hover:text-neutral-900 font-medium border-0 focus:ring-0 cursor-pointer text-center"
                            title="Mover diretamente para outra etapa"
                          >
                            {ALL_STAGES.map((s) => (
                              <option key={s.id} value={s.id}>
                                Mover: {s.label}
                              </option>
                            ))}
                          </select>

                          {stageIndex < ALL_STAGES.length - 1 ? (
                            <button
                              type="button"
                              onClick={() => moveLeadTo(lead.id, ALL_STAGES[stageIndex + 1].id)}
                              className="flex items-center gap-0.5 hover:text-neutral-900 font-semibold text-neutral-700 transition-colors p-1 rounded hover:bg-neutral-100"
                              title={`Avançar para ${ALL_STAGES[stageIndex + 1].label}`}
                            >
                              <span className="hidden sm:inline">Avançar</span>
                              <ChevronRight className="h-3 w-3" />
                            </button>
                          ) : (
                            <span />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
