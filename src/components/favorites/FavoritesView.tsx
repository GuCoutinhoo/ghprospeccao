import React, { useState, useEffect } from 'react';
import {
  Heart,
  Store,
  Scissors,
  Stethoscope,
  Zap,
  Wrench,
  Utensils,
  Home,
  Tags,
  LayoutGrid,
  List,
  Search,
  ExternalLink,
  Phone,
  MessageCircle,
  MapPin,
  Star,
  Globe,
  SlidersHorizontal,
  RotateCw,
  Check,
  Copy,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { Lead } from '../../types';
import { api } from '../../lib/api';

interface FavoritesViewProps {
  onSelectLead: (lead: Lead) => void;
  onNavigateToLeads: () => void;
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

function formatBrazilianPhone(phone?: string) {
  if (!phone) return 'Não informado';
  const clean = phone.replace(/\D/g, '');
  if (clean.length === 11) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
  }
  if (clean.length === 10) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  }
  return phone;
}

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  onSelectLead,
  onNavigateToLeads,
}) => {
  const [favorites, setFavorites] = useState<Lead[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);

  // Lista dinâmica de nichos nos favoritos
  const [niches, setNiches] = useState<{ niche: string; count: number }[]>([]);
  const [selectedNiche, setSelectedNiche] = useState<string>('ALL');

  // Modo de visualização
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  // Busca e ordenação
  const [search, setSearch] = useState<string>('');
  const [sortBy, setSortBy] = useState<'score' | 'reviews' | 'rating' | 'recent'>('score');
  const [onlyWithoutWebsite, setOnlyWithoutWebsite] = useState<boolean>(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadFavorites();
    loadNiches();
  }, [page, selectedNiche, sortBy, onlyWithoutWebsite]);

  const loadNiches = async () => {
    try {
      const data = await api.getNiches({ onlyFavorites: true });
      setNiches(data);
    } catch (err) {
      console.error('Erro ao carregar nichos de favoritos:', err);
    }
  };

  const loadFavorites = async () => {
    setLoading(true);
    try {
      const data = await api.getLeads({
        onlyFavorites: true,
        niche: selectedNiche !== 'ALL' ? selectedNiche : undefined,
        onlyWithoutWebsite: onlyWithoutWebsite ? true : undefined,
        search,
        sortBy,
        page,
        limit: 50,
      });

      setFavorites(data.leads);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error('Erro ao carregar favoritos:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadFavorites();
  };

  const handleToggleFavorite = async (e: React.MouseEvent, leadId: string) => {
    e.stopPropagation();
    // Atualização otimista
    setFavorites((prev) => prev.filter((l) => l.id !== leadId));
    setTotal((prev) => Math.max(0, prev - 1));

    try {
      await api.toggleLeadFavorite(leadId);
      loadNiches();
    } catch (err) {
      console.error('Erro ao desfavoritar:', err);
      loadFavorites();
    }
  };

  const copyPhone = (id: string, phone?: string) => {
    if (!phone) return;
    navigator.clipboard.writeText(phone);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const exportFavoritesCsv = () => {
    if (favorites.length === 0) return;
    const headers = ['Nome', 'Cidade', 'Estado', 'Nicho', 'Nota', 'Avaliações', 'Telefone', 'Site', 'Score', 'Maps'];
    const rows = favorites.map((l) => [
      `"${l.name.replace(/"/g, '""')}"`,
      `"${l.city}"`,
      `"${l.state}"`,
      `"${l.niche}"`,
      l.rating.toFixed(1),
      l.reviews_count,
      `"${formatBrazilianPhone(l.phone)}"`,
      `"${l.website || 'Sem site'}"`,
      l.lead_score,
      `"${l.maps_url || ''}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(';'), ...rows.map((e) => e.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `leads_favoritos_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalFavoritedAcrossNiches = niches.reduce((acc, curr) => acc + curr.count, 0);

  return (
    <div className="space-y-5">
      {/* Cabeçalho da Seção de Favoritos */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 shrink-0">
              <Heart className="h-6 w-6 fill-rose-500 text-rose-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-neutral-900 tracking-tight">
                  Leads & Estabelecimentos Favoritos
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-rose-100 text-rose-800">
                  {totalFavoritedAcrossNiches || total} salvos
                </span>
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                Lojas marcadas para prospecção prioritária, organizadas e separadas por cada nicho de atuação.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportFavoritesCsv}
              disabled={favorites.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Exportar CSV
            </button>
            <button
              type="button"
              onClick={onNavigateToLeads}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer"
            >
              <span>Ver Toda a Base</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 1. Barra de Abas de Categorias / Nichos dos Favoritos */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
          <div className="flex items-center gap-2">
            <Tags className="h-4 w-4 text-neutral-800" />
            <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
              Categorias dos Favoritos
            </h3>
          </div>
          <span className="text-[11px] text-neutral-400">
            Selecione o nicho para ver apenas as lojas favoritas desse segmento
          </span>
        </div>

        {/* Abas com scroll horizontal suave */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
          {/* Aba: Todos os Favoritos */}
          <button
            type="button"
            onClick={() => {
              setSelectedNiche('ALL');
              setPage(1);
            }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
              selectedNiche === 'ALL'
                ? 'bg-neutral-900 text-white shadow-xs'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200/80 hover:text-neutral-900'
            }`}
          >
            <Store className="h-3.5 w-3.5" />
            <span>Todos os Nichos</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                selectedNiche === 'ALL' ? 'bg-white/20 text-white' : 'bg-neutral-200 text-neutral-700'
              }`}
            >
              {totalFavoritedAcrossNiches || total}
            </span>
          </button>

          {/* Abas dinâmicas para cada nicho que possui favoritos */}
          {niches.map((item) => {
            const Icon = getNicheIcon(item.niche);
            const isSelected = selectedNiche.toLowerCase() === item.niche.toLowerCase();
            return (
              <button
                key={item.niche}
                type="button"
                onClick={() => {
                  setSelectedNiche(item.niche);
                  setPage(1);
                }}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'bg-rose-50/70 text-rose-800 border border-rose-200 hover:bg-rose-100'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-white' : 'text-rose-600'}`} />
                <span>{item.niche}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-rose-200/80 text-rose-900'
                  }`}
                >
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Indicador de Filtro de Nicho Ativo */}
        {selectedNiche !== 'ALL' && (
          <div className="flex items-center justify-between pt-2 border-t border-neutral-100 text-xs text-neutral-600">
            <span>
              Exibindo favoritos da categoria: <strong className="text-neutral-900">{selectedNiche}</strong> ({total} lojas)
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedNiche('ALL');
                setPage(1);
              }}
              className="text-[11px] font-medium text-neutral-500 hover:text-neutral-900 underline cursor-pointer"
            >
              Mostrar todas as categorias
            </button>
          </div>
        )}
      </div>

      {/* 2. Barra de Busca e Alternador de Visão */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Busca por texto */}
          <form onSubmit={handleSearchSubmit} className="relative flex-1 w-full">
            <input
              type="text"
              placeholder="Buscar favorito por nome, cidade ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 pl-9 pr-4 py-2 text-xs text-neutral-800 placeholder-neutral-400 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
            />
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
          </form>

          {/* Alternador de Visualização */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-lg border border-neutral-200/80">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-white text-neutral-900 shadow-2xs font-semibold'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
                title="Vitrine de Cards"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>Vitrine</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-white text-neutral-900 shadow-2xs font-semibold'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
                title="Tabela Compacta"
              >
                <List className="h-3.5 w-3.5" />
                <span>Tabela</span>
              </button>
            </div>
          </div>
        </div>

        {/* Filtros secundários */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-100 text-xs">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer text-neutral-700">
              <input
                type="checkbox"
                checked={onlyWithoutWebsite}
                onChange={(e) => {
                  setOnlyWithoutWebsite(e.target.checked);
                  setPage(1);
                }}
                className="rounded-sm border-neutral-300 text-neutral-900 focus:ring-neutral-900"
              />
              <span className="font-medium text-[11px]">Apenas sem website (Oportunidades)</span>
            </label>
          </div>

          <div className="flex items-center gap-2 text-neutral-500">
            <span>Ordenar:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-800 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
            >
              <option value="score">Maior Lead Score</option>
              <option value="reviews">Mais Avaliações</option>
              <option value="rating">Melhor Nota</option>
              <option value="recent">Mais Recentes</option>
            </select>
          </div>
        </div>
      </div>

      {/* Conteúdo: Vitrine de Lojas ou Tabela */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-16 rounded-xl border border-neutral-200 bg-white">
          <RotateCw className="h-6 w-6 animate-spin text-neutral-400 mb-2" />
          <span className="text-xs text-neutral-500 font-medium">Carregando seus estabelecimentos favoritos...</span>
        </div>
      ) : favorites.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 rounded-xl border border-neutral-200 bg-white text-center space-y-3">
          <div className="p-3 rounded-full bg-rose-50 text-rose-500">
            <Heart className="h-8 w-8 fill-rose-200 text-rose-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              {selectedNiche !== 'ALL'
                ? `Nenhum favorito encontrado na categoria "${selectedNiche}"`
                : 'Nenhum estabelecimento favoritado ainda'}
            </h3>
            <p className="text-xs text-neutral-500 max-w-sm mt-1">
              {selectedNiche !== 'ALL'
                ? 'Você ainda não salvou estabelecimentos deste nicho. Explore a base e clique no ícone de coração.'
                : 'Na Base de Leads ou no Dashboard, clique no ícone de coração (❤️) em qualquer loja para adicioná-la aos seus favoritos organizados por categoria.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateToLeads}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer"
          >
            <span>Explorar Base de Leads</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : viewMode === 'cards' ? (
        /* Modo Vitrine de Cards */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {favorites.map((lead) => {
            const NicheIcon = getNicheIcon(lead.niche);
            const cleanPhone = lead.phone ? lead.phone.replace(/\D/g, '') : null;
            const waNumber = cleanPhone ? (cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`) : null;
            const waUrl = waNumber ? `https://wa.me/${waNumber}` : null;
            const mapsUrl = lead.maps_url || (lead.place_id ? `https://www.google.com/maps/place/?q=place_id:${lead.place_id}` : null);

            let badgeBg = 'bg-neutral-100 text-neutral-800 border-neutral-200';
            if (lead.lead_score >= 80) badgeBg = 'bg-emerald-50 text-emerald-800 border-emerald-200';
            else if (lead.lead_score >= 60) badgeBg = 'bg-blue-50 text-blue-800 border-blue-200';
            else if (lead.lead_score >= 40) badgeBg = 'bg-amber-50 text-amber-800 border-amber-200';

            return (
              <div
                key={lead.id}
                onClick={() => onSelectLead(lead)}
                className="group relative flex flex-col justify-between rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs hover:shadow-md hover:border-neutral-300 transition-all cursor-pointer"
              >
                <div>
                  {/* Cabeçalho do Card: Nicho, Botão Favorito e Score */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-1.5">
                      <div className="p-1.5 rounded-lg bg-neutral-100 text-neutral-700 group-hover:bg-neutral-900 group-hover:text-white transition-colors">
                        <NicheIcon className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-[11px] font-semibold text-neutral-600 truncate max-w-[130px]">
                        {lead.niche}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => handleToggleFavorite(e, lead.id)}
                        className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer"
                        title="Remover dos favoritos"
                      >
                        <Heart className="h-4 w-4 fill-rose-500 text-rose-500" />
                      </button>

                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-bold border ${badgeBg}`}
                      >
                        Score {lead.lead_score}
                      </span>
                    </div>
                  </div>

                  {/* Nome do Estabelecimento */}
                  <h3 className="text-sm font-bold text-neutral-900 group-hover:text-neutral-700 transition-colors leading-snug line-clamp-2">
                    {lead.name}
                  </h3>

                  {/* Avaliações do Google */}
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex items-center gap-1 text-xs font-bold text-neutral-900">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      <span>{lead.rating.toFixed(1)}</span>
                    </div>
                    <span className="text-neutral-300">·</span>
                    <span className="text-xs text-neutral-500">
                      {lead.reviews_count} {lead.reviews_count === 1 ? 'avaliação' : 'avaliações no Google'}
                    </span>
                  </div>

                  {/* Endereço / Localização */}
                  <div className="flex items-start gap-1.5 mt-3 text-xs text-neutral-500">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-neutral-400 mt-0.5" />
                    <span className="line-clamp-2 leading-relaxed">
                      {lead.address || `${lead.city} - ${lead.state}`}
                    </span>
                  </div>

                  {/* Status do Website */}
                  <div className="mt-3.5 pt-3 border-t border-neutral-100 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5 text-neutral-400" />
                      {lead.website ? (
                        <a
                          href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-medium text-neutral-700 hover:text-neutral-900 hover:underline truncate max-w-[140px]"
                        >
                          {lead.website.replace(/^https?:\/\/(www\.)?/, '')}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                          Sem site (Oportunidade)
                        </span>
                      )}
                    </div>

                    <span className="text-[11px] font-mono text-neutral-400">
                      {lead.city}/{lead.state}
                    </span>
                  </div>
                </div>

                {/* Rodapé de Ações do Card */}
                <div
                  className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Telefone com cópia rápida */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => copyPhone(lead.id, lead.phone)}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-md transition-colors cursor-pointer"
                      title="Copiar telefone"
                    >
                      <Phone className="h-3 w-3 text-neutral-500" />
                      <span>{formatBrazilianPhone(lead.phone)}</span>
                      {copiedId === lead.id ? (
                        <Check className="h-3 w-3 text-emerald-600 ml-0.5" />
                      ) : (
                        <Copy className="h-3 w-3 text-neutral-400 ml-0.5" />
                      )}
                    </button>
                  </div>

                  {/* Botões WhatsApp e Maps */}
                  <div className="flex items-center gap-1.5">
                    {mapsUrl && (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-md transition-colors cursor-pointer"
                        title="Ver no Google Maps"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}

                    {waUrl && (
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors shadow-2xs cursor-pointer"
                        title="Iniciar conversa no WhatsApp"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        <span>WhatsApp</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Modo Tabela de Dados */
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-neutral-700">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Estabelecimento</th>
                  <th className="px-4 py-3">Nicho</th>
                  <th className="px-4 py-3">Localização</th>
                  <th className="px-4 py-3">Avaliações</th>
                  <th className="px-4 py-3">Website</th>
                  <th className="px-4 py-3">Lead Score</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {favorites.map((lead) => {
                  const NicheIcon = getNicheIcon(lead.niche);
                  const cleanPhone = lead.phone ? lead.phone.replace(/\D/g, '') : null;
                  const waNumber = cleanPhone ? (cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`) : null;
                  const waUrl = waNumber ? `https://wa.me/${waNumber}` : null;
                  const mapsUrl = lead.maps_url || (lead.place_id ? `https://www.google.com/maps/place/?q=place_id:${lead.place_id}` : null);

                  return (
                    <tr
                      key={lead.id}
                      onClick={() => onSelectLead(lead)}
                      className="hover:bg-neutral-50/80 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => handleToggleFavorite(e, lead.id)}
                            className="p-1 rounded-md text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Remover dos favoritos"
                          >
                            <Heart className="h-4 w-4 fill-rose-500 text-rose-500" />
                          </button>
                          <div>
                            <div className="font-semibold text-neutral-900 line-clamp-1">{lead.name}</div>
                            <div className="text-[11px] text-neutral-400 font-mono mt-0.5">{formatBrazilianPhone(lead.phone)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5 font-medium text-neutral-700">
                          <NicheIcon className="h-3.5 w-3.5 text-neutral-400" />
                          <span>{lead.niche}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-neutral-800">{lead.city} - {lead.state}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1 font-semibold text-neutral-900">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          <span>{lead.rating.toFixed(1)}</span>
                          <span className="text-neutral-400 font-normal">({lead.reviews_count})</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {lead.website ? (
                          <span className="text-neutral-600 truncate block max-w-[120px]">
                            {lead.website.replace(/^https?:\/\/(www\.)?/, '')}
                          </span>
                        ) : (
                          <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                            Sem site
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-mono font-bold bg-neutral-100 text-neutral-800">
                          Score {lead.lead_score}
                        </span>
                      </td>
                      <td
                        className="px-4 py-3.5 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          {mapsUrl && (
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 rounded-md transition-colors"
                              title="Ver no Google Maps"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {waUrl && (
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors shadow-2xs"
                              title="WhatsApp"
                            >
                              <MessageCircle className="h-3 w-3" />
                              <span>Conversar</span>
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-3 text-xs text-neutral-500 shadow-2xs">
          <span>
            Página <strong className="text-neutral-900">{page}</strong> de <strong className="text-neutral-900">{totalPages}</strong>
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-md border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 rounded-md border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
