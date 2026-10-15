import React, { useState, useEffect } from 'react';
import {
  Activity as ActivityIcon,
  Search,
  Filter,
  Users,
  RefreshCw,
  Clock,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  DollarSign,
  MessageCircle,
  Lock,
  Unlock,
  KeyRound,
  Layers,
} from 'lucide-react';
import { Activity, Freelancer } from '../../types';
import { api } from '../../lib/api';

export const AuditLogView: React.FC = () => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [selectedFreelancerId, setSelectedFreelancerId] = useState<string>('ALL');
  const [selectedActionType, setSelectedActionType] = useState<string>('ALL');
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);

  const loadActivities = async () => {
    setLoading(true);
    setError(null);
    try {
      const [actData, freeData] = await Promise.all([
        api.adminGetActivities({
          freelancer_id: selectedFreelancerId !== 'ALL' ? selectedFreelancerId : undefined,
          action_type: selectedActionType !== 'ALL' ? selectedActionType : undefined,
          limit: 100,
        }),
        api.adminGetFreelancers().catch(() => []),
      ]);

      setActivities(actData.activities);
      setTotal(actData.total);
      setFreelancers(freeData);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar registros de auditoria.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActivities();
  }, [selectedFreelancerId, selectedActionType]);

  const getActionBadge = (type: string) => {
    switch (type) {
      case 'search_performed':
        return { label: 'Busca Realizada', color: 'bg-amber-100 text-amber-800 border-amber-300' };
      case 'lead_contacted':
        return { label: 'Contato Realizado', color: 'bg-blue-100 text-blue-800 border-blue-300' };
      case 'response_registered':
        return { label: 'Resposta Registrada', color: 'bg-sky-100 text-sky-800 border-sky-300' };
      case 'follow_up_registered':
        return { label: 'Follow-up Registrado', color: 'bg-purple-100 text-purple-800 border-purple-300' };
      case 'negotiation_started':
        return { label: 'Negociação Iniciada', color: 'bg-indigo-100 text-indigo-800 border-indigo-300' };
      case 'sale_registered':
        return { label: 'Venda Fechada', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
      case 'freelancer_blocked':
        return { label: 'Freelancer Bloqueado', color: 'bg-rose-100 text-rose-800 border-rose-300' };
      case 'freelancer_unblocked':
        return { label: 'Freelancer Desbloqueado', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
      case 'access_link_regenerated':
        return { label: 'Link Regenerado', color: 'bg-neutral-100 text-neutral-800 border-neutral-300' };
      case 'login':
        return { label: 'Acesso / Login', color: 'bg-neutral-100 text-neutral-700 border-neutral-300' };
      default:
        return { label: type.replace(/_/g, ' '), color: 'bg-neutral-100 text-neutral-700 border-neutral-200' };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header com Filtros */}
      <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
              <ActivityIcon className="h-5 w-5 text-neutral-700" />
              Auditoria de Atividades & Rastreabilidade
            </h1>
            <p className="text-xs text-neutral-500 mt-0.5">
              Registro histórico completo e inalterável de todas as ações operacionais da equipe
            </p>
          </div>

          <button
            onClick={loadActivities}
            title="Atualizar log"
            className="p-2 border border-neutral-200 hover:bg-neutral-100 rounded-lg text-neutral-600 transition-colors self-start sm:self-auto"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Barra de Filtros */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-neutral-100 text-xs">
          {/* Filtro por Freelancer */}
          <div className="flex items-center gap-1.5 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5">
            <Users className="h-3.5 w-3.5 text-neutral-400" />
            <select
              value={selectedFreelancerId}
              onChange={(e) => setSelectedFreelancerId(e.target.value)}
              className="bg-transparent font-medium text-neutral-800 focus:outline-hidden cursor-pointer"
            >
              <option value="ALL">Todos os Usuários / Freelancers</option>
              {freelancers.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro por Tipo de Ação */}
          <div className="flex items-center gap-1.5 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5">
            <Filter className="h-3.5 w-3.5 text-neutral-400" />
            <select
              value={selectedActionType}
              onChange={(e) => setSelectedActionType(e.target.value)}
              className="bg-transparent font-medium text-neutral-800 focus:outline-hidden cursor-pointer"
            >
              <option value="ALL">Todas as Ações</option>
              <option value="search_performed">Buscas / Varreduras</option>
              <option value="lead_contacted">Contatos Realizados</option>
              <option value="response_registered">Respostas</option>
              <option value="follow_up_registered">Follow-ups</option>
              <option value="negotiation_started">Negociações</option>
              <option value="sale_registered">Vendas Fechadas</option>
              <option value="login">Acessos / Logins</option>
              <option value="freelancer_blocked">Bloqueios de Acesso</option>
              <option value="freelancer_unblocked">Desbloqueios de Acesso</option>
              <option value="access_link_regenerated">Links Regenerados</option>
            </select>
          </div>

          <span className="text-neutral-400 ml-auto font-mono text-[11px]">
            {total} registros encontrados
          </span>
        </div>
      </div>

      {/* Lista de Atividades do Log */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-2xs overflow-hidden">
        {loading && activities.length === 0 ? (
          <div className="p-12 text-center text-xs text-neutral-400">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-neutral-700" />
            Carregando eventos de auditoria...
          </div>
        ) : activities.length === 0 ? (
          <div className="p-12 text-center text-xs text-neutral-400">
            Nenhuma atividade registrada para os filtros selecionados.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {activities.map((act) => {
              const date = new Date(act.created_at);
              const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
              const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const badge = getActionBadge(act.action_type);

              return (
                <div
                  key={act.id}
                  className="p-4 hover:bg-neutral-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-3">
                    <div className="font-mono text-[11px] text-neutral-400 shrink-0 mt-0.5 w-32">
                      <span className="font-semibold text-neutral-700 block">{timeStr}</span>
                      <span className="text-[10px] text-neutral-400">{dateStr}</span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {act.freelancer_name && (
                          <span className="font-bold text-neutral-900 bg-neutral-100 px-2 py-0.5 rounded text-[11px]">
                            {act.freelancer_name}
                          </span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase tracking-wider ${badge.color}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-neutral-800 text-xs font-medium leading-relaxed">
                        {act.description}
                      </p>
                    </div>
                  </div>

                  {act.metadata && Object.keys(act.metadata).length > 0 && (
                    <div className="sm:text-right shrink-0">
                      <div className="font-mono text-[10px] text-neutral-400 bg-neutral-50 px-2.5 py-1 rounded border border-neutral-100 max-w-xs truncate">
                        {JSON.stringify(act.metadata)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
