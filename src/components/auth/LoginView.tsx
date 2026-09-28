import React, { useState } from 'react';
import { ShieldCheck, ArrowRight, RotateCw, Lock, Mail, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';

interface LoginViewProps {
  onLoginSuccess: (user: { email: string; name: string }) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState<string>('gustavohcsantos.mm2020@gmail.com');
  const [password, setPassword] = useState<string>('prospecta123');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const res = await api.login(email, password);
      onLoginSuccess(res.user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-12 bg-neutral-50 selection:bg-neutral-900 selection:text-white">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-16 w-auto items-center justify-center">
            <img
              src="/icone-logo.png"
              alt="GH Prospecção Logo"
              className="h-14 w-auto object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = '/icone%20logo.png';
              }}
            />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">
            GH Prospecção
          </h1>
          <p className="text-xs text-neutral-500">
            Inteligência comercial para prospecção de empresas locais sem website
          </p>
        </div>

        {/* Card de Login */}
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-xs">
          {errorMsg && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                E-mail corporativo
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@empresa.com"
                  className="w-full rounded-lg border border-neutral-200 pl-9 pr-3.5 py-2 text-xs text-neutral-900 placeholder-neutral-400 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
                />
                <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-neutral-700">
                  Senha de acesso
                </label>
              </div>
              <div className="relative">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-neutral-200 pl-9 pr-3.5 py-2 text-xs text-neutral-900 placeholder-neutral-400 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
                />
                <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-neutral-900 py-2.5 text-xs font-semibold text-white hover:bg-neutral-800 transition-colors shadow-xs disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RotateCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Autenticando...</span>
                </>
              ) : (
                <>
                  <span>Entrar no Sistema</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-4 pt-3 border-t border-neutral-100 text-center">
            <span className="text-[11px] text-neutral-400">
              Ambiente protegido com Supabase Auth & RLS
            </span>
          </div>
        </div>

        {/* Informação sobre credencial padrão */}
        <div className="rounded-lg border border-neutral-200/60 bg-neutral-100/60 p-3 text-[11px] text-neutral-500 text-center space-y-1">
          <div>Credenciais de acesso pré-configuradas para avaliação:</div>
          <div className="font-mono text-neutral-700">
            {email}
          </div>
        </div>
      </div>
    </div>
  );
};
