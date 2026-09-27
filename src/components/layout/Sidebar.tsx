import React from 'react';
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
} from 'lucide-react';

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onLogout: () => void;
  hasCustomKey: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPath,
  onNavigate,
  isOpenMobile,
  onCloseMobile,
  onLogout,
  hasCustomKey,
}) => {
  const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { label: 'Buscar Leads', path: '/search', icon: Search },
    { label: 'Base de Leads', path: '/leads', icon: Users },
    { label: 'Favoritos', path: '/favorites', icon: Heart },
    { label: 'Pipeline Comercial', path: '/pipeline', icon: KanbanSquare },
    { label: 'Configurações', path: '/settings', icon: Settings },
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
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white font-bold text-sm tracking-tight shadow-xs">
              P
            </div>
            <div>
              <span className="font-semibold text-neutral-900 text-sm tracking-tight flex items-center gap-1.5">
                ProspectaPlaces
              </span>
              <span className="text-[10px] text-neutral-400 font-mono tracking-wider block uppercase">
                B2B Lead Engine
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

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            Menu Principal
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPath === item.path || (item.path !== '/dashboard' && currentPath.startsWith(item.path));
            return (
              <button
                key={item.path}
                onClick={() => handleNav(item.path)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-neutral-900 text-white font-semibold shadow-xs'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-neutral-400'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}

          <div className="pt-6 px-3 pb-2 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            Integrações Oficiais
          </div>

          <div className="mx-2 rounded-lg border border-neutral-150 bg-neutral-50/70 p-3 text-xs space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-neutral-600 font-medium flex items-center gap-1.5">
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
                {hasCustomKey ? 'Ativa' : 'Simulação'}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-neutral-600 font-medium flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-neutral-500" />
                IBGE Cidades
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-100 text-emerald-800">
                Conectado
              </span>
            </div>

            <p className="text-[11px] text-neutral-400 leading-tight pt-1">
              {hasCustomKey
                ? 'Chave oficial configurada para consultas ilimitadas.'
                : 'Configure sua chave em Configurações para produção.'}
            </p>
          </div>
        </nav>

        {/* User Session Footer */}
        <div className="border-t border-neutral-100 p-3">
          <div className="flex items-center justify-between rounded-lg p-2 hover:bg-neutral-50 transition-colors">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="h-7 w-7 rounded-full bg-neutral-200 flex items-center justify-center font-medium text-xs text-neutral-700 shrink-0">
                GS
              </div>
              <div className="overflow-hidden">
                <div className="text-xs font-medium text-neutral-900 truncate">Gustavo Santos</div>
                <div className="text-[10px] text-neutral-400 truncate font-mono">BDR Comercial</div>
              </div>
            </div>
            <button
              onClick={onLogout}
              title="Sair do sistema"
              className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-md hover:bg-neutral-100 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
