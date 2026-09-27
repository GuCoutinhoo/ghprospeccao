import React from 'react';
import { Menu, Plus, RefreshCw, Download, Sparkles } from 'lucide-react';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onOpenMobile: () => void;
  onNewSearch?: () => void;
  onExportCsv?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onOpenMobile,
  onNewSearch,
  onExportCsv,
  onRefresh,
  isRefreshing = false,
}) => {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-neutral-200/80 bg-white/95 px-4 sm:px-6 backdrop-blur-xs">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobile}
          className="p-1.5 text-neutral-500 hover:text-neutral-900 lg:hidden rounded-md hover:bg-neutral-100"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div>
          <h1 className="text-sm sm:text-base font-semibold text-neutral-900 tracking-tight leading-none">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[11px] text-neutral-400 mt-1 hidden sm:block">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 rounded-md hover:bg-neutral-100 transition-colors disabled:opacity-50"
            title="Atualizar dados"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">Atualizar</span>
          </button>
        )}

        {onExportCsv && (
          <button
            onClick={onExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-md hover:bg-neutral-50 hover:border-neutral-300 transition-colors shadow-2xs"
          >
            <Download className="h-3.5 w-3.5 text-neutral-500" />
            <span className="hidden sm:inline">Exportar CSV</span>
          </button>
        )}

        {onNewSearch && (
          <button
            onClick={onNewSearch}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-md transition-colors shadow-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Nova Busca</span>
          </button>
        )}
      </div>
    </header>
  );
};
