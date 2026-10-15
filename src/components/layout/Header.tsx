import React from 'react';
import { Menu, Plus, RefreshCw, Download, Sparkles, Shield, UserCheck } from 'lucide-react';
import { UserRole } from '../../types';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onOpenMobile: () => void;
  onNewSearch?: () => void;
  onExportCsv?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  userRole?: UserRole;
  freelancerName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onOpenMobile,
  onNewSearch,
  onExportCsv,
  onRefresh,
  isRefreshing = false,
  userRole = 'admin',
  freelancerName,
}) => {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-neutral-200/80 bg-white/95 px-4 sm:px-6 backdrop-blur-xs">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onOpenMobile}
          className="p-1.5 text-neutral-500 hover:text-neutral-900 lg:hidden rounded-md hover:bg-neutral-100"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm sm:text-base font-semibold text-neutral-900 tracking-tight leading-none truncate">
              {title}
            </h1>
            {freelancerName ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Bem-vinda(o), {freelancerName}
              </span>
            ) : userRole === 'admin' ? (
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-100 text-neutral-700 border border-neutral-200">
                <Shield className="h-3 w-3 text-amber-600" />
                Admin
              </span>
            ) : null}
          </div>
          {subtitle && (
            <p className="text-[11px] text-neutral-400 mt-1 hidden sm:block truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 rounded-md hover:bg-neutral-100 transition-colors disabled:opacity-50 cursor-pointer"
            title="Atualizar dados"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">Atualizar</span>
          </button>
        )}

        {onExportCsv && (
          <button
            onClick={onExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-md hover:bg-neutral-50 hover:border-neutral-300 transition-colors shadow-2xs cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-neutral-500" />
            <span className="hidden sm:inline">Exportar CSV</span>
          </button>
        )}

        {onNewSearch && (
          <button
            onClick={onNewSearch}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-md transition-colors shadow-xs cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Nova Busca</span>
          </button>
        )}
      </div>
    </header>
  );
};
