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
  Target,
  Minus,
  Plus,
  Infinity as InfinityIcon,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { IBGEState, IBGECity, SearchJob, UserRole, Freelancer } from '../../types';
import { BRAZILIAN_STATES, POPULAR_CITIES_BY_STATE } from '../../lib/ibge/ibgeService';
import { api, getActiveFreelancerSession } from '../../lib/api';

interface SearchFormViewProps {
  onJobStarted: (jobId: string) => void;
  onSelectExistingJob: (jobId: string) => void;
  userRole?: UserRole;
  activeFreelancer?: Freelancer | null;
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
  userRole = 'admin',
  activeFreelancer,
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

  // Quantidade de leads desejada (Range de 10 a 210, pulando de 10 em 10; 210 = Sem Limite, ao lado de 200)
  const [sliderValue, setSliderValue] = useState<number>(50);

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
  const isUnlimited = sliderValue >= 210;
  const activeTargetLeads = isUnlimited ? 0 : sliderValue;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!activeNiche) {
      setErrorMessage('Por favor informe ou selecione o nicho de mercado.');
      return;
    }

    setIsSubmitting(true);
    try {
      const session = getActiveFreelancerSession();
      const effectiveFreelancerId = userRole === 'freelancer'
        ? (activeFreelancer?.id || (activeFreelancer?.access_code ? `free_${activeFreelancer.access_code}` : session?.freelancer?.id))
        : session?.freelancer?.id;
      const effectiveFreelancerName = userRole === 'freelancer'
        ? (activeFreelancer?.name || session?.freelancer?.name)
        : session?.freelancer?.name;

      const res = await api.createSearchJob({
        state: selectedState,
        city: selectedCity,
        niche: activeNiche,
        freelancerId: effectiveFreelancerId,
        freelancerName: effectiveFreelancerName,
        filters: {
          onlyWithoutWebsite,
          onlyWithPhone,
          minRating,
          minReviews,
          maxReviews: maxReviews ? Number(maxReviews) : undefined,
          targetLeads: activeTargetLeads,
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
      {/* Formulário Principal com Passo a Passo Guiado */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 sm:p-7 shadow-2xs space-y-6">
        {/* Cabeçalho com Indicador de Passos */}
        <div className="pb-5 border-b border-neutral-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-neutral-900 text-white flex items-center justify-center">
                <Search className="h-4 w-4" />
              </div>
              <h2 className="text-base font-bold text-neutral-900 tracking-tight">
                Nova Busca de Leads
              </h2>
            </div>
            <p className="text-xs text-neutral-500 mt-1">
              Configure em 3 etapas simples onde, o que e quantos leads você deseja minerar.
            </p>
          </div>

          {/* Guia Visual dos 3 Passos */}
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-100 font-medium text-neutral-700">
              <span className="w-4 h-4 rounded-full bg-neutral-900 text-white text-[10px] flex items-center justify-center font-bold">1</span>
              Local
            </span>
            <span className="text-neutral-300">→</span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-100 font-medium text-neutral-700">
              <span className="w-4 h-4 rounded-full bg-neutral-900 text-white text-[10px] flex items-center justify-center font-bold">2</span>
              Nicho
            </span>
            <span className="text-neutral-300">→</span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-100 font-medium text-neutral-700">
              <span className="w-4 h-4 rounded-full bg-neutral-900 text-white text-[10px] flex items-center justify-center font-bold">3</span>
              Meta & Filtros
            </span>
          </div>
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
            <div>
              <span className="font-semibold">Aviso:</span> {errorMessage}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Passo 1: Onde buscar? (Região e Município) */}
          <div className="rounded-xl border border-neutral-200/80 bg-neutral-50/60 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-neutral-900 text-white text-[11px] flex items-center justify-center font-bold">
                  1
                </span>
                <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                  Onde buscar? (Localização)
                </h3>
              </div>
              <span className="text-[11px] font-mono font-medium text-neutral-600 bg-white px-2.5 py-1 rounded-md border border-neutral-200 shadow-2xs">
                📍 {selectedCity === 'all' ? `Todas as cidades de ${selectedState}` : `${selectedCity} (${selectedState})`}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Estado */}
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                  Estado Brasileiro
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
                <p className="text-[11px] text-neutral-400 mt-1">
                  Selecione qualquer um dos 27 estados federativos do Brasil.
                </p>
              </div>

              {/* Cidade */}
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                  Cidade / Abrangência
                </label>
                <div className="relative">
                  <select
                    value={selectedCity}
                    onChange={(e) => setSelectedCity(e.target.value)}
                    disabled={loadingCities}
                    className="w-full appearance-none rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-xs font-medium text-neutral-800 shadow-2xs focus:border-neutral-900 focus:outline-hidden disabled:bg-neutral-50"
                  >
                    <option value="all">Todas as principais cidades do estado (Recomendado)</option>
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
                <p className="text-[11px] text-neutral-400 mt-1">
                  {selectedCity === 'all'
                    ? 'O robô percorrerá as maiores cidades do estado em lotes inteligentes.'
                    : `Varredura concentrada exclusivamente em ${selectedCity}.`}
                </p>
              </div>
            </div>
          </div>

          {/* Passo 2: O que buscar? (Nicho Comercial) */}
          <div className="rounded-xl border border-neutral-200/80 bg-neutral-50/60 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-neutral-900 text-white text-[11px] flex items-center justify-center font-bold">
                  2
                </span>
                <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                  Qual o nicho do seu cliente ideal?
                </h3>
              </div>
              <span className="text-[11px] font-mono font-medium text-neutral-600 bg-white px-2.5 py-1 rounded-md border border-neutral-200 shadow-2xs">
                🏢 {activeNiche || 'Nenhum nicho informado'}
              </span>
            </div>

            <p className="text-[11px] text-neutral-500">
              Escolha uma categoria popular para preencher rapidamente ou digite qualquer ramo de atividade.
            </p>

            <div className="space-y-3">
              {/* Presets clicáveis rápidos */}
              <div className="flex flex-wrap gap-1.5">
                {NICHE_PRESETS.map((preset) => {
                  const isSelected = activeNiche.toLowerCase() === preset.toLowerCase();
                  return (
                    <button
                      type="button"
                      key={preset}
                      onClick={() => {
                        setNiche(preset);
                        setCustomNiche('');
                      }}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-neutral-900 text-white border-neutral-900 shadow-2xs font-bold'
                          : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100 hover:border-neutral-300'
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>

              {/* Digitação Livre de Nicho */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Ou digite outro nicho manualmente (ex: Marmoraria, Pizzaria, Fisioterapia)..."
                    value={customNiche}
                    onChange={(e) => setCustomNiche(e.target.value)}
                    className="w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-xs text-neutral-800 placeholder-neutral-400 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
                  />
                </div>
                {customNiche && (
                  <button
                    type="button"
                    onClick={() => setCustomNiche('')}
                    className="text-xs text-neutral-500 hover:text-neutral-900 px-3 py-2 cursor-pointer underline text-[11px]"
                  >
                    Restaurar opções
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Passo 3: Quantidade & Filtros de Qualidade */}
          <div className="rounded-xl border border-neutral-200/80 bg-neutral-50/60 p-4 sm:p-5 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-200/60">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-neutral-900 text-white text-[11px] flex items-center justify-center font-bold">
                  3
                </span>
                <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                  Quantidade de Leads & Critérios
                </h3>
              </div>
              <span className="text-[11px] font-mono font-medium text-neutral-600 bg-white px-2.5 py-1 rounded-md border border-neutral-200 shadow-2xs">
                🎯 {activeTargetLeads === 0 ? 'Sem limite' : `${activeTargetLeads} leads`}
              </span>
            </div>

            {/* Controle da Meta de Leads (10 a 200 + Sem Limite na direita) */}
            <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3.5 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <span className="text-xs font-bold text-neutral-900 block">
                    Quantos leads você quer encontrar?
                  </span>
                  <span className="text-[11px] text-neutral-500">
                    Arraste o controle ou clique em um atalho. A busca encerra automaticamente ao atingir.
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Stepper Compacto (-10 / +10) */}
                  <div className="flex items-center bg-neutral-50 border border-neutral-200 rounded-lg p-0.5 shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setSliderValue((prev) => Math.max(10, prev <= 200 ? prev - 10 : 200))}
                      disabled={sliderValue <= 10}
                      className="w-7 h-7 flex items-center justify-center text-neutral-500 hover:text-neutral-900 disabled:opacity-30 rounded cursor-pointer transition-colors"
                      title="Diminuir 10 leads"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>

                    <div className="px-2.5 min-w-28 text-center">
                      {sliderValue >= 210 ? (
                        <span className="font-mono font-bold text-xs text-emerald-700 flex items-center justify-center gap-1">
                          <InfinityIcon className="w-3.5 h-3.5" /> Sem limite
                        </span>
                      ) : (
                        <span className="font-mono font-bold text-xs text-neutral-900">
                          {sliderValue} <span className="font-normal text-[11px] text-neutral-500 font-sans">leads</span>
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setSliderValue((prev) => Math.min(210, prev + 10))}
                      disabled={sliderValue >= 210}
                      className="w-7 h-7 flex items-center justify-center text-neutral-500 hover:text-neutral-900 disabled:opacity-30 rounded cursor-pointer transition-colors"
                      title="Aumentar 10 leads"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Botão Sem limite */}
                  <button
                    type="button"
                    onClick={() => setSliderValue(sliderValue >= 210 ? 50 : 210)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                      sliderValue >= 210
                        ? 'bg-neutral-900 text-white border-neutral-900 shadow-2xs'
                        : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50 hover:text-neutral-900'
                    }`}
                  >
                    <InfinityIcon className="w-3.5 h-3.5" />
                    <span>Sem limite</span>
                  </button>
                </div>
              </div>

              {/* Slider de 10 a 200 + Sem Limite na direita */}
              <div className="space-y-1 pt-1">
                <input
                  type="range"
                  min="10"
                  max="210"
                  step="10"
                  value={sliderValue}
                  onChange={(e) => setSliderValue(Number(e.target.value))}
                  style={{
                    background: `linear-gradient(to right, #171717 0%, #171717 ${((sliderValue - 10) / 200) * 100}%, #e5e7eb ${((sliderValue - 10) / 200) * 100}%, #e5e7eb 100%)`,
                  }}
                  className="w-full h-2 rounded-full cursor-pointer transition-all"
                />

                {/* Marcadores Clicáveis */}
                <div className="relative w-full h-4 text-[10px] font-mono select-none">
                  {[
                    { val: 10, label: '10' },
                    { val: 50, label: '50' },
                    { val: 100, label: '100' },
                    { val: 150, label: '150' },
                    { val: 200, label: '200' },
                    { val: 210, label: 'Sem limite (∞)' },
                  ].map((tick) => {
                    const pct = ((tick.val - 10) / 200) * 100;
                    const isActive =
                      (tick.val >= 210 && sliderValue >= 210) ||
                      (sliderValue < 210 && sliderValue === tick.val);

                    return (
                      <button
                        key={tick.val}
                        type="button"
                        onClick={() => setSliderValue(tick.val)}
                        style={{
                          left: `${pct}%`,
                          transform:
                            tick.val === 10
                              ? 'translateX(0%)'
                              : tick.val === 210
                              ? 'translateX(-100%)'
                              : 'translateX(-50%)',
                        }}
                        className={`absolute top-0 transition-colors cursor-pointer hover:text-neutral-900 ${
                          isActive
                            ? 'text-neutral-900 font-bold underline'
                            : 'text-neutral-400 font-normal'
                        }`}
                      >
                        {tick.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Botões de Atalhos Rápidos */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-100 text-xs text-neutral-500">
                <span className="text-[11px]">
                  {sliderValue >= 210
                    ? 'A varredura percorrerá todas as regiões sem parar por meta de quantidade.'
                    : `A busca parará automaticamente assim que qualificar ${sliderValue} leads.`}
                </span>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-neutral-400 font-medium">Atalhos:</span>
                  {[
                    { label: '20', val: 20 },
                    { label: '50 (Padrão)', val: 50 },
                    { label: '100', val: 100 },
                    { label: '200', val: 200 },
                    { label: 'Sem limite', val: 210 },
                  ].map((preset) => {
                    const isPresetActive =
                      (preset.val >= 210 && sliderValue >= 210) ||
                      (sliderValue < 210 && sliderValue === preset.val);

                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setSliderValue(preset.val)}
                        className={`px-2.5 py-1 text-[11px] rounded-lg border transition-all cursor-pointer ${
                          isPresetActive
                            ? 'bg-neutral-900 text-white border-neutral-900 font-semibold shadow-2xs'
                            : 'bg-neutral-50 text-neutral-600 border-neutral-200 hover:bg-neutral-100 hover:text-neutral-900'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Filtros Comerciais Opcionais */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-neutral-600" />
                <span className="text-xs font-semibold text-neutral-800 uppercase tracking-wider">
                  Filtros de Qualificação Comercial (Opcional)
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
                {/* Com telefone */}
                <label className="flex items-start gap-2.5 cursor-pointer bg-white p-3 rounded-lg border border-neutral-200/80 shadow-2xs hover:border-neutral-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={onlyWithPhone}
                    onChange={(e) => setOnlyWithPhone(e.target.checked)}
                    className="mt-0.5 rounded-sm border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                  />
                  <div>
                    <span className="text-xs font-semibold text-neutral-800 block">
                      Apenas com Telefone
                    </span>
                    <span className="text-[11px] text-neutral-500 leading-tight">
                      Garante número para contato imediato no WhatsApp.
                    </span>
                  </div>
                </label>

                {/* Sem site */}
                <label className="flex items-start gap-2.5 cursor-pointer bg-white p-3 rounded-lg border border-neutral-200/80 shadow-2xs hover:border-neutral-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={onlyWithoutWebsite}
                    onChange={(e) => setOnlyWithoutWebsite(e.target.checked)}
                    className="mt-0.5 rounded-sm border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                  />
                  <div>
                    <span className="text-xs font-semibold text-neutral-800 block">
                      Apenas sem Site
                    </span>
                    <span className="text-[11px] text-neutral-500 leading-tight">
                      Excelente para vender desenvolvimento web ou tráfego.
                    </span>
                  </div>
                </label>

                {/* Nota mínima */}
                <div className="bg-white p-3 rounded-lg border border-neutral-200/80 shadow-2xs">
                  <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                    Nota mínima no Google
                  </label>
                  <select
                    value={minRating}
                    onChange={(e) => setMinRating(Number(e.target.value))}
                    className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-800 font-mono shadow-2xs focus:border-neutral-900 focus:outline-hidden"
                  >
                    <option value={0}>Qualquer nota</option>
                    <option value={3.5}>3.5 ou mais</option>
                    <option value={4.0}>4.0 ou mais (Recomendado)</option>
                    <option value={4.5}>4.5 ou mais (Alto padrão)</option>
                  </select>
                </div>

                {/* Avaliações mínimas */}
                <div className="bg-white p-3 rounded-lg border border-neutral-200/80 shadow-2xs">
                  <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                    Mínimo de avaliações
                  </label>
                  <select
                    value={minReviews}
                    onChange={(e) => setMinReviews(Number(e.target.value))}
                    className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-800 font-mono shadow-2xs focus:border-neutral-900 focus:outline-hidden"
                  >
                    <option value={0}>Qualquer quantidade</option>
                    <option value={10}>Pelo menos 10 avaliações</option>
                    <option value={20}>Pelo menos 20 avaliações</option>
                    <option value={50}>Pelo menos 50 avaliações</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* PAINEL DE CONFIRMAÇÃO & INÍCIO EM TEMPO REAL */}
          <div className="rounded-xl border border-neutral-900/15 bg-neutral-900/5 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-900 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-neutral-900" />
                Resumo da Busca (Confirmação antes de iniciar)
              </span>
              <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Tudo pronto
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white p-3 rounded-lg border border-neutral-200/80 shadow-2xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-neutral-400">1. Onde</span>
                <p className="font-semibold text-xs text-neutral-900 truncate">
                  {selectedCity === 'all' ? `Todas as cidades de ${selectedState}` : `${selectedCity} (${selectedState})`}
                </p>
              </div>

              <div className="bg-white p-3 rounded-lg border border-neutral-200/80 shadow-2xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-neutral-400">2. O Que</span>
                <p className="font-semibold text-xs text-neutral-900 truncate">
                  {activeNiche || 'Informe um nicho acima'}
                </p>
              </div>

              <div className="bg-white p-3 rounded-lg border border-neutral-200/80 shadow-2xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-neutral-400">3. Quanto & Filtros</span>
                <p className="font-semibold text-xs text-neutral-900">
                  {activeTargetLeads === 0 ? 'Sem limite' : `${activeTargetLeads} leads`}
                  {onlyWithPhone ? ' · C/ Tel' : ''}
                  {onlyWithoutWebsite ? ' · S/ Site' : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
              <p className="text-[11px] text-neutral-500 max-w-md">
                O robô fará a extração no Google Places em tempo real, deduplicará registros e calculará o Score Comercial de cada lead.
              </p>

              <button
                type="submit"
                disabled={isSubmitting || !activeNiche}
                className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-neutral-900 px-6 py-3 text-xs font-bold text-white hover:bg-neutral-800 transition-all shadow-md active:scale-98 disabled:opacity-50 cursor-pointer shrink-0"
              >
                {isSubmitting ? (
                  <>
                    <RotateCw className="h-4 w-4 animate-spin text-white" />
                    <span>INICIANDO VARREDURA...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-white" />
                    <span>
                      INICIAR BUSCA DE LEADS {activeTargetLeads > 0 ? `(${activeTargetLeads})` : ''}
                    </span>
                  </>
                )}
              </button>
            </div>
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-neutral-900 text-sm">
                        {job.niche} — {job.city === 'all' ? `Todas as cidades de ${job.state}` : `${job.city}, ${job.state}`}
                      </span>
                      {job.target_leads && job.target_leads > 0 ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                          Meta: {job.target_leads}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-neutral-100 text-neutral-600 border border-neutral-200">
                          Sem limite
                        </span>
                      )}
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
