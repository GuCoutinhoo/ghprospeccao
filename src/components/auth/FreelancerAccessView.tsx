import React, { useState, useEffect } from 'react';
import {
  Lock,
  ShieldAlert,
  ArrowRight,
  KeyRound,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { Freelancer } from '../../types';
import { api } from '../../lib/api';

interface FreelancerAccessViewProps {
  initialCode?: string;
  onWorkspaceReady: (freelancer: Freelancer, token: string) => void;
  onGoToAdminLogin: () => void;
}

export const FreelancerAccessView: React.FC<FreelancerAccessViewProps> = ({
  initialCode = '',
  onWorkspaceReady,
  onGoToAdminLogin,
}) => {
  const [accessCode, setAccessCode] = useState<string>(initialCode);
  const [pin, setPin] = useState<string>('');
  const [requiresPin, setRequiresPin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isBlocked, setIsBlocked] = useState<boolean>(false);
  const [blockedMessage, setBlockedMessage] = useState<string>('');

  useEffect(() => {
    if (initialCode && initialCode.trim()) {
      handleVerify(initialCode.trim());
    }
  }, [initialCode]);

  const handleVerify = async (codeToUse?: string, pinToUse?: string) => {
    const raw = (codeToUse || accessCode || '').trim();
    const code = raw
      .replace(/^https?:\/\/[^\/]+\/f\//i, '')
      .replace(/^\/f\//i, '')
      .replace(/\/+$/, '')
      .trim();

    if (!code) {
      setError('Por favor, informe seu nome ou código de acesso.');
      return;
    }

    setLoading(true);
    setError(null);
    setIsBlocked(false);

    try {
      const res = await api.verifyFreelancerLink(code, pinToUse || pin);
      onWorkspaceReady(res.freelancer, res.token);
    } catch (err: unknown) {
      const anyErr = err as any;
      if (anyErr.blocked) {
        setIsBlocked(true);
        setBlockedMessage(
          anyErr.message ||
            'Seu acesso ao GHProspecção foi desativado. Entre em contato com o administrador.'
        );
      } else if (anyErr.requiresPin) {
        setRequiresPin(true);
        setError('Este acesso requer um PIN de segurança.');
      } else {
        setError(anyErr.message || 'Código ou link de acesso inválido.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleVerify();
  };

  // TELA DE BLOQUEIO DE ACESSO (Exigência estrita do prompt #7)
  if (isBlocked) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 px-4 text-white">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <Lock className="h-8 w-8" />
            </div>
          </div>
          <h2 className="text-center text-2xl font-extrabold tracking-tight text-white">
            Acesso Desativado
          </h2>
          <p className="mt-2 text-center text-xs text-neutral-400">
            GHProspecção · Plataforma de Prospecção B2B
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-neutral-900 py-8 px-6 shadow-2xl rounded-2xl border border-neutral-800 text-center space-y-4">
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-200 text-sm leading-relaxed font-medium">
              "Seu acesso ao GHProspecção foi desativado. Entre em contato com o administrador."
            </div>

            <p className="text-xs text-neutral-400 leading-relaxed">
              O administrador desativou temporariamente o seu workspace. Todos os seus leads,
              buscas anteriores e dados continuam salvos com segurança.
            </p>

            <div className="pt-4 border-t border-neutral-800 space-y-2">
              <button
                onClick={() => {
                  setIsBlocked(false);
                  setError(null);
                }}
                className="w-full py-2.5 px-4 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Tentar Outro Código de Acesso
              </button>

              <button
                onClick={onGoToAdminLogin}
                className="w-full py-2 px-4 text-neutral-400 hover:text-white rounded-lg text-xs transition-colors cursor-pointer"
              >
                Acesso do Administrador ➔
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 px-4 text-white">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="flex justify-center mb-4">
          <div className="flex items-center justify-center h-16 w-16 rounded-2xl bg-neutral-900 border border-neutral-800 shadow-md">
            <img
              src="/icone-logo.png"
              alt="GH Prospecção"
              className="h-10 w-10 object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = '/icone%20logo.png';
              }}
            />
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
          GH Prospecção
        </h1>
        <p className="mt-1 text-xs text-neutral-400">
          Workspace Individual de Prospecção Comercial B2B
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-neutral-900 py-8 px-6 shadow-2xl rounded-2xl border border-neutral-800 space-y-6">
          <div className="text-center space-y-1">
            <h2 className="text-base font-semibold text-white">
              Entrar no seu Workspace de Freelancer
            </h2>
            <p className="text-xs text-neutral-400">
              Insira o código do link exclusivo fornecido pelo administrador.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Nome ou Código de Acesso do Freelancer
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="Ex: natalia ou natalia-ferreira"
                  className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-700 rounded-xl text-xs text-white placeholder-neutral-500 focus:border-amber-400 focus:outline-hidden font-mono tracking-wider font-bold"
                />
              </div>
              <span className="text-[10px] text-neutral-400 mt-1 block">
                Digite o nome cadastrado pelo administrador (ex: natalia) ou o link completo.
              </span>
            </div>

            {requiresPin && (
              <div className="animate-in fade-in duration-150">
                <label className="block text-xs font-semibold text-neutral-300 mb-1 flex items-center justify-between">
                  <span>PIN de Segurança (4 a 6 dígitos)</span>
                  <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Digite seu PIN"
                  className="w-full px-3.5 py-2.5 bg-neutral-950 border border-amber-500/50 rounded-xl text-xs text-white placeholder-neutral-500 focus:border-amber-400 focus:outline-hidden font-mono tracking-widest text-center"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-amber-400 hover:bg-amber-300 text-neutral-950 font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Validando Acesso Seguro...
                </>
              ) : (
                <>
                  Acessar Workspace Isolado
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="pt-4 border-t border-neutral-800 text-center space-y-3">
            <div className="text-[11px] text-neutral-400 flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Ambiente isolado · Seus dados e buscas são 100% privados</span>
            </div>

            <button
              onClick={onGoToAdminLogin}
              className="text-xs text-neutral-400 hover:text-white underline cursor-pointer block mx-auto"
            >
              É o administrador da plataforma? Faça login aqui ➔
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
