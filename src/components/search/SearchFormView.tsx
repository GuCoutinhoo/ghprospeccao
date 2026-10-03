import React, { useState, useEffect } from 'react';
import {
  Search,
  MapPin,
  Building,
  Briefcase,
  Filter,
  AlertCircle,
  Play,
  RotateCw,
  Clock,
  CheckCircle,
  Pause,
  XCircle,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { IBGEState, IBGECity, SearchJob } from '../../types';
import { BRAZILIAN_STATES, POPULAR_CITIES_BY_STATE } from '../../lib/ibge/ibgeService';
import { api } from '../../lib/api';

interface SearchFormViewProps {
  onJobStarted: (jobId: string) => void;
  onSelectExistingJob: (jobId: string) => void;
}

const NICHE_PRESETS = [
  'Barbearia',
  'Clínica odontológica',
  'Eletricista',
  'Energia solar',
  'Academia',
  'Estética',
  'Advogado',
  'Restaurante',
  'Oficina mecânica',
  'Imobiliária',
  'Pet shop',
  'Contabilidade',
  'Marcenaria',
  'Fotógrafo',
];

export const SearchFormView: React.FC<SearchFormViewProps> = ({
  onJobStarted,
  onSelectExistingJob,
}) => {
  const [states, setStates] = useState<IBGEState[]>(BRAZILIAN_STATES);
  const [selectedState, setSelectedState] = useState<string>('SP');
  const [cities, setCities] = useState<IBGECity[]>(() =>
    (POPULAR_CITIES_BY_STATE['SP'] || []).map((nome, id) => ({ id: 1000 + id, nome }))
  );
  const [selectedCity, setSelectedCity] = useState<string>('all'); // 'all' ou nome
  const [loadingCities, setLoadingCities] = useState(false);

  const [niche, setNiche] = useState<string>('Barbearia');
  const [customNiche, setCustomNiche] = useState<string>('');

  // Filtros comerciais (livres e sem limites artificiais)
  const [onlyWithoutWebsite, setOnlyWithoutWebsite] = useState<boolean>(false);
  const [onlyWithPhone, setOnlyWithPhone] = useState<boolean>(false);
  const [minRating, setMinRating] = useState<number>(0);
  const [minReviews, setMinReviews] = useState<number>(0);
  const [maxReviews, setMaxReviews] = useState<string>('');

  // Histórico de jobs
  const [recentJobs, setRecentJobs] = useState<SearchJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Carregar estados ao montar
  useEffect(() => {
    async function loadStates() {
      try {
        const data = await api.getStates();
        setStates(data);
      } catch (err) {
        console.error('Erro ao carregar estados do IBGE:', err);
      }
    }
    loadStates();
    loadJobs();
  }, []);

  // Carregar cidades quando o estado mudar
  useEffect(() => {
    if (!selectedState) return;

    let isMounted = true;
    async function loadCities() {
      setLoadingCities(true);
      try {
        const data = await api.getCities(selectedState);
        if (isMounted) {
          setCities(data);
          setSelectedCity('all');
        }
      } catch (err) {
        console.error('Erro ao carregar cidades do IBGE:', err);
      } finally {
        if (isMounted) setLoadingCities(false);
      }
    }
    loadCities();
    return () => {
      isMounted = false;
    };
  }, [selectedState]);

  async function loadJobs() {
    setLoadingJobs(true);
    try {
      const list = await api.getSearchJobs();
      setRecentJobs(list);
    } catch (err) {
      console.error('Erro ao carregar buscas:', err);
    } finally {
      setLoadingJobs(false);
    }
  }

  const activeNiche = customNiche.trim() ? customNiche.trim() : niche;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!activeNiche) {
      setErrorMessage('Por favor informe ou selecione o nicho de mercado.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.createSearchJob({
        state: selectedState,
        city: selectedCity,
        niche: activeNiche,
        filters: {
          onlyWithoutWebsite,
          onlyWithPhone,
          minRating,
          minReviews,
          maxReviews: maxReviews ? Number(maxReviews) : undefined,
        },
      });

      onJobStarted(res.job.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Formulário Principal */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-2xs">
        <div className="pb-5 border-b border-neutral-100 mb-6">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-neutral-800" />
            <h2 className="text-base font-semibold text-neutral-900 tracking-tight">
              Configurar Nova Busca de Leads
            </h2>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Selecione a região brasileira e o nicho comercial. O motor percorrerá as cidades, aplicará deduplicação e calculará o Lead Score.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
            <div>
              <span className="font-semibold">Aviso:</span> {errorMessage}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Seção 1: Região Geográfica (IBGE) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Estado */}
            <div>
              <label className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-2">
                Estado (IBGE)
              </label>
              <div className="relative">
                <select
                  value={selectedState}
                  onChange={(e) => setSelectedState(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-xs font-medium text-neutral-800 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
                >
                  {(states && states.length > 0 ? states : BRAZILIAN_STATES).map((st) => (
                    <option key={st.id || st.sigla} value={st.sigla}>
                      {st.nome} ({st.sigla})
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-neutral-400">
                  <MapPin className="h-4 w-4" />
                </div>
              </div>
              <p className="text-[11px] text-neutral-400 mt-1.5">
                Base oficial do IBGE com todos os 27 estados.
              </p>
            </div>

            {/* Cidade */}
            <div>
              <label className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-2">
                Município
              </label>
              <div className="relative">
                <select
                  value={selectedCity}
                  onChange={(e) => setSelectedCity(e.target.value)}
                  disabled={loadingCities}
                  className="w-full appearance-none rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-xs font-medium text-neutral-800 shadow-2xs focus:border-neutral-900 focus:outline-hidden disabled:bg-neutral-50"
                >
                  <option value="all">Todas as principais cidades do estado</option>
                  {cities.map((city) => (
                    <option key={city.id} value={city.nome}>
                      {city.nome}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-neutral-400">
                  {loadingCities ? (
                    <RotateCw className="h-4 w-4 animate-spin text-neutral-400" />
                  ) : (
                    <Building className="h-4 w-4" />
                  )}
                </div>
              </div>
              <p className="text-[11px] text-neutral-400 mt-1.5">
                {selectedCity === 'all'
                  ? 'A busca percorrerá os principais municípios em lotes ordenados.'
                  : `Busca focada no município de ${selectedCity}.`}
              </p>
            </div>
          </div>

          {/* Seção 2: Nicho / Segmento */}
          <div>
            <label className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-2">
              Nicho de Empresa
            </label>
            <div className="space-y-3">
              {/* Presets em segmented buttons */}
              <div className="flex flex-wrap gap-1.5">
                {NICHE_PRESETS.map((preset) => {
                  const isSelected = !customNiche && niche === preset;
                  return (
                    <button
                      type="button"
                      key={preset}
                      onClick={() => {
                        setNiche(preset);
                        setCustomNiche('');
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        isSelected
                          ? 'bg-neutral-900 text-white shadow-2xs'
                          : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200/80'
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>

              {/* Input manual */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Ou digite qualquer nicho manualmente (ex: Marmoraria, Fisioterapia, etc.)..."
                  value={customNiche}
                  onChange={(e) => setCustomNiche(e.target.value)}
                  className="flex-1 rounded-lg border border-neutral-200 px-3.5 py-2 text-xs text-neutral-800 placeholder-neutral-400 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
                />
                {customNiche && (
                  <button
                    type="button"
                    onClick={() => setCustomNiche('')}
                    className="text-xs text-neutral-400 hover:text-neutral-700 px-2 py-1"
                  >
                    Limpar
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Seção 3: Filtros Comerciais */}
          <div className="rounded-lg border border-neutral-200/80 bg-neutral-50/50 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-neutral-600" />
              <span className="text-xs font-semibold text-neutral-800 uppercase tracking-wider">
                Filtros Comerciais de Qualificação
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
              {/* Sem site */}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyWithoutWebsite}
                  onChange={(e) => setOnlyWithoutWebsite(e.target.checked)}
                  className="mt-0.5 rounded-sm border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                />
                <div>
                  <span className="text-xs font-semibold text-neutral-800 block">
                    Apenas sem site
                  </span>
                  <span className="text-[11px] text-neutral-500 leading-tight">
                    Filtra empresas que não cadastraram websiteUri no Google Places.
                  </span>
                </div>
              </label>

              {/* Com telefone */}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyWithPhone}
                  onChange={(e) => setOnlyWithPhone(e.target.checked)}
                  className="mt-0.5 rounded-sm border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                />
                <div>
                  <span className="text-xs font-semibold text-neutral-800 block">
                    Apenas com telefone
                  </span>
                  <span className="text-[11px] text-neutral-500 leading-tight">
                    Garante número disponível para contato imediato no WhatsApp.
                  </span>
                </div>
              </label>

              {/* Nota mínima */}
              <div>
                <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                  Nota mínima (estrelas)
                </label>
                <select
                  value={minRating}
                  onChange={(e) => setMinRating(Number(e.target.value))}
                  className="w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-800 font-mono shadow-2xs focus:border-neutral-900 focus:outline-hidden"
                >
                  <option value={0}>Qualquer nota</option>
                  <option value={3.5}>3.5 ou mais</option>
                  <option value={4.0}>4.0 ou mais (Recomendado)</option>
                  <option value={4.5}>4.5 ou mais (Alto padrão)</option>
                </select>
              </div>

              {/* Avaliações mínimas */}
              <div>
                <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                  Mínimo de avaliações
                </label>
                <select
                  value={minReviews}
                  onChange={(e) => setMinReviews(Number(e.target.value))}
                  className="w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-800 font-mono shadow-2xs focus:border-neutral-900 focus:outline-hidden"
                >
                  <option value={0}>Qualquer quantidade</option>
                  <option value={10}>Pelo menos 10 avaliações</option>
                  <option value={20}>Pelo menos 20 avaliações (Ativo)</option>
                  <option value={50}>Pelo menos 50 avaliações (Autoridade)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Botão de Submissão */}
          <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
            <div className="text-xs text-neutral-500">
              Alvo: <span className="font-semibold text-neutral-900">{activeNiche}</span> em{' '}
              <span className="font-semibold text-neutral-900">
                {selectedCity === 'all' ? `Todas as cidades de ${selectedState}` : `${selectedCity} - ${selectedState}`}
              </span>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-lg bg-neutral-900 px-5 py-2.5 text-xs font-semibold text-white hover:bg-neutral-800 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <RotateCw className="h-4 w-4 animate-spin text-white" />
                  <span>INICIANDO BUSCA...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-white" />
                  <span>INICIAR BUSCA DE LEADS</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Histórico de Buscas / Search Jobs */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-2xs">
        <div className="flex items-center justify-between pb-4 border-b border-neutral-100">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 tracking-tight">
              Histórico de Tarefas de Busca (Search Jobs)
            </h3>
            <p className="text-xs text-neutral-400 mt-0.5">
              Tarefas anteriores processadas ou em execução em segundo plano.
            </p>
          </div>
          <button
            onClick={loadJobs}
            disabled={loadingJobs}
            className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            <RotateCw className={`h-3.5 w-3.5 ${loadingJobs ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>

        <div className="mt-4 divide-y divide-neutral-100">
          {recentJobs.length === 0 ? (
            <div className="text-center py-8 text-xs text-neutral-400">
              Nenhuma tarefa de busca executada ainda.
            </div>
          ) : (
            recentJobs.map((job) => {
              const statusLabels: Record<string, { label: string; bg: string; text: string }> = {
                completed: { label: 'Concluído', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
                running: { label: 'Em execução', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
                paused: { label: 'Pausado', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
                failed: { label: 'Falhou', bg: 'bg-red-50 border-red-200', text: 'text-red-700' },
                cancelled: { label: 'Cancelado', bg: 'bg-neutral-100 border-neutral-200', text: 'text-neutral-600' },
                pending: { label: 'Pendente', bg: 'bg-neutral-50 border-neutral-200', text: 'text-neutral-500' },
              };

              const st = statusLabels[job.status] || statusLabels.pending;

              return (
                <div
                  key={job.id}
                  onClick={() => onSelectExistingJob(job.id)}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 hover:bg-neutral-50/70 rounded-lg px-2 -mx-2 transition-colors cursor-pointer"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-neutral-900 text-sm">
                        {job.niche} — {job.city === 'all' ? `Todas as cidades de ${job.state}` : `${job.city}, ${job.state}`}
                      </span>
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${st.bg} ${st.text}`}
                      >
                        {st.label}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <span>Cidades: {job.processed_cities} / {job.total_cities}</span>
                      <span aria-hidden="true" className="text-neutral-300">·</span>
                      <span>Regiões: {job.processed_search_areas} / {job.total_search_areas}</span>
                      <span aria-hidden="true" className="text-neutral-300">·</span>
                      <span className="font-mono tabular-nums text-neutral-700">
                        {job.places_found} locais encontrados
                      </span>
                      <span aria-hidden="true" className="text-neutral-300">·</span>
                      <span className="text-amber-700 font-medium">
                        {job.places_without_website} sem site
                      </span>
                      <span aria-hidden="true" className="text-neutral-300">·</span>
                      <span className="text-emerald-700 font-medium">
                        {job.leads_created} leads criados
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-neutral-400">
                    <span className="font-mono text-[11px]">
                      {new Date(job.created_at).toLocaleDateString('pt-BR')} {new Date(job.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <ChevronRight className="h-4 w-4 text-neutral-400" />
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
