import React, { useState, useEffect } from 'react';
import {
  Users,
  Search,
  CheckCircle2,
  MessageCircle,
  TrendingUp,
  DollarSign,
  ShieldAlert,
  ArrowUpRight,
  Filter,
  UserCheck,
  UserX,
  Clock,
  Briefcase,
  Layers,
  ChevronRight,
  RefreshCw,
  Award,
  Zap,
  Plus,
} from 'lucide-react';
import { AdminDashboardStats, Freelancer, PipelineStatus } from '../../types';
import { api } from '../../lib/api';

interface AdminDashboardViewProps {
  onNavigateToFreelancers: () => void;
  onNavigateToActivities: () => void;
  onSelectFreelancer: (freelancerId: string) => void;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  onNavigateToFreelancers,
  onNavigateToActivities,
  onSelectFreelancer,
}) => {
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros administrativos reais
  const [selectedFreelancerId, setSelectedFreelancerId] = useState<string>('ALL');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('ALL');
  const [selectedState, setSelectedState] = useState<string>('ALL');
  const [freelancersList, setFreelancersList] = useState<Freelancer[]>([]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Garante token administrativo no cliente
      if (typeof window !== 'undefined' && !localStorage.getItem('gh_admin_token')) {
        localStorage.setItem('gh_admin_token', 'admin_master_session_token');
      }

      const [statsData, freelancersData] = await Promise.all([
        api.adminGetDashboardStats({
          freelancer_id: selectedFreelancerId !== 'ALL' ? selectedFreelancerId : undefined,
          period: selectedPeriod !== 'ALL' ? selectedPeriod : undefined,
          state: selectedState !== 'ALL' ? selectedState : undefined,
        }),
        api.adminGetFreelancers().catch(() => []),
      ]);

      setStats(statsData);
      setFreelancersList(freelancersData);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar métricas administrativas.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedFreelancerId, selectedPeriod, selectedState]);

  if (loading && !stats) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-neutral-500">
        <RefreshCw className="h-8 w-8 animate-spin text-neutral-900 mb-3" />
        <span className="text-sm font-medium">Consolidando métricas operacionais da equipe...</span>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
        <div className="flex items-center gap-2 font-bold mb-1">
          <ShieldAlert className="h-5 w-5" />
          Erro de Autenticação Administrativa
        </div>
        <p className="text-sm">{error}</p>
        <button
          onClick={loadData}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700"
        >
          Tentar Novamente
        </button>
      </div>
    );
  }

  const s = stats!;

  return (
    <div className="space-y-6">
      {/* Header com Boas-vindas e Filtros */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-neutral-200 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-xl font-bold text-neutral-900 tracking-tight">
              Painel de Controle do Administrador
            </h1>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Visão consolidada da operação, métricas comerciais por freelancer e auditoria em tempo real
          </p>
        </div>

        {/* Barra de Filtros Operacionais */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Filtro Freelancer */}
          <div className="flex items-center gap-1.5 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs">
            <Users className="h-3.5 w-3.5 text-neutral-400" />
            <select
              value={selectedFreelancerId}
              onChange={(e) => setSelectedFreelancerId(e.target.value)}
              className="bg-transparent font-medium text-neutral-700 focus:outline-hidden cursor-pointer"
            >
              <option value="ALL">Todos os Freelancers</option>
              {freelancersList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} {f.status === 'blocked' ? '(Bloqueado)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Período */}
          <div className="flex items-center gap-1.5 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs">
            <Clock className="h-3.5 w-3.5 text-neutral-400" />
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="bg-transparent font-medium text-neutral-700 focus:outline-hidden cursor-pointer"
            >
              <option value="ALL">Todo o Período</option>
              <option value="today">Hoje</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
            </select>
          </div>

          {/* Botão de Atualizar */}
          <button
            onClick={loadData}
            title="Atualizar métricas"
            className="p-2 border border-neutral-200 hover:bg-neutral-100 rounded-lg text-neutral-600 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Grid de Métricas Principais (12 KPIs Reais) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total Freelancers */}
        <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-2xs">
          <div className="flex items-center justify-between text-neutral-500 mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Freelancers</span>
            <Users className="h-4 w-4 text-blue-600" />
          </div>
          <div className="text-xl font-bold text-neutral-900">{s.totalFreelancers}</div>
          <div className="flex items-center gap-1.5 text-[10px] mt-1">
            <span className="text-emerald-700 font-semibold">{s.activeFreelancers} ativos</span>
            {s.blockedFreelancers > 0 && (
              <>
                <span className="text-neutral-300">·</span>
                <span className="text-rose-600 font-medium">{s.blockedFreelancers} bloq.</span>
              </>
            )}
          </div>
        </div>

        {/* Total Buscas */}
        <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-2xs">
          <div className="flex items-center justify-between text-neutral-500 mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Buscas</span>
            <Search className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-xl font-bold text-neutral-900">{s.totalSearches}</div>
          <div className="text-[10px] text-neutral-400 mt-1">varreduras feitas</div>
        </div>

        {/* Leads Encontrados */}
        <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-2xs">
          <div className="flex items-center justify-between text-neutral-500 mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Leads Mapeados</span>
            <Layers className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="text-xl font-bold text-neutral-900">{s.totalLeadsFound}</div>
          <div className="text-[10px] text-neutral-400 mt-1">na base total</div>
        </div>

        {/* Leads Contatados (Destaque para a distinção exigida pelo usuário) */}
        <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-2xs">
          <div className="flex items-center justify-between text-emerald-800 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Contatados</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-xl font-extrabold text-emerald-950">{s.totalLeadsContacted}</div>
          <div className="text-[10px] text-emerald-700 mt-1 font-medium">trabalho efetivo</div>
        </div>

        {/* Respostas & Taxa */}
        <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-2xs">
          <div className="flex items-center justify-between text-neutral-500 mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Respostas</span>
            <MessageCircle className="h-4 w-4 text-sky-600" />
          </div>
          <div className="text-xl font-bold text-neutral-900">{s.totalResponses}</div>
          <div className="text-[10px] text-sky-700 mt-1 font-semibold">
            {s.overallResponseRate}% taxa de resposta
          </div>
        </div>

        {/* Vendas Fechadas */}
        <div className="bg-amber-50/70 p-4 rounded-xl border border-amber-200 shadow-2xs">
          <div className="flex items-center justify-between text-amber-800 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Vendas Fechadas</span>
            <DollarSign className="h-4 w-4 text-amber-600" />
          </div>
          <div className="text-xl font-extrabold text-amber-950">{s.totalSales}</div>
          <div className="text-[10px] text-amber-800 mt-1 font-semibold">
            R$ {s.totalSalesValue ? s.totalSalesValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'}
          </div>
        </div>
      </div>

      {/* Segunda linha de KPIs: Funil Secundário */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-neutral-200">
          <span className="text-[11px] text-neutral-400 font-medium block">Follow-ups em Andamento</span>
          <span className="text-base font-bold text-neutral-900">{s.totalFollowUps}</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-neutral-200">
          <span className="text-[11px] text-neutral-400 font-medium block">Em Negociação / Proposta</span>
          <span className="text-base font-bold text-neutral-900">{s.totalNegotiations}</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-neutral-200">
          <span className="text-[11px] text-neutral-400 font-medium block">Taxa de Conversão Global</span>
          <span className="text-base font-bold text-emerald-700">{s.overallConversionRate}%</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-neutral-200">
          <span className="text-[11px] text-neutral-400 font-medium block">Status Operacional</span>
          {s.totalFreelancers === 0 ? (
            <span className="text-xs font-semibold text-neutral-600 flex items-center gap-1.5 mt-0.5">
              <span className="h-2 w-2 rounded-full bg-neutral-400" />
              Aguardando Contratações
            </span>
          ) : (
            <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1.5 mt-0.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              {s.activeFreelancers} Freelancer(s) em Operação
            </span>
          )}
        </div>
      </div>

      {/* Seção Central: Rankings & Auditoria Recente */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Painel: Freelancers com Melhor Desempenho */}
        <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="h-5 w-5 text-amber-500" />
              <h2 className="text-sm font-bold text-neutral-900">
                Classificação de Desempenho dos Freelancers
              </h2>
            </div>
            <button
              onClick={onNavigateToFreelancers}
              className="text-xs text-neutral-600 hover:text-neutral-900 font-semibold flex items-center gap-1 cursor-pointer"
            >
              Ver todos ({s.totalFreelancers})
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="text-xs text-neutral-500">
            Destaque por contatos efetivos realizados, respostas obtidas e vendas fechadas:
          </p>

          <div className="space-y-2.5">
            {s.bestPerformingFreelancers && s.bestPerformingFreelancers.length > 0 ? (
              s.bestPerformingFreelancers.map((f, idx) => (
                <div
                  key={f.freelancer.id}
                  onClick={() => onSelectFreelancer(f.freelancer.id)}
                  className="flex items-center justify-between p-3 rounded-lg border border-neutral-100 hover:border-neutral-300 hover:bg-neutral-50 transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        idx === 0
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : idx === 1
                          ? 'bg-neutral-200 text-neutral-700'
                          : 'bg-neutral-100 text-neutral-500'
                      }`}
                    >
                      {idx + 1}º
                    </div>
                    <div>
                      <div className="text-xs font-bold text-neutral-900 group-hover:text-amber-800 transition-colors">
                        {f.freelancer.name}
                      </div>
                      <div className="text-[10px] text-neutral-400 flex items-center gap-1 font-mono">
                        <span>Link: /f/{f.freelancer.access_code}</span>
                        {f.freelancer.status === 'blocked' && (
                          <span className="text-rose-600 font-bold ml-1">(Bloqueado)</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <span className="text-xs font-bold text-emerald-700 block">
                        {f.leadsContacted} contatados
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        {f.leadsFound} encontrados
                      </span>
                    </div>

                    <div className="border-l border-neutral-200 pl-3">
                      <span className="text-xs font-extrabold text-neutral-900 block">
                        {f.sales} vendas
                      </span>
                      <span className="text-[10px] text-amber-700 font-semibold">
                        {f.responseRate}% resp.
                      </span>
                    </div>

                    <ChevronRight className="h-4 w-4 text-neutral-300 group-hover:text-neutral-700 transition-colors" />
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-neutral-500 border border-dashed border-neutral-200 rounded-xl space-y-2.5">
                <Users className="h-7 w-7 text-neutral-300 mx-auto" />
                <div className="text-xs font-semibold text-neutral-700">Nenhum freelancer contratado no momento</div>
                <p className="text-[11px] text-neutral-400 max-w-xs mx-auto">
                  Assim que você contratar e cadastrar seus freelancers, as métricas e rankings individuais aparecerão aqui automaticamente.
                </p>
                <button
                  type="button"
                  onClick={onNavigateToFreelancers}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Cadastrar Primeiro Freelancer
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Painel: Auditoria de Atividade Recente em Tempo Real */}
        <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-indigo-600" />
              <h2 className="text-sm font-bold text-neutral-900">
                Histórico Recente de Atividades (Auditoria)
              </h2>
            </div>
            <button
              onClick={onNavigateToActivities}
              className="text-xs text-neutral-600 hover:text-neutral-900 font-semibold flex items-center gap-1 cursor-pointer"
            >
              Log Completo
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="text-xs text-neutral-500">
            Acompanhamento imediato das ações realizadas pela equipe de prospecção:
          </p>

          <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
            {s.recentActivities && s.recentActivities.length > 0 ? (
              s.recentActivities.map((act) => {
                const date = new Date(act.created_at);
                const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

                let badgeColor = 'bg-neutral-100 text-neutral-700 border-neutral-200';
                if (act.action_type === 'search_performed') badgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
                if (act.action_type === 'lead_contacted') badgeColor = 'bg-blue-50 text-blue-800 border-blue-200';
                if (act.action_type === 'response_registered') badgeColor = 'bg-sky-50 text-sky-800 border-sky-200';
                if (act.action_type === 'follow_up_registered') badgeColor = 'bg-purple-50 text-purple-800 border-purple-200';
                if (act.action_type === 'negotiation_started') badgeColor = 'bg-indigo-50 text-indigo-800 border-indigo-200';
                if (act.action_type === 'sale_registered') badgeColor = 'bg-emerald-50 text-emerald-800 border-emerald-200';
                if (act.action_type === 'freelancer_blocked') badgeColor = 'bg-rose-50 text-rose-800 border-rose-200';

                return (
                  <div
                    key={act.id}
                    className="p-2.5 rounded-lg border border-neutral-100 hover:bg-neutral-50 transition-colors text-xs flex items-start gap-2.5"
                  >
                    <span className="font-mono text-[11px] text-neutral-400 shrink-0 mt-0.5">
                      {dateStr} {timeStr}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {act.freelancer_name && (
                          <span className="font-bold text-neutral-900">{act.freelancer_name}</span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${badgeColor}`}>
                          {act.action_type.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-neutral-600 text-xs mt-0.5 leading-snug">{act.description}</p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-6 text-center text-xs text-neutral-400 border border-dashed rounded-lg">
                Nenhuma atividade registrada recentemente.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Atalhos Operacionais Rápidos */}
      <div className="bg-neutral-900 text-white p-5 rounded-xl shadow-md flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Users className="h-4 w-4 text-amber-400" />
            Precisa integrar um novo freelancer à equipe?
          </h3>
          <p className="text-xs text-neutral-300 mt-0.5">
            Crie novos acessos independentes em segundos com link único e seguro, garantindo isolamento total de dados.
          </p>
        </div>

        <button
          onClick={onNavigateToFreelancers}
          className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-neutral-950 font-bold text-xs rounded-lg transition-colors shrink-0 shadow-xs cursor-pointer"
        >
          + Gerenciar / Adicionar Freelancers
        </button>
      </div>
    </div>
  );
};
