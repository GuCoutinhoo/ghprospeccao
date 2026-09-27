import React, { useState, useEffect } from 'react';
import {
  Key,
  Shield,
  Sliders,
  Database,
  Check,
  Copy,
  RotateCw,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Save,
  Server,
  Code,
} from 'lucide-react';
import { AppSettings } from '../../types';
import { api } from '../../lib/api';

interface SettingsViewProps {
  onSettingsUpdated?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onSettingsUpdated }) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [maxResults, setMaxResults] = useState<number>(100);
  const [maxCities, setMaxCities] = useState<number>(15);
  const [requestDelay, setRequestDelay] = useState<number>(600);

  // Pesos do lead score
  const [weights, setWeights] = useState({
    noWebsite: 30,
    withPhone: 20,
    highRating: 10,
    reviewsOver50: 15,
    reviewsOver200: 15,
    activeProfile: 10,
  });

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Teste de chave
  const [testingKey, setTestingKey] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ valid: boolean; error?: string; samplePlace?: string } | null>(null);

  // SQL Migrations
  const [sqlContent, setSqlContent] = useState<string>('');
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  useEffect(() => {
    async function loadData() {
      try {
        const s = await api.getSettings();
        setSettings(s);
        setApiKeyInput(s.googleMapsApiKey || '');
        setMaxResults(s.maxResultsPerJob || 100);
        setMaxCities(s.maxCitiesPerJob || 15);
        setRequestDelay(s.requestDelayMs || 600);
        if (s.scoringWeights) {
          setWeights(s.scoringWeights);
        }

        const sql = await api.getMigrationsSql();
        setSqlContent(sql);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);
    try {
      await api.updateSettings({
        googleMapsApiKey: apiKeyInput,
        maxResultsPerJob: maxResults,
        maxCitiesPerJob: maxCities,
        requestDelayMs: requestDelay,
        scoringWeights: weights,
      });
      setSaveSuccess(true);
      if (onSettingsUpdated) {
        onSettingsUpdated();
      }
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleTestKey = async () => {
    setTestingKey(true);
    setTestResult(null);
    try {
      const res = await api.testApiKey(apiKeyInput);
      setTestResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ valid: false, error: msg });
    } finally {
      setTestingKey(false);
    }
  };

  const copySqlToClipboard = () => {
    navigator.clipboard.writeText(sqlContent);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  if (loading && !settings) {
    return (
      <div className="flex items-center justify-center p-12 text-xs text-neutral-400">
        <RotateCw className="h-4 w-4 animate-spin mr-2" />
        Carregando configurações...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Banner de Status da Configuração */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 tracking-tight flex items-center gap-2">
              <Sliders className="h-4 w-4 text-neutral-800" />
              <span>Configurações do Sistema & APIs Oficiais</span>
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Gerencie chaves seguras, limites de quota, parâmetros de Lead Score e esquemas do Supabase.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-medium border ${
                settings?.hasCustomKey
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${settings?.hasCustomKey ? 'bg-emerald-600' : 'bg-amber-600'}`} />
              {settings?.hasCustomKey ? 'Chave Google Places Ativa' : 'Modo Demonstração Ativo'}
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Seção 1: Google Places API (New) */}
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-2xs space-y-4">
          <div className="pb-3 border-b border-neutral-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-neutral-700" />
              <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
                Google Places API (New)
              </h3>
            </div>
            <a
              href="https://console.cloud.google.com/google/maps-apis/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-900"
            >
              <span>Google Cloud Console</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <p className="text-xs text-neutral-500 leading-relaxed">
            Insira sua chave de API oficial com o serviço <strong>Places API (New)</strong> ativado. A chave é mantida em segurança no servidor Express e nunca exposta ao frontend.
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-neutral-700">
                GOOGLE_MAPS_API_KEY
              </label>
              {settings?.maskedKey && (
                <span className="text-[11px] text-neutral-500 font-mono">
                  Ativa no servidor: <span className="font-semibold text-neutral-700">{settings.maskedKey}</span>
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="AIzaSy..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="flex-1 rounded-lg border border-neutral-200 px-3.5 py-2 text-xs font-mono text-neutral-800 placeholder-neutral-400 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
              />
              <button
                type="button"
                onClick={handleTestKey}
                disabled={testingKey}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors disabled:opacity-50 shrink-0"
              >
                {testingKey ? (
                  <>
                    <RotateCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Testando...</span>
                  </>
                ) : (
                  <span>Testar Chave</span>
                )}
              </button>
            </div>
          </div>

          {/* Resultado do Teste */}
          {testResult && (
            <div
              className={`p-3 rounded-lg text-xs border ${
                testResult.valid
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {testResult.valid ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>
                    Chave válida e autenticada com sucesso! Resposta oficial recebida com êxito.
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Erro retornado pela Google:</span>{' '}
                    {testResult.error || 'Chave rejeitada pela API.'}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Parâmetros de Quota e Taxa */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-neutral-100">
            <div>
              <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                Delay entre requisições (ms)
              </label>
              <input
                type="number"
                min={300}
                max={5000}
                value={requestDelay}
                onChange={(e) => setRequestDelay(Number(e.target.value))}
                className="w-full rounded-md border border-neutral-200 p-2 text-xs font-mono"
              />
              <span className="text-[10px] text-neutral-400 mt-1 block">
                Protege contra limites de cota da API.
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                Máximo de cidades por busca
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxCities}
                onChange={(e) => setMaxCities(Number(e.target.value))}
                className="w-full rounded-md border border-neutral-200 p-2 text-xs font-mono"
              />
              <span className="text-[10px] text-neutral-400 mt-1 block">
                Controle de volume financeiro por lote.
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                FieldMask Ativo
              </label>
              <div className="text-[11px] font-mono text-neutral-500 bg-neutral-50 p-2 rounded border border-neutral-200 truncate">
                places.id, displayName, nationalPhoneNumber...
              </div>
              <span className="text-[10px] text-neutral-400 mt-1 block">
                Otimizado para menor custo de faturamento.
              </span>
            </div>
          </div>
        </div>

        {/* Seção 2: Fórmula do Lead Score (Item 4) */}
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-2xs space-y-4">
          <div className="pb-3 border-b border-neutral-100 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
              Pesos da Fórmula de Lead Score (0 - 100)
            </h3>
            <span className="text-xs font-mono text-neutral-500">
              Total Atual: {Object.values(weights).reduce((a, b) => a + b, 0)} pts
            </span>
          </div>

          <p className="text-xs text-neutral-500">
            Ajuste a pontuação interna que prioriza comercialmente cada oportunidade:
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="border border-neutral-200 rounded-lg p-2.5">
              <label className="text-neutral-600 block text-[11px] mb-1">Sem site (+pts)</label>
              <input
                type="number"
                value={weights.noWebsite}
                onChange={(e) => setWeights({ ...weights, noWebsite: Number(e.target.value) })}
                className="w-full font-mono text-xs p-1 border rounded"
              />
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
              <label className="text-neutral-600 block text-[11px] mb-1">Com telefone (+pts)</label>
              <input
                type="number"
                value={weights.withPhone}
                onChange={(e) => setWeights({ ...weights, withPhone: Number(e.target.value) })}
                className="w-full font-mono text-xs p-1 border rounded"
              />
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
              <label className="text-neutral-600 block text-[11px] mb-1">Nota &gt;= 4.5 (+pts)</label>
              <input
                type="number"
                value={weights.highRating}
                onChange={(e) => setWeights({ ...weights, highRating: Number(e.target.value) })}
                className="w-full font-mono text-xs p-1 border rounded"
              />
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
              <label className="text-neutral-600 block text-[11px] mb-1">&gt; 50 avaliações (+pts)</label>
              <input
                type="number"
                value={weights.reviewsOver50}
                onChange={(e) => setWeights({ ...weights, reviewsOver50: Number(e.target.value) })}
                className="w-full font-mono text-xs p-1 border rounded"
              />
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
              <label className="text-neutral-600 block text-[11px] mb-1">&gt; 200 avaliações (+pts)</label>
              <input
                type="number"
                value={weights.reviewsOver200}
                onChange={(e) => setWeights({ ...weights, reviewsOver200: Number(e.target.value) })}
                className="w-full font-mono text-xs p-1 border rounded"
              />
            </div>
            <div className="border border-neutral-200 rounded-lg p-2.5">
              <label className="text-neutral-600 block text-[11px] mb-1">Perfil ativo (+pts)</label>
              <input
                type="number"
                value={weights.activeProfile}
                onChange={(e) => setWeights({ ...weights, activeProfile: Number(e.target.value) })}
                className="w-full font-mono text-xs p-1 border rounded"
              />
            </div>
          </div>
        </div>

        {/* Botão de Salvar Configurações */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-neutral-500">
            {saveSuccess && (
              <span className="text-emerald-700 font-medium flex items-center gap-1">
                <Check className="h-4 w-4" /> Configurações salvas com sucesso!
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 transition-colors shadow-xs disabled:opacity-50"
          >
            {saving ? (
              <>
                <RotateCw className="h-4 w-4 animate-spin" />
                <span>Salvando...</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                <span>Salvar Configurações</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Seção 3: Supabase & PostgreSQL Migration SQL Viewer */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-2xs space-y-4">
        <div className="pb-3 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-neutral-700" />
            <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
              Script SQL de Migrações (Supabase / PostgreSQL)
            </h3>
          </div>
          <button
            type="button"
            onClick={copySqlToClipboard}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-md hover:bg-neutral-50 transition-colors"
          >
            {copiedSql ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-emerald-700 font-semibold">Copiado!</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-neutral-500" />
                <span>Copiar SQL</span>
              </>
            )}
          </button>
        </div>

        <p className="text-xs text-neutral-500 leading-relaxed">
          Copie este script SQL para executar no <strong>SQL Editor do Supabase</strong>. Ele cria todas as tabelas (<code>profiles</code>, <code>places</code>, <code>leads</code>, <code>lead_notes</code>, <code>search_jobs</code>, <code>search_areas</code>, <code>search_queries</code>, <code>pipeline_history</code>), índices de alta performance e políticas de Row Level Security (RLS).
        </p>

        <div className="relative">
          <pre className="max-h-60 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-950 p-4 font-mono text-[11px] text-neutral-300 leading-relaxed">
            {sqlContent}
          </pre>
        </div>
      </div>
    </div>
  );
};
