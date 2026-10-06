import React, { useState } from 'react';
import {
  LayoutDashboard,
  Search,
  Users,
  KanbanSquare,
  Settings,
  LogOut,
  MapPin,
  ExternalLink,
  ShieldCheck,
  Building2,
  X,
  Heart,
  Database,
  Zap,
  MessageSquareQuote,
  Activity,
  Shield,
  KeyRound,
  UserCheck,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
} from 'lucide-react';
import { Freelancer, UserRole } from '../../types';

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onLogout: () => void;
  hasCustomKey: boolean;
  userRole?: UserRole;
  freelancer?: Freelancer | null;
  adminUser?: { name: string; email: string } | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPath,
  onNavigate,
  isOpenMobile,
  onCloseMobile,
  onLogout,
  hasCustomKey,
  userRole = 'admin',
  freelancer,
  adminUser,
}) => {
  const isAdmin = userRole === 'admin';
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Links do Administrador
  const adminManagementItems = [
    { label: 'Painel Geral Admin', path: '/admin', icon: LayoutDashboard },
    { label: 'Gestão de Freelancers', path: '/admin/freelancers', icon: Users, badge: 'Equipe' },
    { label: 'Auditoria de Ações', path: '/admin/activities', icon: Activity },
  ];

  // Ferramentas de Prospecção
  const prospectingItems = isAdmin
    ? [
        { label: 'Dashboard Geral', path: '/dashboard', icon: LayoutDashboard },
        { label: 'Buscar Leads', path: '/search', icon: Search },
        { label: 'Base de Leads', path: '/leads', icon: Users },
        { label: 'Esteira Relâmpago', path: '/outreach', icon: Zap, badge: '⚡ 1-Click' },
        { label: 'Modelos de Abordagem', path: '/templates', icon: MessageSquareQuote, badge: 'Copy' },
        { label: 'Favoritos', path: '/favorites', icon: Heart },
        { label: 'Pipeline Comercial', path: '/pipeline', icon: KanbanSquare },
        { label: 'Configurações', path: '/settings', icon: Settings },
      ]
    : [
        { label: 'Meus Leads', path: '/leads', icon: Users },
        { label: 'Buscar Leads', path: '/search', icon: Search },
        { label: 'Esteira Relâmpago', path: '/outreach', icon: Zap, badge: '⚡ 1-Click' },
        { label: 'Pipeline Comercial', path: '/pipeline', icon: KanbanSquare },
        { label: 'Favoritos', path: '/favorites', icon: Heart },
        { label: 'Modelos de Abordagem', path: '/templates', icon: MessageSquareQuote, badge: 'Copy' },
        { label: 'Meu Dashboard', path: '/dashboard', icon: LayoutDashboard },
      ];

  const handleNav = (path: string) => {
    onNavigate(path);
    onCloseMobile();
  };

  return (
    <>
      {/* Overlay Mobile */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-neutral-900/40 backdrop-blur-xs lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex w-64 flex-col border-r border-neutral-200 bg-white transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Zone */}
        <div className="flex h-16 items-center justify-between px-5 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center shrink-0">
              <img
                src="/icone-logo.png"
                alt="GH Prospecção Logo"
                className="h-10 w-10 object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = '/icone%20logo.png';
                }}
              />
            </div>
            <div>
              <span className="font-semibold text-neutral-900 text-sm tracking-tight flex items-center gap-1.5">
                GH Prospecção
              </span>
              <span className="text-[10px] text-neutral-400 font-mono tracking-wider block uppercase">
                {isAdmin ? 'Painel Executivo' : 'Workspace B2B'}
              </span>
            </div>
          </div>
          <button
            onClick={onCloseMobile}
            className="p-1 text-neutral-400 hover:text-neutral-700 lg:hidden rounded-md"
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Banner do Workspace de Freelancer (quando logado como freelancer) */}
        {!isAdmin && freelancer && (
          <div className="m-3 p-3 bg-neutral-900 text-white rounded-xl shadow-xs border border-neutral-800 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-amber-400 font-semibold uppercase tracking-wider">
              <span>Workspace Privado</span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="text-xs font-bold text-white truncate">
              {freelancer.name}
            </div>
            <div className="text-[10px] text-neutral-400 font-mono">
              Código: {freelancer.access_code}
            </div>
          </div>
        )}

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {/* Seção Administrador (Apenas visível se isAdmin) */}
          {isAdmin && (
            <div className="space-y-1 pb-4">
              <div className="px-3 pb-2 text-[11px] font-bold text-amber-600 uppercase tracking-wider flex items-center gap-1.5">
                <Shield className="h-3 w-3" />
                Área do Administrador
              </div>
              {adminManagementItems.map((item) => {
                const Icon = item.icon;
                const active =
                  currentPath === item.path ||
                  (item.path !== '/admin' && currentPath.startsWith(item.path));
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNav(item.path)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-neutral-900 text-white font-semibold shadow-xs'
                        : 'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900'
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-amber-400' : 'text-neutral-400'}`} />
                    <span className="truncate">{item.label}</span>
                    {item.badge && (
                      <span
                        className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                          active
                            ? 'bg-amber-400 text-neutral-950'
                            : 'bg-amber-100 text-amber-900 border border-amber-300'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Seção Prospecção Comercial */}
          <div className="px-3 pt-2 pb-2 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            {isAdmin ? 'Ferramentas de Prospecção' : 'Menu de Prospecção'}
          </div>

          {prospectingItems.map((item) => {
            const Icon = item.icon;
            const active =
              currentPath === item.path ||
              (item.path !== '/dashboard' && !item.path.startsWith('/admin') && currentPath.startsWith(item.path));
            return (
              <button
                key={item.path}
                onClick={() => handleNav(item.path)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-neutral-900 text-white font-semibold shadow-xs'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-neutral-400'}`} />
                <span className="truncate">{item.label}</span>
                {item.badge && (
                  <span
                    className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                      active
                        ? 'bg-amber-400 text-neutral-950'
                        : 'bg-amber-100 text-amber-900 border border-amber-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* Integrações Oficiais (Apenas para Admin) */}
          {isAdmin && (
            <>
              <div className="pt-6 px-3 pb-2 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Infraestrutura do Sistema
              </div>

              <div
                onClick={() => onNavigate('/settings')}
                className="mx-2 rounded-lg border border-neutral-150 bg-neutral-50/70 p-3 text-xs space-y-2 cursor-pointer hover:border-neutral-300 hover:bg-neutral-100/60 transition-all group"
                title="Clique para gerenciar suas chaves de API e configurações"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-neutral-600 group-hover:text-neutral-900 font-medium flex items-center gap-1.5 transition-colors">
                    <MapPin className="h-3.5 w-3.5 text-neutral-500" />
                    Google Places API
                  </span>
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                      hasCustomKey
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {hasCustomKey ? 'Oficial Ativa' : 'Simulação'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-neutral-600 font-medium flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5 text-neutral-500" />
                    Google Firestore
                  </span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-100 text-emerald-800">
                    Sincronizado
                  </span>
                </div>
              </div>
            </>
          )}
        </nav>

        {/* User Session Footer */}
        <div className="border-t border-neutral-100 p-3">
          <div className="flex items-center justify-between rounded-lg p-2 bg-neutral-50/80">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="h-7 w-7 rounded-full bg-neutral-900 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                {isAdmin ? 'GS' : (freelancer?.name ? freelancer.name.substring(0, 2).toUpperCase() : 'FR')}
              </div>
              <div className="overflow-hidden">
                <div className="text-xs font-semibold text-neutral-900 truncate">
                  {isAdmin ? 'Gustavo Santos' : (freelancer?.name || 'Freelancer')}
                </div>
                <div className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {isAdmin ? 'Administrador Geral' : 'Workspace Ativo'}
                </div>
              </div>
            </div>
            {!isAdmin ? (
              <button
                type="button"
                onClick={() => {
                  setPasswordInput('');
                  setPasswordError(false);
                  setShowPassword(false);
                  setIsPasswordModalOpen(true);
                }}
                title="Acessar o Painel Geral (requer senha)"
                className="text-[10px] font-semibold text-neutral-600 hover:text-neutral-900 bg-neutral-200 hover:bg-neutral-300 px-2 py-1 rounded transition-colors cursor-pointer"
              >
                Painel Geral
              </button>
            ) : (
              <span className="text-[10px] font-mono font-bold bg-neutral-200 text-neutral-700 px-1.5 py-0.5 rounded">
                Livre
              </span>
            )}
          </div>
        </div>
      </aside>

      {/* Modal de Senha para Acesso ao Painel Geral */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-neutral-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <div className="flex items-center gap-2 text-neutral-900 font-semibold text-sm">
                <div className="h-8 w-8 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-700">
                  <Lock className="h-4 w-4" />
                </div>
                <span>Acesso ao Painel Geral</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsPasswordModalOpen(false);
                  setPasswordInput('');
                  setPasswordError(false);
                }}
                className="text-neutral-400 hover:text-neutral-700 p-1 rounded-md hover:bg-neutral-100 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (passwordInput.trim() === 'gu123') {
                  setIsPasswordModalOpen(false);
                  setPasswordInput('');
                  setPasswordError(false);
                  onLogout();
                } else {
                  setPasswordError(true);
                }
              }}
              className="mt-4 space-y-3"
            >
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Senha de Administrador
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={passwordInput}
                    onChange={(e) => {
                      setPasswordInput(e.target.value);
                      if (passwordError) setPasswordError(false);
                    }}
                    autoFocus
                    placeholder="Digite a senha..."
                    className={`w-full rounded-lg border px-3 py-2 text-sm pr-10 focus:outline-none transition-colors ${
                      passwordError
                        ? 'border-red-500 focus:border-red-500 ring-1 ring-red-500'
                        : 'border-neutral-300 focus:border-neutral-900'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 cursor-pointer p-0.5"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {passwordError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 mt-1.5 font-medium">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>Senha incorreta. Tente novamente.</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsPasswordModalOpen(false);
                    setPasswordInput('');
                    setPasswordError(false);
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg transition-colors shadow-xs cursor-pointer"
                >
                  Acessar Painel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
