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
import { FreelancerAccessView } from './components/auth/FreelancerAccessView';
import { AdminDashboardView } from './components/admin/AdminDashboardView';
import { FreelancersListView } from './components/admin/FreelancersListView';
import { FreelancerDetailView } from './components/admin/FreelancerDetailView';
import { AuditLogView } from './components/admin/AuditLogView';
import { DashboardStats, Lead, Freelancer, UserRole } from './types';
import { api, getActiveFreelancerSession } from './lib/api';
import { invalidateLeadsCache } from './lib/firebase/client';
import { ShieldAlert, ArrowLeft } from 'lucide-react';

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

function getInitialSession(): {
  role: UserRole;
  activeFreelancer: Freelancer | null;
  adminUser: { email: string; name: string } | null;
  currentPath: string;
} {
  if (typeof window === 'undefined') {
    return {
      role: 'admin',
      activeFreelancer: null,
      adminUser: { email: 'gustavohcsantos.mm2020@gmail.com', name: 'Gustavo Santos' },
      currentPath: '/dashboard',
    };
  }

  const pathname = window.location.pathname;
  const hash = window.location.hash;
  const search = window.location.search;

  // Extrai código de acesso por pathname (/f/andre), hash (#/f/andre) ou query (?f=andre)
  let rawCode = '';
  if (pathname.startsWith('/f/')) {
    rawCode = pathname.replace(/^\/f\//, '').split('/')[0].split('?')[0].split('#')[0].trim();
  } else if (hash.startsWith('#/f/')) {
    rawCode = hash.replace(/^#\/f\//, '').split('/')[0].split('?')[0].trim();
  } else if (search.includes('f=')) {
    const params = new URLSearchParams(search);
    rawCode = (params.get('f') || '').trim();
  }

  const cleanCode = rawCode.toLowerCase();

  // Se o link for /f/admin ou /f/administrador -> ENTRA NO WORKSPACE DO ADMIN
  if (cleanCode === 'admin' || cleanCode === 'administrador') {
    try {
      localStorage.setItem('gh_admin_token', 'admin_master_session_token');
      localStorage.setItem(
        'gh_admin_user',
        JSON.stringify({
          id: 'admin_1',
          email: 'gustavohcsantos.mm2020@gmail.com',
          name: 'Gustavo Santos',
          role: 'admin',
        })
      );
      localStorage.removeItem('gh_freelancer_token');
      localStorage.removeItem('gh_freelancer_session');
    } catch {}

    return {
      role: 'admin',
      activeFreelancer: null,
      adminUser: { email: 'gustavohcsantos.mm2020@gmail.com', name: 'Gustavo Santos' },
      currentPath: '/admin',
    };
  }

  // Para QUALQUER OUTRO CÓDIGO (ex: /f/andre, /f/danilo) -> ENTRA NO WORKSPACE DO FREELANCER!
  if (cleanCode) {
    const formattedName = cleanCode.charAt(0).toUpperCase() + cleanCode.slice(1);
    const instantFreelancer: Freelancer = {
      id: `free_${cleanCode}`,
      name: formattedName,
      access_code: cleanCode,
      email: `${cleanCode}@ghprospeccao.com`,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const token = `free_sess_free_${cleanCode}_${Date.now()}_instant`;
    try {
      localStorage.setItem('gh_freelancer_token', token);
      localStorage.setItem('gh_freelancer_session', JSON.stringify({ token, freelancer: instantFreelancer }));
      localStorage.removeItem('gh_admin_token');
      localStorage.removeItem('gh_admin_user');
    } catch {}

    return {
      role: 'freelancer',
      activeFreelancer: instantFreelancer,
      adminUser: null,
      currentPath: '/leads',
    };
  }

  // Se já havia sessão ativa salva de freelancer e não está acessando rota de admin
  const freeSession = getActiveFreelancerSession();
  if (freeSession?.freelancer && !pathname.startsWith('/admin')) {
    return {
      role: 'freelancer',
      activeFreelancer: freeSession.freelancer,
      adminUser: null,
      currentPath: pathname === '/' || pathname.startsWith('/f/') || pathname === '/dashboard' ? '/leads' : pathname,
    };
  }

  // Caso padrão: Administrador Geral Master
  try {
    localStorage.setItem('gh_admin_token', 'admin_master_session_token');
    localStorage.setItem(
      'gh_admin_user',
      JSON.stringify({
        id: 'admin_1',
        email: 'gustavohcsantos.mm2020@gmail.com',
        name: 'Gustavo Santos',
        role: 'admin',
      })
    );
  } catch {}

  let initialPath = '/dashboard';
  if (pathname.startsWith('/admin')) initialPath = pathname;
  else if (pathname === '/leads' || pathname === '/search' || pathname === '/outreach' || pathname === '/pipeline' || pathname === '/templates' || pathname === '/favorites' || pathname === '/settings') {
    initialPath = pathname;
  }

  return {
    role: 'admin',
    activeFreelancer: null,
    adminUser: { email: 'gustavohcsantos.mm2020@gmail.com', name: 'Gustavo Santos' },
    currentPath: initialPath,
  };
}

export default function App() {
  const [initSession] = useState(getInitialSession);
  // Roles: 'admin' | 'freelancer'
  const [userRole, setUserRole] = useState<UserRole>(initSession.role);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [adminUser, setAdminUser] = useState<{ email: string; name: string } | null>(initSession.adminUser);
  const [activeFreelancer, setActiveFreelancer] = useState<Freelancer | null>(initSession.activeFreelancer);

  // Navegação - Acesso Direto Instantâneo
  const [currentPath, setCurrentPath] = useState<string>(initSession.currentPath);
  const [activeSearchJobId, setActiveSearchJobId] = useState<string | null>(null);
  const [selectedFreelancerIdForDetail, setSelectedFreelancerIdForDetail] = useState<string | null>(null);
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
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Link público de demonstração do mockup (acesso direto via ?leadId=... ou /preview?leadId=...)
  const [publicPreviewLead, setPublicPreviewLead] = useState<Lead | null>(null);
  const [loadingPublicPreview, setLoadingPublicPreview] = useState<boolean>(false);

  // 1. Inicialização de rotas com Acesso Direto Instantâneo
  useEffect(() => {
    const pathname = window.location.pathname;
    const hash = window.location.hash;
    const search = window.location.search;

    let rawCode = '';
    if (pathname.startsWith('/f/')) {
      rawCode = pathname.replace(/^\/f\//, '').split('/')[0].split('?')[0].split('#')[0].trim();
    } else if (hash.startsWith('#/f/')) {
      rawCode = hash.replace(/^#\/f\//, '').split('/')[0].split('?')[0].trim();
    } else if (search.includes('f=')) {
      const params = new URLSearchParams(search);
      rawCode = (params.get('f') || '').trim();
    }

    const cleanCode = rawCode.toLowerCase();

    // Se o código for 'admin' ou 'administrador' -> Workspace do Administrador
    if (cleanCode === 'admin' || cleanCode === 'administrador') {
      setUserRole('admin');
      setActiveFreelancer(null);
      setAdminUser({ email: 'gustavohcsantos.mm2020@gmail.com', name: 'Gustavo Santos' });
      setCurrentPath('/admin');
      loadInitialData();
      return;
    }

    // Se for código de um freelancer (ex: /f/andre) -> sincroniza com o backend e abre direto em /leads
    if (cleanCode) {
      setCurrentPath('/leads');
      api.verifyFreelancerLink(cleanCode)
        .then((res) => {
          if (res?.freelancer) {
            setActiveFreelancer(res.freelancer);
            setUserRole('freelancer');
            setIsAuthenticated(true);
            setCurrentPath('/leads');
            try {
              localStorage.setItem('gh_freelancer_token', res.token);
              localStorage.setItem('gh_freelancer_session', JSON.stringify({ token: res.token, freelancer: res.freelancer }));
            } catch {}
          }
        })
        .catch((err) => {
          console.warn('[App] Usando sessão direta do freelancer:', err);
        })
        .finally(() => {
          loadInitialData();
        });
      return;
    }

    // Se não é /f/, carrega dados normalmente
    loadInitialData();
  }, []);

  // 2. Prévia de Lead pública via ?leadId=
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const leadId = urlParams.get('leadId');
    if (leadId) {
      setLoadingPublicPreview(true);
      api
        .getLeadById(leadId)
        .then((res) => {
          if (res?.lead) {
            setPublicPreviewLead(res.lead);
          }
        })
        .catch((err) => console.error('Erro ao carregar prévia pública:', err))
        .finally(() => setLoadingPublicPreview(false));
    }
  }, []);

  // 3. Carregar dados do dashboard no carregamento direto
  useEffect(() => {
    loadInitialData();
  }, [userRole]);

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
      invalidateLeadsCache();
      await api.syncFirestore().catch((e) => console.warn('[App] Sincronização Firestore falhou:', e));
      await loadInitialData();
      setRefreshTrigger((prev) => prev + 1);
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
    if (!path.startsWith('/admin/freelancers/')) {
      setSelectedFreelancerIdForDetail(null);
    }
    // Quando navega diretamente para /leads pelo menu, limpa filtros contextuais
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
    if (userRole === 'freelancer') {
      api.freelancerLogout();
      setActiveFreelancer(null);
      setUserRole('admin');
      setAdminUser({ email: 'gustavohcsantos.mm2020@gmail.com', name: 'Gustavo Santos' });
      setCurrentPath('/admin');
      if (window.history && window.history.pushState) {
        window.history.pushState({}, '', '/admin');
      }
      loadInitialData();
    } else {
      loadInitialData();
    }
  };

  // Títulos e subtítulos contextuais para o header
  const getHeaderMeta = () => {
    if (currentPath === '/admin' || currentPath === '/admin/dashboard') {
      return {
        title: 'Painel Geral de Controle',
        subtitle: 'Visão consolidada da operação, métricas comerciais por freelancer e auditoria em tempo real',
      };
    }
    if (currentPath === '/admin/freelancers') {
      return {
        title: 'Gestão de Freelancers & Equipe',
        subtitle: 'Criação de acessos, links exclusivos, bloqueio/desbloqueio e métricas individuais',
      };
    }
    if (currentPath.startsWith('/admin/freelancers/')) {
      return {
        title: 'Perfil & Desempenho do Freelancer',
        subtitle: 'Histórico de atividades, leads atribuídos, varreduras e vendas fechadas',
      };
    }
    if (currentPath === '/admin/activities') {
      return {
        title: 'Auditoria de Ações & Rastreabilidade',
        subtitle: 'Log inalterável em tempo real de buscas, abordagens, respostas e vendas',
      };
    }
    if (currentPath === '/dashboard') {
      return {
        title: userRole === 'freelancer' ? 'Meu Dashboard' : 'Visão Geral & Métricas',
        subtitle:
          userRole === 'freelancer'
            ? `Workspace individual de ${activeFreelancer?.name || 'prospecção'}`
            : 'Indicadores de prospecção comercial e oportunidades mapeadas',
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
        title: userRole === 'freelancer' ? 'Meus Estabelecimentos & Leads' : 'Base Global de Leads',
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
    return { title: 'GH Prospecção' };
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
        userRole={userRole}
        freelancer={activeFreelancer}
        adminUser={adminUser}
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
          userRole={userRole}
          freelancerName={activeFreelancer?.name}
        />

        {/* Viewport Principal */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {/* ================= AREA ADMINISTRATIVA ================= */}
          {userRole === 'admin' && (currentPath === '/admin' || currentPath === '/admin/dashboard') && (
            <AdminDashboardView
              onNavigateToFreelancers={() => handleNavigate('/admin/freelancers')}
              onNavigateToActivities={() => handleNavigate('/admin/activities')}
              onSelectFreelancer={(id) => {
                setSelectedFreelancerIdForDetail(id);
                setCurrentPath(`/admin/freelancers/${id}`);
              }}
            />
          )}

          {userRole === 'admin' && currentPath === '/admin/freelancers' && (
            <FreelancersListView
              onSelectFreelancer={(id) => {
                setSelectedFreelancerIdForDetail(id);
                setCurrentPath(`/admin/freelancers/${id}`);
              }}
            />
          )}

          {userRole === 'admin' &&
            currentPath.startsWith('/admin/freelancers/') &&
            (selectedFreelancerIdForDetail || currentPath.split('/')[3]) && (
              <FreelancerDetailView
                freelancerId={selectedFreelancerIdForDetail || currentPath.split('/')[3]}
                onBack={() => handleNavigate('/admin/freelancers')}
                onSelectLead={(lead) => setSelectedLead(lead)}
              />
            )}

          {userRole === 'admin' && currentPath === '/admin/activities' && (
            <AuditLogView />
          )}

          {/* ================= AREA DE PROSPECCAO ================= */}
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
              onClearInitialFilters={() => {
                setLeadsNicheFilter(undefined);
                setLeadsStateFilter(undefined);
              }}
              onStartSpeedOutreach={() => handleNavigate('/outreach')}
              userRole={userRole}
              activeFreelancer={activeFreelancer}
              refreshTrigger={refreshTrigger}
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

          {userRole === 'admin' && currentPath === '/settings' && (
            <SettingsView onSettingsUpdated={loadInitialData} />
          )}
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
