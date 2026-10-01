import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Zap,
  MessageCircle,
  Instagram,
  ArrowRight,
  ArrowLeft,
  Star,
  ExternalLink,
  Copy,
  Check,
  RotateCcw,
  Target,
  Flame,
  Award,
  Sparkles,
  Phone,
  MapPin,
  Clock,
  Layers,
  ChevronDown,
  Volume2,
  Send,
  SlidersHorizontal,
  Bookmark,
  XCircle,
  Eye,
  CheckCircle2,
  Dumbbell,
  Scissors,
  Stethoscope,
  Utensils,
  Wrench,
  Home,
  Store,
  Tags,
  Building2,
} from 'lucide-react';
import { Lead, PipelineStatus } from '../../types';
import { api } from '../../lib/api';
import {
  generatePitches,
  getInstagramSearchUrl,
  getWhatsAppDirectUrl,
  GeneratedPitch,
  PitchType,
} from '../../lib/pitch/pitchGenerator';
import { formatBrazilianPhone } from '../../utils/whatsapp';

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

interface SpeedOutreachViewProps {
  onSelectLead?: (lead: Lead) => void;
  onNavigateToPipeline?: () => void;
  onNavigateToLeads?: () => void;
  onNavigateToTemplates?: () => void;
}

interface SessionContact {
  leadId: string;
  leadName: string;
  city: string;
  channel: 'whatsapp' | 'instagram';
  time: string;
}

function getNicheIcon(niche?: string) {
  const n = (niche || '').toLowerCase();
  if (n.includes('acad') || n.includes('fit') || n.includes('cross') || n.includes('treino') || n.includes('pilates')) return Dumbbell;
  if (n.includes('barbearia') || n.includes('cabelo') || n.includes('salao') || n.includes('estet') || n.includes('manicure') || n.includes('spa')) return Scissors;
  if (n.includes('odonto') || n.includes('dent') || n.includes('clinica') || n.includes('saud') || n.includes('medic') || n.includes('fisio')) return Stethoscope;
  if (n.includes('restaur') || n.includes('pizza') || n.includes('comida') || n.includes('burger') || n.includes('hamburg') || n.includes('lanch') || n.includes('bar')) return Utensils;
  if (n.includes('mecan') || n.includes('oficina') || n.includes('auto') || n.includes('pneu') || n.includes('funilar')) return Wrench;
  if (n.includes('imobil') || n.includes('corretor')) return Home;
  if (n.includes('eletri') || n.includes('solar') || n.includes('energia')) return Zap;
  return Store;
}

export const SpeedOutreachView: React.FC<SpeedOutreachViewProps> = ({
  onSelectLead,
  onNavigateToPipeline,
  onNavigateToLeads,
  onNavigateToTemplates,
}) => {
  // Estado de Leads
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [currentIndex, setCurrentIndex] = useState<number>(0);

  // Filtros da Esteira
  const [statusFilter, setStatusFilter] = useState<string>('NOT_CONTACTED'); // 'NOT_CONTACTED', 'NOVO', 'ALL'
  const [onlyWithoutWebsite, setOnlyWithoutWebsite] = useState<boolean>(true);
  const [onlyWithPhone, setOnlyWithPhone] = useState<boolean>(true);
  const [selectedNiche, setSelectedNiche] = useState<string>('ALL');
  const [selectedState, setSelectedState] = useState<string>('ALL');
  const [showFilterDrawer, setShowFilterDrawer] = useState<boolean>(false);

  // Gamificação & Meta
  const todayKey = useMemo(() => `gh_outreach_${new Date().toISOString().slice(0, 10)}`, []);
  const [dailyGoal, setDailyGoal] = useState<number>(() => {
    const saved = localStorage.getItem('gh_outreach_daily_goal');
    return saved ? Math.max(10, parseInt(saved, 10)) : 50;
  });
  const [todayCount, setTodayCount] = useState<number>(() => {
    const saved = localStorage.getItem(todayKey);
    return saved ? parseInt(saved, 10) : 0;
  });

  // Sessão Atual
  const [sessionContacts, setSessionContacts] = useState<SessionContact[]>([]);
  const [sessionStartTime] = useState<number>(Date.now());
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState<number>(0);

  // Template e Customização do Pitch
  const [activePitchType, setActivePitchType] = useState<PitchType>('niche_specialized');
  const [customText, setCustomText] = useState<string>('');
  const [copiedSuccess, setCopiedSuccess] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<{ message: string; type: 'success' | 'skip' | 'favorite' } | null>(null);

  // Timer da sessão
  useEffect(() => {
    const timer = setInterval(() => {
      setSessionElapsedSeconds(Math.floor((Date.now() - sessionStartTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionStartTime]);

  // Carrega todos os leads do banco/Firestore
  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getLeads({ limit: 100, sortBy: 'score' });
      if (res && res.leads) {
        setAllLeads(res.leads);
      }
    } catch (err) {
      console.error('[SpeedOutreach] Erro ao carregar leads:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  // Salva meta diária
  const handleUpdateGoal = (newGoal: number) => {
    setDailyGoal(newGoal);
    localStorage.setItem('gh_outreach_daily_goal', String(newGoal));
  };

  // Incrementa contador diário
  const incrementDailyCount = useCallback(() => {
    setTodayCount((prev) => {
      const next = prev + 1;
      localStorage.setItem(todayKey, String(next));
      return next;
    });
  }, [todayKey]);

  // Lista de Nichos e Estados disponíveis
  const availableNiches = useMemo(() => {
    const set = new Set<string>();
    allLeads.forEach((l) => {
      if (l.niche) set.add(l.niche);
    });
    return Array.from(set).sort();
  }, [allLeads]);

  // Estatísticas completas por Nicho (total, pendentes, contatados)
  const nicheStats = useMemo(() => {
    const map = new Map<string, { total: number; contacted: number; pending: number }>();
    allLeads.forEach((lead) => {
      const niche = lead.niche || 'Outros';
      const existing = map.get(niche) || { total: 0, contacted: 0, pending: 0 };
      existing.total += 1;
      if (lead.pipeline_status === 'CONTATADO' || lead.pipeline_status === 'FECHADO') {
        existing.contacted += 1;
      } else {
        existing.pending += 1;
      }
      map.set(niche, existing);
    });

    return Array.from(map.entries())
      .map(([niche, stats]) => ({
        niche,
        ...stats,
      }))
      .sort((a, b) => b.total - a.total);
  }, [allLeads]);

  const handleSelectNiche = (niche: string) => {
    setSelectedNiche(niche);
    setCurrentIndex(0);
    setActivePitchType('niche_specialized');
    triggerFeedback(
      niche === 'ALL'
        ? 'Exibindo todos os nichos'
        : `Fila filtrada por nicho: ${niche}`,
      'skip'
    );
  };

  const availableStates = useMemo(() => {
    const set = new Set<string>();
    allLeads.forEach((l) => {
      if (l.state) set.add(l.state.toUpperCase());
    });
    return Array.from(set).sort();
  }, [allLeads]);

  // Leads filtrados para a esteira
  const queue = useMemo(() => {
    return allLeads.filter((l) => {
      if (onlyWithoutWebsite && l.website_status !== 'no_website' && l.website) {
        return false;
      }
      if (onlyWithPhone && (!l.phone || l.phone.trim().length < 8)) {
        return false;
      }
      if (selectedNiche !== 'ALL' && l.niche !== selectedNiche) {
        return false;
      }
      if (selectedState !== 'ALL' && l.state?.toUpperCase() !== selectedState) {
        return false;
      }
      if (statusFilter === 'NOT_CONTACTED') {
        return l.pipeline_status !== 'CONTATADO' && l.pipeline_status !== 'FECHADO' && l.pipeline_status !== 'PERDIDO';
      }
      if (statusFilter === 'NOVO') {
        return l.pipeline_status === 'NOVO';
      }
      return true;
    });
  }, [allLeads, onlyWithoutWebsite, onlyWithPhone, selectedNiche, selectedState, statusFilter]);

  // Lead em foco no momento
  const currentLead: Lead | undefined = queue[currentIndex];

  // Gera os pitches do lead atual
  const pitches: GeneratedPitch[] = useMemo(() => {
    if (!currentLead) return [];
    return generatePitches(currentLead);
  }, [currentLead]);

  // Sincroniza o texto do pitch ativo
  useEffect(() => {
    if (!currentLead) {
      setCustomText('');
      return;
    }
    const found = pitches.find((p) => p.type === activePitchType);
    if (found) {
      setCustomText(found.text);
    } else if (pitches.length > 0) {
      setCustomText(pitches[0].text);
      setActivePitchType(pitches[0].type);
    }
  }, [currentLead, activePitchType, pitches]);

  // Mostra feedback temporário
  const triggerFeedback = (message: string, type: 'success' | 'skip' | 'favorite') => {
    setActionFeedback({ message, type });
    setTimeout(() => {
      setActionFeedback(null);
    }, 2200);
  };

  // Copia texto para o clipboard
  const handleCopyText = async () => {
    if (!customText) return;
    try {
      await navigator.clipboard.writeText(customText);
      setCopiedSuccess(true);
      setTimeout(() => setCopiedSuccess(false), 2000);
    } catch (e) {
      console.error('Erro ao copiar texto:', e);
    }
  };

  // Ação 1-Clique: DISPARAR NO WHATSAPP
  const handleShootWhatsApp = async () => {
    if (!currentLead) return;
    const phone = currentLead.phone;
    if (!phone) {
      triggerFeedback('Este lead não tem telefone cadastrado!', 'skip');
      return;
    }

    const message = customText;
    await navigator.clipboard.writeText(message).catch(() => {});

    // Gera o link do WhatsApp
    const waUrl = getWhatsAppDirectUrl(phone, message);
    if (waUrl) {
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    }

    // Marca o lead como CONTATADO no pipeline
    api.movePipelineLead(currentLead.id, 'CONTATADO').catch((err) => {
      console.warn('Erro ao atualizar status do lead:', err);
    });

    // Atualiza localmente
    setAllLeads((prev) =>
      prev.map((l) =>
        l.id === currentLead.id
          ? { ...l, pipeline_status: 'CONTATADO', contacted_at: new Date().toISOString() }
          : l
      )
    );

    // Registra na sessão e na meta
    incrementDailyCount();
    setSessionContacts((prev) => [
      {
        leadId: currentLead.id,
        leadName: currentLead.name,
        city: currentLead.city,
        channel: 'whatsapp',
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      },
      ...prev.slice(0, 19),
    ]);

    triggerFeedback(`✅ WhatsApp disparado para ${currentLead.name}!`, 'success');

    // Avança para o próximo lead
    if (currentIndex < queue.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  // Ação 1-Clique: CHAMAR NO INSTAGRAM DIRECT
  const handleShootInstagram = async () => {
    if (!currentLead) return;

    // Se o pitch ativo não for de Instagram, pega o texto de Instagram
    let igText = customText;
    const igPitch = pitches.find((p) => p.type === 'instagram_direct');
    if (activePitchType !== 'instagram_direct' && igPitch) {
      igText = igPitch.text;
    }

    await navigator.clipboard.writeText(igText).catch(() => {});

    // Abre a busca do Instagram
    const igUrl = getInstagramSearchUrl(currentLead.name, currentLead.city);
    window.open(igUrl, '_blank', 'noopener,noreferrer');

    // Marca como CONTATADO
    api.movePipelineLead(currentLead.id, 'CONTATADO').catch(() => {});

    setAllLeads((prev) =>
      prev.map((l) =>
        l.id === currentLead.id
          ? { ...l, pipeline_status: 'CONTATADO', contacted_at: new Date().toISOString() }
          : l
      )
    );

    incrementDailyCount();
    setSessionContacts((prev) => [
      {
        leadId: currentLead.id,
        leadName: currentLead.name,
        city: currentLead.city,
        channel: 'instagram',
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      },
      ...prev.slice(0, 19),
    ]);

    triggerFeedback(`📸 Instagram aberto & texto copiado para ${currentLead.name}!`, 'success');

    if (currentIndex < queue.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  // Pular para o próximo lead
  const handleSkipNext = () => {
    if (currentIndex < queue.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      triggerFeedback('Lead pulado ⏩', 'skip');
    }
  };

  // Voltar para o lead anterior
  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  // Favoritar / Desfavoritar
  const handleToggleFavorite = async () => {
    if (!currentLead) return;
    const updated = await api.toggleLeadFavorite(currentLead.id);
    setAllLeads((prev) =>
      prev.map((l) => (l.id === currentLead.id ? { ...l, is_favorite: updated.is_favorite } : l))
    );
    triggerFeedback(
      updated.is_favorite ? '⭐ Lead adicionado aos favoritos!' : 'Lead removido dos favoritos.',
      'favorite'
    );
  };

  // Marcar como Desqualificado / Perdido
  const handleMarkLost = async () => {
    if (!currentLead) return;
    await api.movePipelineLead(currentLead.id, 'PERDIDO');
    setAllLeads((prev) =>
      prev.map((l) => (l.id === currentLead.id ? { ...l, pipeline_status: 'PERDIDO' } : l))
    );
    triggerFeedback('Lead arquivado como sem interesse.', 'skip');
    if (currentIndex < queue.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  // Atalhos de teclado (Espaço/Enter = WhatsApp, I = Instagram, P/Seta Direita = Pular, F = Favorito)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignora se estiver digitando no textarea de edição
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;

      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        handleShootWhatsApp();
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        handleShootInstagram();
      } else if (e.key === 'ArrowRight' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        handleSkipNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleToggleFavorite();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, queue, customText, currentLead]);

  // Cálculos de produtividade
  const goalProgressPercent = Math.min(100, Math.round((todayCount / dailyGoal) * 100));
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  const previewLink = currentLead
    ? `${window.location.origin}/preview?leadId=${currentLead.id}`
    : '';

  return (
    <div className="space-y-6">
      {/* 1. TOPO: BARRA DE GAMIFICAÇÃO & VELOCIDADE (SPEED COCKPIT) */}
      <div className="bg-neutral-900 text-white rounded-2xl p-4 sm:p-5 shadow-sm border border-neutral-800">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Identificação e Meta */}
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Zap className="h-6 w-6 fill-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
                  Esteira Relâmpago de Prospecção
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    <Flame className="h-3 w-3 fill-amber-400" /> 1-Click Speed
                  </span>
                </h2>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Chame dezenas de estabelecimentos no WhatsApp e Direct do Instagram em minutos
              </p>
            </div>
          </div>

          {/* Widgets de Metas e Produtividade */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-6 bg-neutral-950/60 px-4 py-2.5 rounded-xl border border-neutral-800">
            {/* Meta de Abordagens */}
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-[11px] text-neutral-400 font-medium">Contatados Hoje</div>
                <div className="text-base font-bold text-white flex items-center justify-end gap-1.5">
                  <span className="text-amber-400 font-mono">{todayCount}</span>
                  <span className="text-neutral-500 text-xs">/ {dailyGoal}</span>
                </div>
              </div>
              <div className="w-20 bg-neutral-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-400 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${goalProgressPercent}%` }}
                />
              </div>
            </div>

            <div className="h-6 w-px bg-neutral-800 hidden sm:block" />

            {/* Tempo na Sessão */}
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-neutral-400" />
              <div>
                <div className="text-[10px] text-neutral-400">Tempo de Sessão</div>
                <div className="text-xs font-mono font-semibold text-neutral-200">
                  {formatTime(sessionElapsedSeconds)}
                </div>
              </div>
            </div>

            <div className="h-6 w-px bg-neutral-800 hidden sm:block" />

            {/* Disparos nesta sessão */}
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-emerald-400" />
              <div>
                <div className="text-[10px] text-neutral-400">Nesta Sessão</div>
                <div className="text-xs font-mono font-semibold text-emerald-400">
                  {sessionContacts.length} leads
                </div>
              </div>
            </div>

            {/* Botão de Filtros */}
            <button
              onClick={() => setShowFilterDrawer(!showFilterDrawer)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors border border-neutral-700 cursor-pointer ml-auto"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Filtros da Fila</span>
              <span className="bg-neutral-900 px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-400">
                {queue.length}
              </span>
            </button>
          </div>
        </div>

        {/* Barra de Filtros Expansível */}
        {showFilterDrawer && (
          <div className="mt-4 pt-4 border-t border-neutral-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
            <div>
              <label className="block text-neutral-400 mb-1 font-medium">Status do Funil</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentIndex(0);
                }}
                className="w-full bg-neutral-800 text-white rounded-lg px-2.5 py-1.5 border border-neutral-700 focus:outline-hidden"
              >
                <option value="NOT_CONTACTED">Não Contatados (Novos / Prévia)</option>
                <option value="NOVO">Apenas Status NOVO</option>
                <option value="ALL">Todos os Leads</option>
              </select>
            </div>

            <div>
              <label className="block text-neutral-400 mb-1 font-medium">Filtrar por Nicho</label>
              <select
                value={selectedNiche}
                onChange={(e) => {
                  setSelectedNiche(e.target.value);
                  setCurrentIndex(0);
                }}
                className="w-full bg-neutral-800 text-white rounded-lg px-2.5 py-1.5 border border-neutral-700 focus:outline-hidden"
              >
                <option value="ALL">Todos os Nichos</option>
                {availableNiches.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-neutral-400 mb-1 font-medium">Filtrar por Estado</label>
              <select
                value={selectedState}
                onChange={(e) => {
                  setSelectedState(e.target.value);
                  setCurrentIndex(0);
                }}
                className="w-full bg-neutral-800 text-white rounded-lg px-2.5 py-1.5 border border-neutral-700 focus:outline-hidden"
              >
                <option value="ALL">Todos os Estados</option>
                {availableStates.map((st) => (
                  <option key={st} value={st}>
                    {STATE_NAMES[st] ? `${STATE_NAMES[st]} (${st})` : st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-neutral-400 mb-1 font-medium">Meta Diária (Hoje)</label>
              <input
                type="number"
                min="10"
                max="200"
                value={dailyGoal}
                onChange={(e) => handleUpdateGoal(Math.max(1, parseInt(e.target.value, 10) || 50))}
                className="w-full bg-neutral-800 text-white rounded-lg px-2.5 py-1.5 border border-neutral-700 focus:outline-hidden font-mono"
              />
            </div>

            <div className="flex items-end gap-3 pb-1">
              <label className="flex items-center gap-1.5 text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyWithoutWebsite}
                  onChange={(e) => {
                    setOnlyWithoutWebsite(e.target.checked);
                    setCurrentIndex(0);
                  }}
                  className="rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
                />
                <span>Só Sem Site</span>
              </label>

              <label className="flex items-center gap-1.5 text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyWithPhone}
                  onChange={(e) => {
                    setOnlyWithPhone(e.target.checked);
                    setCurrentIndex(0);
                  }}
                  className="rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
                />
                <span>Com Telefone</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* 2. FEEDBACK FLUTUANTE DE AÇÃO */}
      {actionFeedback && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border text-sm font-semibold transition-all animate-bounce ${
            actionFeedback.type === 'success'
              ? 'bg-emerald-950 text-emerald-200 border-emerald-800'
              : actionFeedback.type === 'favorite'
              ? 'bg-amber-950 text-amber-200 border-amber-800'
              : 'bg-neutral-900 text-neutral-200 border-neutral-800'
          }`}
        >
          {actionFeedback.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          ) : actionFeedback.type === 'favorite' ? (
            <Star className="h-5 w-5 text-amber-400 fill-amber-400" />
          ) : (
            <ArrowRight className="h-5 w-5 text-neutral-400" />
          )}
          <span>{actionFeedback.message}</span>
        </div>
      )}

      {/* 2.5 BARRA DE SEPARAÇÃO DE DISPAROS POR NICHO (ABAS RÁPIDAS) */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-2xs space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-100 pb-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Tags className="h-4 w-4 text-amber-500" />
            <span className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
              Separar Disparos por Nicho
            </span>
            {selectedNiche !== 'ALL' ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-400 text-neutral-950 shadow-2xs">
                <span>Foco Ativo: {selectedNiche}</span>
                <span className="bg-neutral-950 text-amber-300 text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                  {queue.length}
                </span>
              </span>
            ) : (
              <span className="text-[11px] text-neutral-500 font-medium">
                (Clique no nicho desejado para disparar mensagens em lote focadas naquele segmento)
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-neutral-500">
            <span>
              Fila: <strong className="text-neutral-900">{queue.length}</strong> de <strong className="text-neutral-900">{allLeads.length}</strong> lojas
            </span>
            {selectedNiche !== 'ALL' && (
              <button
                type="button"
                onClick={() => handleSelectNiche('ALL')}
                className="text-[11px] font-bold text-neutral-700 hover:text-neutral-900 hover:underline cursor-pointer bg-neutral-100 px-2 py-0.5 rounded"
              >
                ✕ Limpar Nicho (Ver Todos)
              </button>
            )}
          </div>
        </div>

        {/* Abas com scroll horizontal suave */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
          {/* Aba: Todos os Nichos */}
          <button
            type="button"
            onClick={() => handleSelectNiche('ALL')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
              selectedNiche === 'ALL'
                ? 'bg-neutral-900 text-white shadow-xs font-bold'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200/80 hover:text-neutral-900'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>Todos os Nichos</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                selectedNiche === 'ALL' ? 'bg-white/20 text-white' : 'bg-neutral-200 text-neutral-700'
              }`}
            >
              {allLeads.length}
            </span>
          </button>

          {/* Abas dinâmicas de cada nicho */}
          {nicheStats.map((item) => {
            const Icon = getNicheIcon(item.niche);
            const isSelected = selectedNiche === item.niche;
            return (
              <button
                key={item.niche}
                type="button"
                onClick={() => handleSelectNiche(item.niche)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-amber-400 text-neutral-950 font-bold shadow-xs border border-amber-500/40 ring-2 ring-amber-300/50'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200/80 hover:text-neutral-900'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-neutral-950' : 'text-neutral-500'}`} />
                <span className="capitalize">{item.niche}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    isSelected ? 'bg-neutral-950 text-amber-300' : 'bg-neutral-200 text-neutral-700'
                  }`}
                  title={`${item.pending} pendentes, ${item.contacted} contatados`}
                >
                  {item.total}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. CONTEÚDO PRINCIPAL: O CARD DE VELOCIDADE OU VAZIO */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-neutral-200 text-center">
          <div className="h-8 w-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin mb-3" />
          <p className="text-sm text-neutral-500 font-medium">Carregando fila de alta conversão...</p>
        </div>
      ) : queue.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-neutral-200 text-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Check className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-neutral-900">
            {selectedNiche !== 'ALL'
              ? `Fila do nicho "${selectedNiche}" zerada ou sem pendências!`
              : 'Parabéns! Fila de Prospecção Zerada'}
          </h3>
          <p className="text-xs text-neutral-500 max-w-md">
            {selectedNiche !== 'ALL'
              ? `Você contatou todos os leads disponíveis para o nicho de ${selectedNiche} ou não há novos estabelecimentos pendentes neste segmento.`
              : 'Você contatou todos os leads deste filtro ou não há mais empresas pendentes. Ajuste os filtros acima ou faça uma nova varredura no Google Places.'}
          </p>
          <div className="flex items-center gap-2 pt-2">
            {selectedNiche !== 'ALL' ? (
              <button
                onClick={() => handleSelectNiche('ALL')}
                className="px-4 py-2 text-xs font-semibold text-neutral-900 bg-amber-400 hover:bg-amber-300 rounded-lg cursor-pointer"
              >
                Ver Outros Nichos ({allLeads.length} lojas)
              </button>
            ) : (
              <button
                onClick={() => {
                  setStatusFilter('ALL');
                  setOnlyWithoutWebsite(false);
                  setOnlyWithPhone(false);
                  setSelectedNiche('ALL');
                  setSelectedState('ALL');
                }}
                className="px-4 py-2 text-xs font-semibold text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
              >
                Resetar Filtros
              </button>
            )}
            {onNavigateToPipeline && (
              <button
                onClick={onNavigateToPipeline}
                className="px-4 py-2 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg cursor-pointer"
              >
                Ver Pipeline Comercial
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* COLUNA ESQUERDA (8 COLUNAS): CARD DO LEAD & GERADOR DE PITCH */}
          <div className="lg:col-span-8 space-y-5">
            {/* Card Principal do Lead */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 shadow-xs relative overflow-hidden">
              {/* Barra superior de status do card */}
              <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-neutral-100">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-neutral-500 bg-neutral-100 px-2.5 py-1 rounded-md">
                    Lead {currentIndex + 1} de {queue.length}
                  </span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      currentLead.pipeline_status === 'CONTATADO'
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : currentLead.pipeline_status === 'NOVO'
                        ? 'bg-neutral-100 text-neutral-800'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}
                  >
                    Status: {currentLead.pipeline_status}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleFavorite}
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                      currentLead.is_favorite
                        ? 'bg-amber-50 text-amber-500 border-amber-200'
                        : 'text-neutral-400 hover:text-amber-500 border-neutral-200 hover:bg-neutral-50'
                    }`}
                    title="Favoritar lead (Atalho: F)"
                  >
                    <Star
                      className={`h-4 w-4 ${currentLead.is_favorite ? 'fill-amber-400' : ''}`}
                    />
                  </button>

                  <button
                    onClick={handleMarkLost}
                    className="p-1.5 text-neutral-400 hover:text-red-500 rounded-lg border border-neutral-200 hover:bg-red-50 transition-colors cursor-pointer"
                    title="Marcar como sem interesse (Atalho: D)"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Informações Centrais do Estabelecimento */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-neutral-900 uppercase tracking-wider px-2 py-0.5 rounded bg-neutral-100 border border-neutral-200">
                      {currentLead.niche}
                    </span>
                    <span className="text-xs text-neutral-500 flex items-center gap-1 font-medium">
                      <MapPin className="h-3 w-3 text-neutral-400" />
                      {currentLead.city} - {currentLead.state}
                    </span>
                  </div>

                  <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900">
                    {currentLead.name}
                  </h3>

                  {currentLead.address && (
                    <p className="text-xs text-neutral-500 leading-relaxed max-w-xl">
                      {currentLead.address}
                    </p>
                  )}
                </div>

                {/* Métricas do Google Maps */}
                <div className="flex flex-row sm:flex-col items-start sm:items-end gap-2 shrink-0">
                  <div className="flex items-center gap-1 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200/80">
                    <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                    <span className="text-sm font-bold text-amber-900">
                      {currentLead.rating ? currentLead.rating.toFixed(1) : '5.0'}
                    </span>
                    <span className="text-[11px] text-amber-700">
                      ({currentLead.reviews_count || 0} reviews)
                    </span>
                  </div>

                  <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Score: {currentLead.lead_score}/100
                  </div>
                </div>
              </div>

              {/* Contato & Links Oficiais */}
              <div className="mt-4 pt-4 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-neutral-800 bg-neutral-50 px-3 py-1.5 rounded-lg border border-neutral-200">
                    <Phone className="h-3.5 w-3.5 text-neutral-500" />
                    {formatBrazilianPhone(currentLead.phone)}
                  </div>

                  <span
                    className={`text-xs px-2.5 py-1 rounded-md font-semibold ${
                      currentLead.website_status === 'no_website' || !currentLead.website
                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}
                  >
                    {currentLead.website_status === 'no_website' || !currentLead.website
                      ? '⚠️ Sem Website Oficial'
                      : 'Website já cadastrado'}
                  </span>
                </div>

                {/* Ações de verificação externa */}
                <div className="flex items-center gap-2">
                  {currentLead.maps_url && (
                    <a
                      href={currentLead.maps_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-neutral-600 hover:text-neutral-900 flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      Google Maps
                    </a>
                  )}

                  <a
                    href={previewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-neutral-900 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-md flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5 text-amber-700" />
                    Ver Prévia Interativa
                  </a>
                </div>
              </div>
            </div>

            {/* Gerador de Mensagens e Canais */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-100">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  <span className="text-xs font-bold uppercase tracking-wider text-neutral-900">
                    Mensagem Otimizada de Abordagem
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {onNavigateToTemplates && (
                    <button
                      onClick={onNavigateToTemplates}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors cursor-pointer"
                      title="Ver todos os modelos de alta conversão ou criar novos"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                      <span>Modelos de Abordagem</span>
                    </button>
                  )}

                  <button
                    onClick={handleCopyText}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-md transition-colors cursor-pointer"
                  >
                    {copiedSuccess ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-600 font-semibold">Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copiar Texto</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Seletor de Modelo de Pitch */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                {pitches.map((p) => (
                  <button
                    key={p.type}
                    onClick={() => setActivePitchType(p.type)}
                    className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-all cursor-pointer ${
                      activePitchType === p.type
                        ? 'bg-neutral-900 text-white shadow-xs font-semibold'
                        : p.type === 'niche_specialized'
                        ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900'
                    }`}
                  >
                    {p.type === 'niche_specialized' && `🎯 Nicho: ${currentLead?.niche || 'Especializado'}`}
                    {p.type === 'mockup' && '⚡ WhatsApp + Mockup'}
                    {p.type === 'instagram_direct' && '📸 Instagram Direct'}
                    {p.type === 'audio_script' && '🎙️ Áudio 20s'}
                    {p.type === 'direct' && '🚀 Venda Express'}
                    {p.type === 'consultive' && '🎯 Consultivo'}
                    {p.type === 'followup_24h' && '🔄 Follow-up 24h'}
                    {p.type === 'followup_72h' && '⏳ Escassez 72h'}
                    {p.type === 'call' && '📞 Ligação'}
                  </button>
                ))}
              </div>

              {/* Textarea do Pitch (Inline Editável) */}
              <div className="relative">
                <textarea
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  rows={8}
                  className="w-full text-xs font-mono p-3.5 rounded-xl border border-neutral-200 bg-neutral-50/50 text-neutral-800 leading-relaxed focus:bg-white focus:border-neutral-900 focus:outline-hidden transition-all resize-y"
                  placeholder="Selecione um modelo de mensagem acima..."
                />
              </div>

              {/* BOTÕES DE DISPARO RÁPIDO 1-CLICK */}
              <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Botão 1-Clique: WhatsApp */}
                <button
                  onClick={handleShootWhatsApp}
                  className="flex items-center justify-center gap-2.5 px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-sm rounded-xl shadow-sm transition-all cursor-pointer group"
                >
                  <MessageCircle className="h-5 w-5 fill-white group-hover:scale-110 transition-transform" />
                  <span>Disparar no WhatsApp</span>
                  <span className="hidden sm:inline-block ml-auto text-[10px] bg-emerald-800/60 px-1.5 py-0.5 rounded font-mono font-normal">
                    Espaço / Enter
                  </span>
                </button>

                {/* Botão 1-Clique: Instagram Direct */}
                <button
                  onClick={handleShootInstagram}
                  className="flex items-center justify-center gap-2.5 px-5 py-3.5 bg-linear-to-r from-purple-600 via-pink-600 to-amber-600 hover:opacity-95 active:scale-[0.99] text-white font-bold text-sm rounded-xl shadow-sm transition-all cursor-pointer group"
                >
                  <Instagram className="h-5 w-5 group-hover:scale-110 transition-transform" />
                  <span>Chamar no Direct</span>
                  <span className="hidden sm:inline-block ml-auto text-[10px] bg-black/30 px-1.5 py-0.5 rounded font-mono font-normal">
                    Tecla I
                  </span>
                </button>
              </div>

              {/* Barra de Navegação Rápida (Pular / Voltar) */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={handlePrev}
                  disabled={currentIndex === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:text-neutral-900 disabled:opacity-40 disabled:hover:text-neutral-600 cursor-pointer"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Anterior (←)</span>
                </button>

                <div className="text-[11px] text-neutral-400 font-mono">
                  {currentIndex + 1} de {queue.length} restantes
                </div>

                <button
                  onClick={handleSkipNext}
                  disabled={currentIndex >= queue.length - 1}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:text-neutral-900 disabled:opacity-40 cursor-pointer"
                >
                  <span>Pular Lead (P / →)</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* COLUNA DIREITA (4 COLUNAS): ATALHOS, DICAS E HISTÓRICO DA SESSÃO */}
          <div className="lg:col-span-4 space-y-5">
            {/* Guia de Atalhos de Teclado Ultra-Rápidos */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-neutral-900">
                <Zap className="h-4 w-4 text-amber-500" />
                <span>Atalhos de Velocidade Extrema</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1 border-b border-neutral-100">
                  <span className="text-neutral-600">Disparar WhatsApp</span>
                  <kbd className="px-2 py-0.5 bg-neutral-100 text-neutral-800 rounded font-mono font-semibold border border-neutral-200">
                    Espaço
                  </kbd>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-neutral-100">
                  <span className="text-neutral-600">Abrir Instagram Direct</span>
                  <kbd className="px-2 py-0.5 bg-neutral-100 text-neutral-800 rounded font-mono font-semibold border border-neutral-200">
                    I
                  </kbd>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-neutral-100">
                  <span className="text-neutral-600">Pular para o Próximo</span>
                  <kbd className="px-2 py-0.5 bg-neutral-100 text-neutral-800 rounded font-mono font-semibold border border-neutral-200">
                    P ou →
                  </kbd>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-neutral-100">
                  <span className="text-neutral-600">Favoritar</span>
                  <kbd className="px-2 py-0.5 bg-neutral-100 text-neutral-800 rounded font-mono font-semibold border border-neutral-200">
                    F
                  </kbd>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-neutral-600">Desqualificar / Sem Interesse</span>
                  <kbd className="px-2 py-0.5 bg-neutral-100 text-neutral-800 rounded font-mono font-semibold border border-neutral-200">
                    D
                  </kbd>
                </div>
              </div>
            </div>

            {/* Dica de Venda Prática (O Segredo dos 100/dia) */}
            <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-amber-900">
                <Flame className="h-4 w-4 text-amber-600 fill-amber-500" />
                <span>Como Bater 50 a 100 Abordagens/Dia</span>
              </div>
              <p className="text-amber-800 leading-relaxed">
                <strong>1. Não fique lendo cada lead por 5 minutos:</strong> o segredo da prospecção é consistência e volume. A mensagem já vem personalizada com o nome, cidade e nota.
              </p>
              <p className="text-amber-800 leading-relaxed">
                <strong>2. Mande o link da demonstração pronta:</strong> Quando o dono da empresa clica e vê a loja dele com site próprio, a curiosidade faz a taxa de resposta explodir.
              </p>
            </div>

            {/* Histórico Recente de Contatos Desta Sessão */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
                <div className="flex items-center gap-2 text-xs font-bold text-neutral-900">
                  <Layers className="h-4 w-4 text-neutral-500" />
                  <span>Histórico Desta Sessão</span>
                </div>
                <span className="text-[11px] font-mono text-neutral-400">
                  {sessionContacts.length} enviados
                </span>
              </div>

              {sessionContacts.length === 0 ? (
                <p className="text-xs text-neutral-400 text-center py-4">
                  Nenhum lead contatado nesta sessão ainda. Clique em Disparar para começar!
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {sessionContacts.map((sc, i) => (
                    <div
                      key={`${sc.leadId}-${i}`}
                      className="flex items-center justify-between text-xs p-2 rounded-lg bg-neutral-50 border border-neutral-100"
                    >
                      <div className="truncate mr-2">
                        <div className="font-semibold text-neutral-900 truncate">
                          {sc.leadName}
                        </div>
                        <div className="text-[10px] text-neutral-400 truncate">
                          {sc.city}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {sc.channel === 'whatsapp' ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            <MessageCircle className="h-3 w-3" /> Zap
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                            <Instagram className="h-3 w-3" /> Direct
                          </span>
                        )}
                        <span className="text-[10px] text-neutral-400 font-mono">{sc.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
