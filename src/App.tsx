import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { DashboardView } from './components/dashboard/DashboardView';
import { SearchFormView } from './components/search/SearchFormView';
import { SearchJobDetailView } from './components/search/SearchJobDetailView';
import { LeadsTableView } from './components/leads/LeadsTableView';
import { FavoritesView } from './components/favorites/FavoritesView';
import { LeadDetailModal } from './components/leads/LeadDetailModal';
import { WebsiteMockupView } from './components/preview/WebsiteMockupView';
import { PipelineKanbanView } from './components/pipeline/PipelineKanbanView';
import { SettingsView } from './components/settings/SettingsView';
import { SpeedOutreachView } from './components/outreach/SpeedOutreachView';
import { TemplatesView } from './components/templates/TemplatesView';
import { LoginView } from './components/auth/LoginView';
import { DashboardStats, Lead } from './types';
import { api } from './lib/api';

const DEFAULT_STATS: DashboardStats = {
  totalLeads: 0,
  newLeads: 0,
  contactedLeads: 0,
  interestedLeads: 0,
  closedLeads: 0,
  noWebsiteLeads: 0,
  withPhoneLeads: 0,
  responseRate: 0,
  closingRate: 0,
  leadsByDay: [],
  leadsByNiche: [],
  leadsByState: [],
  pipelineDistribution: [
    { status: 'NOVO', count: 0 },
    { status: 'PRÉVIA CRIADA', count: 0 },
    { status: 'CONTATADO', count: 0 },
    { status: 'RESPONDEU', count: 0 },
    { status: 'INTERESSADO', count: 0 },
    { status: 'REUNIÃO', count: 0 },
    { status: 'PROPOSTA', count: 0 },
    { status: 'FECHADO', count: 0 },
    { status: 'PERDIDO', count: 0 },
  ],
  topOpportunities: [],
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<{ email: string; name: string } | null>({
    email: 'gustavohcsantos.mm2020@gmail.com',
    name: 'Gustavo Santos',
  });

  const [currentPath, setCurrentPath] = useState<string>('/dashboard');
  const [activeSearchJobId, setActiveSearchJobId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  // Filtros contextuais passados para a tabela de leads
  const [leadsNicheFilter, setLeadsNicheFilter] = useState<string | undefined>(undefined);
  const [leadsStateFilter, setLeadsStateFilter] = useState<string | undefined>(undefined);

  // Mobile sidebar
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);

  // Dados globais
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [hasCustomKey, setHasCustomKey] = useState<boolean>(true);

  // Link público de demonstração do mockup (acesso direto via ?leadId=... ou /preview?leadId=...)
  const [publicPreviewLead, setPublicPreviewLead] = useState<Lead | null>(null);
  const [loadingPublicPreview, setLoadingPublicPreview] = useState<boolean>(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const leadId = urlParams.get('leadId');
    if (leadId) {
      setLoadingPublicPreview(true);
      api.getLeadById(leadId)
        .then((res) => {
          if (res?.lead) {
            setPublicPreviewLead(res.lead);
          }
        })
        .catch((err) => console.error('Erro ao carregar prévia pública:', err))
        .finally(() => setLoadingPublicPreview(false));
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadInitialData();
    }
  }, [isAuthenticated]);

  const loadInitialData = async () => {
    setIsRefreshing(true);
    try {
      const [s, set] = await Promise.all([
        api.getDashboardStats().catch((e) => {
          console.warn('[App] Erro ao carregar stats da API:', e);
          return null;
        }),
        api.getSettings().catch((e) => {
          console.warn('[App] Erro ao carregar settings da API:', e);
          return null;
        }),
      ]);
      setStats(s || stats || DEFAULT_STATS);
      if (set && typeof set.hasCustomKey === 'boolean') {
        setHasCustomKey(set.hasCustomKey);
      }
    } catch (err) {
      console.error('Falha ao carregar dados iniciais:', err);
      if (!stats) setStats(DEFAULT_STATS);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await api.syncFirestore().catch((e) => console.warn('[App] Sincronização Firestore falhou:', e));
      await loadInitialData();
    } catch (err) {
      console.error('Falha ao atualizar dados:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    if (!path.startsWith('/search/')) {
      setActiveSearchJobId(null);
    }
    // Quando navega diretamente para /leads pelo menu, limpa filtros contextuais de buscas antigas
    if (path === '/leads') {
      setLeadsNicheFilter(undefined);
      setLeadsStateFilter(undefined);
    }
  };

  const handleJobStarted = (jobId: string) => {
    setActiveSearchJobId(jobId);
    setCurrentPath(`/search/${jobId}`);
  };

  const handleSelectExistingJob = (jobId: string) => {
    setActiveSearchJobId(jobId);
    setCurrentPath(`/search/${jobId}`);
  };

  const handleViewLeadsFromJob = (niche?: string, state?: string) => {
    setLeadsNicheFilter(niche);
    setLeadsStateFilter(state);
    setCurrentPath('/leads');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
  };

  // Se não estiver logado, exibe tela de login
  if (!isAuthenticated) {
    return (
      <LoginView
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setIsAuthenticated(true);
        }}
      />
    );
  }

  // Títulos e subtítulos contextuais para o header
  const getHeaderMeta = () => {
    if (currentPath === '/dashboard') {
      return {
        title: 'Visão Geral & Métricas',
        subtitle: 'Indicadores de prospecção comercial e oportunidades mapeadas',
      };
    }
    if (currentPath === '/search') {
      return {
        title: 'Buscar Novos Leads',
        subtitle: 'Varredura por municípios via Google Places API (New) e IBGE',
      };
    }
    if (currentPath.startsWith('/search/')) {
      return {
        title: 'Monitoramento da Busca',
        subtitle: 'Acompanhamento do processamento em lotes e células geográficas',
      };
    }
    if (currentPath === '/leads') {
      return {
        title: 'Base de Estabelecimentos & Leads',
        subtitle: 'Gerenciamento comercial, filtros de qualificação e exportação',
      };
    }
    if (currentPath === '/outreach') {
      return {
        title: 'Esteira Relâmpago de Prospecção (1-Click)',
        subtitle: 'Disparo rápido no WhatsApp e Direct do Instagram com metas e atalhos',
      };
    }
    if (currentPath === '/templates') {
      return {
        title: 'Modelos de Abordagem & Copywriting de Vendas',
        subtitle: 'Scripts validados para WhatsApp, Instagram Direct, Áudio e Fechamento',
      };
    }
    if (currentPath === '/favorites') {
      return {
        title: 'Leads & Estabelecimentos Favoritos',
        subtitle: 'Lojas prioritárias categorizadas por nicho de atuação',
      };
    }
    if (currentPath === '/pipeline') {
      return {
        title: 'Funil de Vendas Comercial (Kanban)',
        subtitle: 'Gestão de contatos, respostas e fechamento de contratos',
      };
    }
    if (currentPath === '/settings') {
      return {
        title: 'Configurações do Sistema',
        subtitle: 'Chaves de API, cotas e scripts de migração do Supabase',
      };
    }
    return { title: 'ProspectaPlaces B2B' };
  };

  const headerMeta = getHeaderMeta();

  if (loadingPublicPreview) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-6">
        <div className="h-8 w-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mb-3" />
        <span className="text-xs font-medium text-neutral-400">Carregando demonstração interativa da loja...</span>
      </div>
    );
  }

  if (publicPreviewLead) {
    return (
      <div className="min-h-screen bg-white">
        <div className="bg-neutral-950 text-white px-4 py-2.5 text-xs flex items-center justify-between border-b border-neutral-800 sticky top-0 z-50">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-bold">Demonstração Interativa Oficial · {publicPreviewLead.name}</span>
          </div>
          <button
            onClick={() => {
              window.history.replaceState({}, '', window.location.pathname);
              setPublicPreviewLead(null);
            }}
            className="text-[11px] text-neutral-400 hover:text-white underline cursor-pointer"
          >
            Acessar Painel B2B
          </button>
        </div>
        <WebsiteMockupView lead={publicPreviewLead} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex">
      {/* Sidebar Fixa Desktop & Drawer Mobile */}
      <Sidebar
        currentPath={currentPath}
        onNavigate={handleNavigate}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onLogout={handleLogout}
        hasCustomKey={hasCustomKey}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        {/* Top Header */}
        <Header
          title={headerMeta.title}
          subtitle={headerMeta.subtitle}
          onOpenMobile={() => setIsMobileSidebarOpen(true)}
          onNewSearch={currentPath !== '/search' ? () => handleNavigate('/search') : undefined}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />

        {/* Viewport Principal */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {currentPath === '/dashboard' && (
            <DashboardView
              stats={stats || DEFAULT_STATS}
              onSelectLead={(lead) => setSelectedLead(lead)}
              onNavigateToSearch={() => handleNavigate('/search')}
              onNavigateToLeads={() => handleNavigate('/leads')}
              onNavigateToFavorites={() => handleNavigate('/favorites')}
              onNavigateToOutreach={() => handleNavigate('/outreach')}
            />
          )}

          {currentPath === '/search' && (
            <SearchFormView
              onJobStarted={handleJobStarted}
              onSelectExistingJob={handleSelectExistingJob}
            />
          )}

          {currentPath.startsWith('/search/') && activeSearchJobId && (
            <SearchJobDetailView
              jobId={activeSearchJobId}
              onBack={() => handleNavigate('/search')}
              onViewLeads={handleViewLeadsFromJob}
            />
          )}

          {currentPath === '/leads' && (
            <LeadsTableView
              onSelectLead={(lead) => setSelectedLead(lead)}
              initialNicheFilter={leadsNicheFilter}
              initialStateFilter={leadsStateFilter}
              onStartSpeedOutreach={() => handleNavigate('/outreach')}
            />
          )}

          {currentPath === '/outreach' && (
            <SpeedOutreachView
              onSelectLead={(lead) => setSelectedLead(lead)}
              onNavigateToPipeline={() => handleNavigate('/pipeline')}
              onNavigateToLeads={() => handleNavigate('/leads')}
              onNavigateToTemplates={() => handleNavigate('/templates')}
            />
          )}

          {currentPath === '/templates' && (
            <TemplatesView
              onNavigateToOutreach={() => handleNavigate('/outreach')}
              onSelectLead={(lead) => setSelectedLead(lead)}
            />
          )}

          {currentPath === '/favorites' && (
            <FavoritesView
              onSelectLead={(lead) => setSelectedLead(lead)}
              onNavigateToLeads={() => handleNavigate('/leads')}
            />
          )}

          {currentPath === '/pipeline' && (
            <PipelineKanbanView
              onSelectLead={(lead) => setSelectedLead(lead)}
            />
          )}

          {currentPath === '/settings' && <SettingsView onSettingsUpdated={loadInitialData} />}
        </main>
      </div>

      {/* Modal de Detalhes do Lead */}
      {selectedLead && (
        <LeadDetailModal
          leadId={selectedLead.id}
          onClose={() => setSelectedLead(null)}
          onLeadUpdated={(updated) => {
            setSelectedLead(updated);
            loadInitialData();
          }}
        />
      )}
    </div>
  );
}
