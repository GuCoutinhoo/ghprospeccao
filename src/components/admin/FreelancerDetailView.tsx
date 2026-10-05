import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Users,
  Copy,
  Check,
  RefreshCw,
  Lock,
  Unlock,
  Layers,
  CheckCircle2,
  MessageCircle,
  TrendingUp,
  DollarSign,
  Search,
  Calendar,
  Clock,
  MapPin,
  Phone,
  Eye,
  ChevronRight,
  ShieldAlert,
  Activity as ActivityIcon,
  Briefcase,
  Flame,
  Award,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import {
  Freelancer,
  FreelancerPerformance,
  Lead,
  SearchJob,
  Activity,
} from '../../types';
import { api } from '../../lib/api';

interface FreelancerDetailViewProps {
  freelancerId: string;
  onBack: () => void;
  onSelectLead: (lead: Lead) => void;
}

export const FreelancerDetailView: React.FC<FreelancerDetailViewProps> = ({
  freelancerId,
  onBack,
  onSelectLead,
}) => {
  const [freelancer, setFreelancer] = useState<Freelancer | null>(null);
  const [performance, setPerformance] = useState<FreelancerPerformance | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searches, setSearches] = useState<SearchJob[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'activities' | 'leads' | 'searches' | 'sales' | 'performance'>('activities');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [fData, leadsData, searchesData, activitiesData] = await Promise.all([
        api.adminGetFreelancerById(freelancerId),
        api.adminGetFreelancerLeads(freelancerId),
        api.adminGetFreelancerSearches(freelancerId),
        api.adminGetFreelancerActivities(freelancerId),
      ]);

      setFreelancer(fData.freelancer);
      setPerformance(fData.performance || null);
      setLeads(leadsData?.leads || []);
      setSearches(searchesData || []);
      setActivities(activitiesData?.activities || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar dados do freelancer.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [freelancerId]);

  const handleCopyLink = () => {
    if (!freelancer) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ghprospeccao.com';
    navigator.clipboard.writeText(`${origin}/f/${freelancer.access_code}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleBlockToggle = async () => {
    if (!freelancer) return;
    try {
      if (freelancer.status === 'blocked') {
        const res = await api.adminUnblockFreelancer(freelancer.id);
        setFreelancer(res.freelancer);
      } else {
        const res = await api.adminBlockFreelancer(freelancer.id);
        setFreelancer(res.freelancer);
      }
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRegenerateLink = async () => {
    if (!freelancer) return;
    try {
      const res = await api.adminRegenerateLink(freelancer.id);
      setFreelancer(res.freelancer);
      setActionNotice(`Novo link gerado com sucesso: /f/${res.accessCode}`);
      setTimeout(() => setActionNotice(null), 5000);
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleConfirmDeleteWorkspace = async () => {
    if (!freelancer) return;
    setIsDeleting(true);
    try {
      await api.adminDeleteFreelancer(freelancer.id);
      setIsDeleteModalOpen(false);
      onBack();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao excluir workspace.';
      setError(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading && !freelancer) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-neutral-500">
        <RefreshCw className="h-8 w-8 animate-spin text-neutral-900 mb-3" />
        <span className="text-sm font-medium">Carregando perfil e histórico do freelancer...</span>
      </div>
    );
  }

  if (error || !freelancer) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
        <div className="flex items-center gap-2 font-bold mb-1">
          <ShieldAlert className="h-5 w-5" />
          Erro
        </div>
        <p className="text-sm">{error || 'Freelancer não encontrado.'}</p>
        <button
          onClick={onBack}
          className="mt-4 px-4 py-2 bg-neutral-900 text-white rounded-lg text-xs font-semibold hover:bg-neutral-800"
        >
          Voltar para Lista
        </button>
      </div>
    );
  }

  const p = performance;
  const isBlocked = freelancer.status === 'blocked';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ghprospeccao.com';
  const accessUrl = `${origin}/f/${freelancer.access_code}`;

  return (
    <div className="space-y-6">
      {/* Botão Voltar */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para a Lista de Freelancers
      </button>

      {/* Header do Perfil do Freelancer */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-2xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-2xl bg-neutral-900 text-white font-extrabold text-lg flex items-center justify-center shadow-sm shrink-0">
              {freelancer.name.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-bold text-neutral-900">{freelancer.name}</h1>
                {isBlocked ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
                    <Lock className="h-3 w-3" />
                    Acesso Desativado / Bloqueado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Ativo no Workspace
                  </span>
                )}
              </div>
              <div className="text-xs text-neutral-500 mt-1 flex flex-wrap items-center gap-3">
                <span>{freelancer.email}</span>
                <span className="text-neutral-300">·</span>
                <span>
                  Cadastrado em:{' '}
                  {new Date(freelancer.created_at).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}
                </span>
                <span className="text-neutral-300">·</span>
                <span>
                  Último acesso:{' '}
                  {freelancer.last_access_at
                    ? new Date(freelancer.last_access_at).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Ainda não acessou'}
                </span>
              </div>
            </div>
          </div>

          {/* Ações Administrativas do Perfil */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleBlockToggle}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                isBlocked
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-rose-600 hover:bg-rose-700 text-white'
              }`}
            >
              {isBlocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {isBlocked ? 'Desbloquear Acesso' : 'Bloquear Acesso'}
            </button>

            <button
              onClick={handleRegenerateLink}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg text-xs font-bold transition-colors cursor-pointer"
              title="Gera um novo código seguro de acesso"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerar Link
            </button>

            <button
              onClick={() => setIsDeleteModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
              title="Excluir este workspace e remover o freelancer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir Workspace
            </button>
          </div>
        </div>

        {/* Notificação de Ação */}
        {actionNotice && (
          <div className="bg-neutral-900 text-white p-3 rounded-xl text-xs flex items-center justify-between gap-2 shadow-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>{actionNotice}</span>
            </div>
            <button onClick={() => setActionNotice(null)} className="text-neutral-400 hover:text-white">
              ✕
            </button>
          </div>
        )}

        {/* Banner do Link Exclusivo do Freelancer */}
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5">
            <span className="font-bold text-neutral-700 block">Link de Acesso Único do Freelancer:</span>
            <code className="font-mono text-neutral-800 font-semibold select-all break-all">
              {accessUrl}
            </code>
          </div>

          <button
            onClick={handleCopyLink}
            className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors shrink-0 ${
              copiedLink
                ? 'bg-emerald-600 text-white'
                : 'bg-neutral-900 text-white hover:bg-neutral-800'
            }`}
          >
            {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedLink ? 'Copiado!' : 'Copiar Link'}
          </button>
        </div>
      </div>

      {/* Grid de Métricas de Performance (Diferenciação clara entre Encontrados e Contatados) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {/* Leads Encontrados */}
        <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-2xs">
          <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider block">
            Leads Mapeados
          </span>
          <div className="text-xl font-bold text-neutral-900 mt-1">{p?.leadsFound || 0}</div>
          <span className="text-[10px] text-neutral-400">total na esteira</span>
        </div>

        {/* Leads Efetivamente Contatados (Destaque Principal) */}
        <div className="bg-emerald-50/80 p-4 rounded-xl border border-emerald-200 shadow-2xs">
          <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider block">
            Leads Contatados
          </span>
          <div className="text-xl font-extrabold text-emerald-950 mt-1">
            {p?.leadsContacted || 0}
          </div>
          <span className="text-[10px] text-emerald-700 font-medium">trabalho real executado</span>
        </div>

        {/* Tentativas de Contato */}
        <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-2xs">
          <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider block">
            Tentativas de Contato
          </span>
          <div className="text-xl font-bold text-neutral-900 mt-1">
            {p?.contactAttempts || 0}
          </div>
          <span className="text-[10px] text-neutral-400">abordagens disparadas</span>
        </div>

        {/* Respostas & Taxa */}
        <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-2xs">
          <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider block">
            Respostas Obtidas
          </span>
          <div className="text-xl font-bold text-sky-800 mt-1">{p?.responses || 0}</div>
          <span className="text-[10px] text-sky-700 font-semibold">
            {p?.responseRate || 0}% taxa de resposta
          </span>
        </div>

        {/* Negociações */}
        <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-2xs">
          <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider block">
            Negociações
          </span>
          <div className="text-xl font-bold text-indigo-900 mt-1">{p?.negotiations || 0}</div>
          <span className="text-[10px] text-neutral-400">{p?.followUps || 0} follow-ups</span>
        </div>

        {/* Vendas Fechadas */}
        <div className="bg-amber-50/80 p-4 rounded-xl border border-amber-200 shadow-2xs">
          <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider block">
            Vendas Concluídas
          </span>
          <div className="text-xl font-extrabold text-amber-950 mt-1">{p?.sales || 0}</div>
          <span className="text-[10px] text-amber-800 font-semibold">
            {p?.conversionRate || 0}% de conversão
          </span>
        </div>
      </div>

      {/* Navegação por Abas do Freelancer */}
      <div className="flex items-center gap-1.5 border-b border-neutral-200 pb-2 overflow-x-auto text-xs font-semibold">
        <button
          onClick={() => setActiveTab('activities')}
          className={`px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
            activeTab === 'activities'
              ? 'bg-neutral-900 text-white'
              : 'text-neutral-600 hover:bg-neutral-100'
          }`}
        >
          <ActivityIcon className="h-3.5 w-3.5" />
          Histórico de Atividades ({activities.length})
        </button>

        <button
          onClick={() => setActiveTab('leads')}
          className={`px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
            activeTab === 'leads'
              ? 'bg-neutral-900 text-white'
              : 'text-neutral-600 hover:bg-neutral-100'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          Leads Atribuídos ({leads.length})
        </button>

        <button
          onClick={() => setActiveTab('searches')}
          className={`px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
            activeTab === 'searches'
              ? 'bg-neutral-900 text-white'
              : 'text-neutral-600 hover:bg-neutral-100'
          }`}
        >
          <Search className="h-3.5 w-3.5" />
          Varreduras / Buscas ({searches.length})
        </button>

        <button
          onClick={() => setActiveTab('sales')}
          className={`px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
            activeTab === 'sales'
              ? 'bg-neutral-900 text-white'
              : 'text-neutral-600 hover:bg-neutral-100'
          }`}
        >
          <DollarSign className="h-3.5 w-3.5" />
          Vendas & Negociações ({leads.filter((l) => l.pipeline_status === 'FECHADO' || l.pipeline_status === 'NEGOCIACAO').length})
        </button>

        <button
          onClick={() => setActiveTab('performance')}
          className={`px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
            activeTab === 'performance'
              ? 'bg-neutral-900 text-white'
              : 'text-neutral-600 hover:bg-neutral-100'
          }`}
        >
          <TrendingUp className="h-3.5 w-3.5" />
          Tendência por Dia & Metas
        </button>
      </div>

      {/* CONTEÚDO DAS ABAS */}

      {/* ABA 1: HISTÓRICO DE ATIVIDADES (AUDITORIA DO FREELANCER) */}
      {activeTab === 'activities' && (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-2xs p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-neutral-900">
              Registro de Auditoria de Ações de {freelancer.name}
            </h2>
            <span className="text-xs text-neutral-400 font-mono">Total: {activities.length} ações</span>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {activities.length > 0 ? (
              activities.map((act) => {
                const date = new Date(act.created_at);
                const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

                return (
                  <div
                    key={act.id}
                    className="p-3 rounded-lg border border-neutral-100 hover:bg-neutral-50 transition-colors text-xs flex items-start gap-3"
                  >
                    <div className="font-mono text-[11px] text-neutral-400 shrink-0 mt-0.5">
                      {dateStr} — {timeStr}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-neutral-900">{act.description}</span>
                      </div>
                      {act.metadata && Object.keys(act.metadata).length > 0 && (
                        <div className="text-[10px] text-neutral-400 font-mono mt-1">
                          {JSON.stringify(act.metadata)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center text-xs text-neutral-400">
                Nenhuma atividade registrada para este freelancer até o momento.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 2: LEADS DO FREELANCER */}
      {activeTab === 'leads' && (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-neutral-900">
              Leads Isolados no Workspace de {freelancer.name}
            </h2>
            <span className="text-xs text-neutral-500 font-medium">
              {leads.length} estabelecimentos
            </span>
          </div>

          {leads.length === 0 ? (
            <div className="p-8 text-center text-xs text-neutral-400">
              Este freelancer ainda não captou leads através de buscas.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                    <th className="py-2.5 px-4">Estabelecimento</th>
                    <th className="py-2.5 px-4">Localização & Nicho</th>
                    <th className="py-2.5 px-4">Status no Funil</th>
                    <th className="py-2.5 px-4">Telefone</th>
                    <th className="py-2.5 px-4">Tentativas</th>
                    <th className="py-2.5 px-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {leads.map((l) => (
                    <tr key={l.id} className="hover:bg-neutral-50/80 transition-colors">
                      <td className="py-3 px-4 font-bold text-neutral-900">{l.name}</td>
                      <td className="py-3 px-4 text-neutral-500">
                        {l.city} - {l.state} · <span className="text-neutral-700">{l.niche}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-100 text-neutral-800 border">
                          {l.pipeline_status}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-neutral-600">{l.phone || 'Sem fone'}</td>
                      <td className="py-3 px-4 font-semibold text-neutral-700">
                        {l.contact_attempts_count || (l.contacted_at ? 1 : 0)} abordagens
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => onSelectLead(l)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded transition-colors cursor-pointer"
                        >
                          Ver Detalhes
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ABA 3: HISTÓRICO DE BUSCAS DO FREELANCER */}
      {activeTab === 'searches' && (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-2xs p-5 space-y-4">
          <h2 className="text-sm font-bold text-neutral-900">
            Varreduras Geográficas Executadas por {freelancer.name}
          </h2>

          <div className="space-y-3">
            {searches.length > 0 ? (
              searches.map((j) => (
                <div
                  key={j.id}
                  className="p-3.5 rounded-xl border border-neutral-200 bg-neutral-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Search className="h-3.5 w-3.5 text-neutral-500" />
                      <span className="font-bold text-neutral-900 text-sm">{j.niche}</span>
                      <span className="text-neutral-400">em</span>
                      <span className="font-medium text-neutral-700">{j.city}, {j.state}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-200 text-neutral-700 uppercase">
                        {j.status}
                      </span>
                    </div>
                    <div className="text-neutral-400 text-[11px]">
                      Iniciado em: {new Date(j.created_at).toLocaleString('pt-BR')}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-right font-mono">
                    <div>
                      <span className="text-neutral-400 block text-[10px]">Leads Obtidos</span>
                      <span className="font-bold text-sm text-neutral-900">{j.leads_created || j.places_found || 0}</span>
                    </div>
                    {j.target_leads ? (
                      <div>
                        <span className="text-neutral-400 block text-[10px]">Meta</span>
                        <span className="font-bold text-sm text-neutral-700">{j.target_leads}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-xs text-neutral-400">
                Nenhuma busca iniciada por este freelancer.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 4: VENDAS & NEGOCIAÇÕES */}
      {activeTab === 'sales' && (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-2xs p-5 space-y-4">
          <h2 className="text-sm font-bold text-neutral-900">
            Oportunidades em Negociação e Vendas Fechadas
          </h2>

          <div className="space-y-2.5">
            {leads.filter((l) => l.pipeline_status === 'FECHADO' || l.pipeline_status === 'NEGOCIACAO').length > 0 ? (
              leads
                .filter((l) => l.pipeline_status === 'FECHADO' || l.pipeline_status === 'NEGOCIACAO')
                .map((l) => (
                  <div
                    key={l.id}
                    className="p-3.5 rounded-xl border border-neutral-200 flex items-center justify-between gap-4 text-xs"
                  >
                    <div>
                      <div className="font-bold text-neutral-900">{l.name}</div>
                      <div className="text-neutral-500 text-[11px]">
                        {l.city} - {l.state} · Nicho: {l.niche}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <span
                        className={`px-2.5 py-1 rounded text-xs font-bold ${
                          l.pipeline_status === 'FECHADO'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                        }`}
                      >
                        {l.pipeline_status === 'FECHADO' ? 'VENDA FECHADA' : 'EM NEGOCIAÇÃO'}
                      </span>

                      {l.sale_value ? (
                        <span className="font-bold text-neutral-900 text-sm">
                          R$ {l.sale_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      ) : null}

                      <button
                        onClick={() => onSelectLead(l)}
                        className="px-3 py-1 bg-neutral-900 text-white rounded font-semibold text-xs"
                      >
                        Abrir Lead
                      </button>
                    </div>
                  </div>
                ))
            ) : (
              <div className="p-8 text-center text-xs text-neutral-400">
                Nenhum lead em fase de negociação ou venda registrada ainda.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 5: DESEMPENHO E TENDÊNCIAS POR DIA */}
      {activeTab === 'performance' && (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-2xs p-5 space-y-6">
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-neutral-900">
              Tendência de Produtividade Diária (Últimos 7 Dias)
            </h2>
            <p className="text-xs text-neutral-500">
              Comparativo de leads encontrados vs contatos efetivos realizados por dia:
            </p>
          </div>

          <div className="grid grid-cols-7 gap-2 pt-4">
            {p?.leadsPerDay?.map((d, idx) => {
              const contacts = p.contactsPerDay?.[idx]?.count || 0;
              return (
                <div key={d.date} className="text-center bg-neutral-50 p-3 rounded-lg border border-neutral-200">
                  <span className="text-[11px] font-bold text-neutral-600 block">{d.date}</span>
                  <div className="mt-2 space-y-1">
                    <span className="text-xs font-bold text-neutral-900 block">
                      {d.count} <span className="text-[10px] font-normal text-neutral-400">mapeados</span>
                    </span>
                    <span className="text-xs font-extrabold text-emerald-700 block">
                      {contacts} <span className="text-[10px] font-normal text-emerald-600">contatados</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-neutral-100 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="bg-neutral-50 p-3 rounded-lg border">
              <span className="text-neutral-400 block font-medium">Dias Ativos na Plataforma</span>
              <span className="text-base font-bold text-neutral-900">{p?.activeDays || 1} dias</span>
            </div>
            <div className="bg-neutral-50 p-3 rounded-lg border">
              <span className="text-neutral-400 block font-medium">Média de Leads / Dia Ativo</span>
              <span className="text-base font-bold text-neutral-900">
                {p?.activeDays && p.leadsFound ? Math.round(p.leadsFound / p.activeDays) : 0} leads/dia
              </span>
            </div>
            <div className="bg-neutral-50 p-3 rounded-lg border">
              <span className="text-neutral-400 block font-medium">Média de Contatos / Dia Ativo</span>
              <span className="text-base font-bold text-emerald-700">
                {p?.activeDays && p.leadsContacted ? Math.round(p.leadsContacted / p.activeDays) : 0} contatos/dia
              </span>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO DE WORKSPACE */}
      {isDeleteModalOpen && freelancer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl border border-neutral-200 shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 pb-3 border-b border-neutral-100">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-neutral-900">
                  Excluir Workspace de {freelancer.name}?
                </h3>
                <p className="text-xs text-neutral-500">
                  Código: <code className="font-mono font-semibold text-neutral-700">{freelancer.access_code}</code>
                </p>
              </div>
            </div>

            <div className="py-4 space-y-2 text-xs text-neutral-600">
              <p>
                Tem certeza de que deseja apagar permanentemente este workspace?
              </p>
              <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  O link exclusivo <code className="font-mono font-semibold">/f/{freelancer.access_code}</code> será cancelado imediatamente e os dados associados a este workspace serão excluídos.
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteWorkspace}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Excluindo...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    Sim, Excluir Workspace
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
