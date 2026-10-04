import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Pause,
  Play,
  XCircle,
  RotateCw,
  Building2,
  MapPin,
  Globe,
  Users,
  CheckCircle2,
  AlertCircle,
  Clock,
  Terminal,
  ExternalLink,
} from 'lucide-react';
import { SearchJob, SearchArea, SearchQueryLog } from '../../types';
import { api } from '../../lib/api';

interface SearchJobDetailViewProps {
  jobId: string;
  onBack: () => void;
  onViewLeads: (niche?: string, state?: string) => void;
}

export const SearchJobDetailView: React.FC<SearchJobDetailViewProps> = ({
  jobId,
  onBack,
  onViewLeads,
}) => {
  const [job, setJob] = useState<SearchJob | null>(null);
  const [areas, setAreas] = useState<SearchArea[]>([]);
  const [queries, setQueries] = useState<SearchQueryLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Polling a cada 2 segundos enquanto estiver rodando
  useEffect(() => {
    let timer: NodeJS.Timeout;

    async function loadData() {
      try {
        const data = await api.getSearchJob(jobId);
        setJob(data.job);
        setAreas(data.areas);
        setQueries(data.queries);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
      } finally {
        setLoading(false);
      }
    }

    loadData();

    timer = setInterval(() => {
      if (job?.status === 'running' || job?.status === 'pending') {
        loadData();
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [jobId, job?.status]);

  const handlePause = async () => {
    setActionLoading(true);
    try {
      await api.pauseSearchJob(jobId);
      const data = await api.getSearchJob(jobId);
      setJob(data.job);
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    setActionLoading(true);
    try {
      await api.resumeSearchJob(jobId);
      const data = await api.getSearchJob(jobId);
      setJob(data.job);
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('Deseja realmente cancelar esta busca?')) return;
    setActionLoading(true);
    try {
      await api.cancelSearchJob(jobId);
      const data = await api.getSearchJob(jobId);
      setJob(data.job);
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !job) {
    return (
      <div className="flex items-center justify-center p-12 text-xs text-neutral-400">
        <RotateCw className="h-5 w-5 animate-spin mr-2" />
        Carregando status da busca...
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-8 text-center text-xs text-red-500">
        Tarefa de busca não encontrada.
      </div>
    );
  }

  const areasPercent = job.total_search_areas > 0
    ? Math.min(100, Math.round((job.processed_search_areas / job.total_search_areas) * 100))
    : 0;
  const leadsPercent = job.target_leads && job.target_leads > 0
    ? Math.min(100, Math.round((job.leads_created / job.target_leads) * 100))
    : 0;
  const percent = job.status === 'completed' ? 100 : Math.max(areasPercent, leadsPercent);

  const statusLabels: Record<string, { label: string; bg: string; text: string; icon: React.ElementType }> = {
    running: { label: 'Em execução', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', icon: RotateCw },
    completed: { label: 'Concluído', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', icon: CheckCircle2 },
    paused: { label: 'Pausado', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', icon: Pause },
    failed: { label: 'Falhou', bg: 'bg-red-50 border-red-200', text: 'text-red-700', icon: AlertCircle },
    cancelled: { label: 'Cancelado', bg: 'bg-neutral-100 border-neutral-200', text: 'text-neutral-600', icon: XCircle },
    pending: { label: 'Pendente', bg: 'bg-neutral-50 border-neutral-200', text: 'text-neutral-500', icon: Clock },
  };

  const currentSt = statusLabels[job.status] || statusLabels.pending;
  const StatusIcon = currentSt.icon;

  return (
    <div className="space-y-6">
      {/* Top Bar de Navegação e Ações */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 transition-colors w-fit"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Voltar para Buscar Leads</span>
        </button>

        {/* Controles de Execução */}
        <div className="flex items-center gap-2">
          {job.status === 'running' && (
            <button
              onClick={handlePause}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 transition-colors"
            >
              <Pause className="h-3.5 w-3.5" />
              <span>Pausar</span>
            </button>
          )}

          {job.status === 'paused' && (
            <button
              onClick={handleResume}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors"
            >
              <Play className="h-3.5 w-3.5 fill-emerald-800" />
              <span>Continuar</span>
            </button>
          )}

          {(job.status === 'running' || job.status === 'paused' || job.status === 'pending') && (
            <button
              onClick={handleCancel}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
            >
              <XCircle className="h-3.5 w-3.5" />
              <span>Cancelar</span>
            </button>
          )}

          <button
            onClick={() => onViewLeads(job.niche, job.state)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-neutral-900 rounded-md hover:bg-neutral-800 transition-colors shadow-xs"
          >
            <span>Ver Leads da Busca ({job.leads_created})</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Header do Job com Card de Progresso */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-2xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-neutral-100">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-neutral-900 tracking-tight">
                {job.niche} — {job.city === 'all' ? `Todas as cidades de ${job.state}` : `${job.city}, ${job.state}`}
              </h2>
              {job.target_leads && job.target_leads > 0 ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Meta: {job.target_leads} leads
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-neutral-100 text-neutral-700 border border-neutral-200">
                  Meta: Sem limite
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium border ${currentSt.bg} ${currentSt.text}`}
              >
                <StatusIcon className={`h-3 w-3 ${job.status === 'running' ? 'animate-spin' : ''}`} />
                {currentSt.label}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              Iniciado em {new Date(job.created_at).toLocaleString('pt-BR')} · ID: {job.id}
            </p>
          </div>
        </div>

        {job.error_message && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
              <div>{job.error_message}</div>
            </div>
            {job.status === 'paused' && (
              <button
                type="button"
                onClick={handleResume}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-amber-600 text-white font-semibold hover:bg-amber-700 transition-colors shadow-2xs cursor-pointer self-start sm:self-auto shrink-0"
              >
                <Play className="h-3.5 w-3.5 fill-white" />
                <span>Continuar Varredura</span>
              </button>
            )}
          </div>
        )}

        {/* Barra de Progresso com porcentagem */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-neutral-700 uppercase tracking-wider text-[11px]">
              Progresso Geral da Varredura
            </span>
            <span className="font-mono tabular-nums text-neutral-900 font-bold text-sm">
              {percent}%
            </span>
          </div>

          <div className="h-3 w-full bg-neutral-100 rounded-full overflow-hidden p-0.5 border border-neutral-200/60">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                job.status === 'completed'
                  ? 'bg-emerald-600'
                  : job.status === 'paused'
                  ? 'bg-amber-500'
                  : 'bg-neutral-900'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Grid de Métricas da Busca */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-2">
          <div className="rounded-lg border border-neutral-200/80 bg-neutral-50/50 p-3">
            <span className="text-[11px] font-medium text-neutral-500 block mb-1">
              Cidades
            </span>
            <div className="text-lg font-bold text-neutral-900 font-mono tabular-nums">
              {job.processed_cities} <span className="text-xs text-neutral-400 font-normal">/ {job.total_cities}</span>
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200/80 bg-neutral-50/50 p-3">
            <span className="text-[11px] font-medium text-neutral-500 block mb-1">
              Regiões / Células de Grid
            </span>
            <div className="text-lg font-bold text-neutral-900 font-mono tabular-nums">
              {job.processed_search_areas} <span className="text-xs text-neutral-400 font-normal">/ {job.total_search_areas}</span>
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200/80 bg-neutral-50/50 p-3">
            <span className="text-[11px] font-medium text-neutral-500 block mb-1">
              Locais Encontrados
            </span>
            <div className="text-lg font-bold text-neutral-900 font-mono tabular-nums">
              {job.places_found.toLocaleString('pt-BR')}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200/80 bg-amber-50/40 border-amber-200/60 p-3">
            <span className="text-[11px] font-medium text-amber-800 block mb-1">
              Sem Site Cadastrado
            </span>
            <div className="text-lg font-bold text-amber-900 font-mono tabular-nums">
              {job.places_without_website.toLocaleString('pt-BR')}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200/80 bg-emerald-50/40 border-emerald-200/60 p-3">
            <span className="text-[11px] font-medium text-emerald-800 block mb-1">
              Leads Qualificados Criados
            </span>
            <div className="text-lg font-bold text-emerald-900 font-mono tabular-nums">
              {job.leads_created.toLocaleString('pt-BR')}
              {job.target_leads && job.target_leads > 0 ? (
                <span className="text-xs text-neutral-400 font-normal"> / {job.target_leads} meta</span>
              ) : (
                <span className="text-xs text-neutral-400 font-normal"> (livre)</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Áreas Geográficas & Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lista de Áreas */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
            <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
              Áreas Geográficas Percorridas ({areas.length})
            </h3>
            <span className="text-[11px] text-neutral-400">Raio de varredura</span>
          </div>

          <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-neutral-100 pr-1">
            {areas.map((area) => {
              const areaStatus: Record<string, string> = {
                completed: 'text-emerald-700 bg-emerald-50',
                processing: 'text-blue-700 bg-blue-50 animate-pulse',
                pending: 'text-neutral-500 bg-neutral-100',
                failed: 'text-red-700 bg-red-50',
              };

              return (
                <div key={area.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-medium text-neutral-800 block">
                      {area.city}, {area.state}
                    </span>
                    <span className="text-[10px] text-neutral-400 font-mono">
                      Lat: {area.lat.toFixed(3)} | Lng: {area.lng.toFixed(3)} | Raio: {area.radius / 1000}km
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-500 font-mono tabular-nums text-[11px]">
                      {area.places_found} locais
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono capitalize ${
                        areaStatus[area.status] || 'text-neutral-500'
                      }`}
                    >
                      {area.status === 'completed' ? 'Ok' : area.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Logs Estruturados de Consultas */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
            <div className="flex items-center gap-1.5">
              <Terminal className="h-4 w-4 text-neutral-700" />
              <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
                Logs de Execução da API ({queries.length})
              </h3>
            </div>
            <span className="text-[11px] text-neutral-400 font-mono">Tempo real</span>
          </div>

          <div className="mt-3 max-h-72 overflow-y-auto space-y-2 pr-1 font-mono text-[11px]">
            {queries.length === 0 ? (
              <div className="text-center py-8 text-neutral-400">
                Aguardando primeiras requisições...
              </div>
            ) : (
              queries.map((q) => (
                <div
                  key={q.id}
                  className="rounded-md border border-neutral-150 bg-neutral-50/70 p-2 text-neutral-700 space-y-0.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-neutral-900 truncate max-w-[220px]">
                      {q.query}
                    </span>
                    <span className="text-neutral-400 text-[10px] tabular-nums">
                      {q.duration_ms}ms
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-neutral-500">
                    <span>Resultados: {q.results_count}</span>
                    <span
                      className={
                        q.status === 'success'
                          ? 'text-emerald-700 font-medium'
                          : 'text-amber-700 font-medium'
                      }
                    >
                      {q.status}
                    </span>
                  </div>
                  {q.error_details && (
                    <div className="text-amber-800 text-[10px] pt-1">
                      {q.error_details}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
