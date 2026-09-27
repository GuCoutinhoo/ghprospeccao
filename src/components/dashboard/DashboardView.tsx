import React from 'react';
import {
  Users,
  UserPlus,
  PhoneCall,
  Flame,
  CheckCircle2,
  Globe,
  Phone,
  ArrowUpRight,
  TrendingUp,
  Percent,
  Search,
  ExternalLink,
  MessageCircle,
  Compass,
  Heart,
} from 'lucide-react';
import { DashboardStats, Lead } from '../../types';
import { getScoreColorClass } from '../../lib/scoring/leadScore';
import { formatBrazilianPhone, getWhatsAppUrl } from '../../utils/whatsapp';

interface DashboardViewProps {
  stats: DashboardStats;
  onSelectLead: (lead: Lead) => void;
  onNavigateToSearch: () => void;
  onNavigateToLeads: () => void;
  onNavigateToFavorites?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  stats,
  onSelectLead,
  onNavigateToSearch,
  onNavigateToLeads,
  onNavigateToFavorites,
}) => {
  const kpiCards = [
    {
      label: 'Total de Leads',
      value: stats.totalLeads,
      icon: Users,
      desc: 'Base prospectável',
    },
    {
      label: 'Novos',
      value: stats.newLeads,
      icon: UserPlus,
      desc: 'Aguardando contato',
    },
    {
      label: 'Contatados',
      value: stats.contactedLeads,
      icon: PhoneCall,
      desc: 'Abordagem realizada',
    },
    {
      label: 'Interessados',
      value: stats.interestedLeads,
      icon: Flame,
      desc: 'Em negociação ativa',
    },
    {
      label: 'Fechados',
      value: stats.closedLeads,
      icon: CheckCircle2,
      desc: 'Contratos convertidos',
    },
    {
      label: 'Sem Site (Alvo)',
      value: stats.noWebsiteLeads,
      icon: Globe,
      desc: `${stats.totalLeads > 0 ? Math.round((stats.noWebsiteLeads / stats.totalLeads) * 100) : 0}% da base total`,
    },
    {
      label: 'Com Telefone',
      value: stats.withPhoneLeads,
      icon: Phone,
      desc: `${stats.totalLeads > 0 ? Math.round((stats.withPhoneLeads / stats.totalLeads) * 100) : 0}% com número direto`,
    },
    {
      label: 'Taxa de Resposta',
      value: `${stats.responseRate}%`,
      icon: Percent,
      desc: 'Respostas de contatos',
    },
    {
      label: 'Taxa de Fechamento',
      value: `${stats.closingRate}%`,
      icon: TrendingUp,
      desc: 'Conversão final em vendas',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Banner / Boas-vindas B2B */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 tracking-tight">
            Painel de Prospecção & Oportunidades Locais
          </h2>
          <p className="text-xs text-neutral-500 mt-1 max-w-2xl leading-relaxed">
            Identifique empresas ativas e bem avaliadas no Google que não possuem site próprio e aborde pelo WhatsApp comercial para ofertar presença digital.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onNavigateToFavorites && (
            <button
              onClick={onNavigateToFavorites}
              className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors shadow-2xs cursor-pointer"
            >
              <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500" />
              <span>Ver Favoritos</span>
            </button>
          )}

          <button
            onClick={onNavigateToSearch}
            className="flex items-center gap-2 rounded-lg bg-neutral-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-neutral-800 transition-colors shadow-xs"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Iniciar Nova Prospecção</span>
          </button>
        </div>
      </div>

      {/* Grid de 9 Métricas Executivas */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-9 gap-3">
        {kpiCards.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              className="flex flex-col justify-between rounded-lg border border-neutral-200/80 bg-white p-3.5 hover:border-neutral-300 transition-colors shadow-2xs"
            >
              <div className="flex items-center justify-between text-neutral-400 mb-2">
                <span className="text-[11px] font-medium text-neutral-600 truncate leading-tight">
                  {kpi.label}
                </span>
                <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
              </div>
              <div>
                <div className="text-xl font-bold tracking-tight text-neutral-900 font-mono tabular-nums">
                  {kpi.value}
                </div>
                <div className="text-[10px] text-neutral-400 mt-1 truncate">
                  {kpi.desc}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Gráficos e Distribuições */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Distribuição por Nicho */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
            <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
              Leads por Nicho
            </h3>
            <span className="text-[11px] text-neutral-400">Distribuição</span>
          </div>
          <div className="mt-4 space-y-3">
            {stats.leadsByNiche.length === 0 ? (
              <p className="text-xs text-neutral-400 text-center py-6">Nenhum nicho mapeado ainda.</p>
            ) : (
              stats.leadsByNiche.map((item, idx) => {
                const maxCount = stats.leadsByNiche[0]?.count || 1;
                const pct = Math.round((item.count / maxCount) * 100);
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-neutral-700 truncate">{item.niche}</span>
                      <span className="text-neutral-500 font-mono tabular-nums">{item.count} leads</span>
                    </div>
                    <div className="h-1.5 w-full bg-neutral-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-neutral-800 rounded-full transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Leads por Estado */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
            <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
              Leads por Estado (UF)
            </h3>
            <span className="text-[11px] text-neutral-400">Geografia</span>
          </div>
          <div className="mt-4 space-y-3">
            {stats.leadsByState.length === 0 ? (
              <p className="text-xs text-neutral-400 text-center py-6">Nenhum estado pesquisado ainda.</p>
            ) : (
              stats.leadsByState.map((item, idx) => {
                const maxCount = stats.leadsByState[0]?.count || 1;
                const pct = Math.round((item.count / maxCount) * 100);
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-neutral-700">{item.state}</span>
                      <span className="text-neutral-500 font-mono tabular-nums">{item.count} empresas</span>
                    </div>
                    <div className="h-1.5 w-full bg-neutral-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-neutral-700 rounded-full transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Pipeline Distribution */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
            <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
              Funil Comercial
            </h3>
            <span className="text-[11px] text-neutral-400">Status</span>
          </div>
          <div className="mt-4 space-y-2">
            {stats.pipelineDistribution.map((step, idx) => {
              const maxPipeline = Math.max(...stats.pipelineDistribution.map((p) => p.count), 1);
              const pct = Math.round((step.count / maxPipeline) * 100);
              return (
                <div key={idx} className="flex items-center justify-between text-xs py-1">
                  <span className="text-neutral-600 font-medium truncate">{step.status}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-neutral-800 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right font-mono tabular-nums text-neutral-500 text-[11px]">
                      {step.count}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Melhores Oportunidades Recentes */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs">
        <div className="flex items-center justify-between pb-4 border-b border-neutral-100">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 tracking-tight">
              Melhores Oportunidades Recentes
            </h3>
            <p className="text-xs text-neutral-400 mt-0.5">
              Empresas sem site, com telefone validado e alta avaliação no Google Places.
            </p>
          </div>
          <button
            onClick={onNavigateToLeads}
            className="flex items-center gap-1 text-xs font-medium text-neutral-700 hover:text-neutral-900 transition-colors"
          >
            <span>Ver todos os leads</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-4 divide-y divide-neutral-100">
          {stats.topOpportunities.length === 0 ? (
            <div className="text-center py-8 text-xs text-neutral-400">
              Nenhuma oportunidade com score alto ainda. Faça sua primeira busca para popular!
            </div>
          ) : (
            stats.topOpportunities.map((lead) => {
              const { badgeBg } = getScoreColorClass(lead.lead_score);
              const waUrl = getWhatsAppUrl(lead.phone, lead.name);

              return (
                <div
                  key={lead.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 hover:bg-neutral-50/50 rounded-lg px-2 -mx-2 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-neutral-900 text-sm">{lead.name}</span>
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${badgeBg}`}
                      >
                        Score {lead.lead_score}
                      </span>
                    </div>

                    {/* Metadata sem pílulas - unboxed text com separadores */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <span>{lead.city} - {lead.state}</span>
                      <span aria-hidden="true" className="text-neutral-300">·</span>
                      <span>{lead.niche}</span>
                      <span aria-hidden="true" className="text-neutral-300">·</span>
                      <span className="font-mono tabular-nums text-neutral-700 font-medium">
                        ★ {lead.rating.toFixed(1)} ({lead.reviews_count} avaliações)
                      </span>
                      <span aria-hidden="true" className="text-neutral-300">·</span>
                      <span className="text-amber-700 font-medium">Sem site</span>
                      <span aria-hidden="true" className="text-neutral-300">·</span>
                      <span className="font-mono">{formatBrazilianPhone(lead.phone)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={lead.maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lead.name} ${lead.city}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-md hover:bg-neutral-50 transition-colors shadow-2xs"
                      title="Ver loja no Google Maps"
                    >
                      <Compass className="h-3.5 w-3.5 text-red-500" />
                      <span className="hidden sm:inline">Maps</span>
                    </a>

                    {waUrl && (
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors"
                        title="Abrir conversa no WhatsApp"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">WhatsApp</span>
                      </a>
                    )}

                    <button
                      onClick={() => onSelectLead(lead)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-900 bg-neutral-100 rounded-md hover:bg-neutral-200 transition-colors"
                    >
                      <span>Ver Loja</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
