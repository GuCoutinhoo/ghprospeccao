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
import { api, getActiveFreelancerSession, invalidateLeadsCache } from './lib/api';
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

interface SessionBootstrap {
  initialRole: UserRole;
  initialFreelancerCode: string;
  initialPath: string;
  authMode: 'admin' | 'freelancer';
}

function getInitialSessionContext(): SessionBootstrap {
  if (typeof window === 'undefined') {
    return {
      initialRole: 'admin',
      initialFreelancerCode: '',
      initialPath: '/dashboard',
      authMode: 'admin',
    };
  }

  const pathname = window.location.pathname;
  const hash = window.location.hash;
  const search = window.location.search;

  const systemRoutes = ['admin', 'dashboard', 'leads', 'search', 'outreach', 'pipeline', 'templates', 'favorites', 'settings', 'preview', 'api', 'login', 'audit'];
  const firstSegment = pathname.replace(/^\//, '').split('/')[0].split('?')[0].split('#')[0].trim().toLowerCase();

  let rawCode = '';
  if (pathname.startsWith('/f/')) {
    rawCode = pathname.replace(/^\/f\//, '').split('/')[0].split('?')[0].split('#')[0].trim();
  } else if (hash.startsWith('#/f/')) {
    rawCode = hash.replace(/^#\/f\//, '').split('/')[0].split('?')[0].trim();
  } else if (search.includes('f=')) {
    const params = new URLSearchParams(search);
    rawCode = (params.get('f') || '').trim();
  } else if (firstSegment && !systemRoutes.includes(firstSegment)) {
    rawCode = firstSegment;
  }

  const cleanCode = rawCode.toLowerCase();

  // Se o código for 'admin' ou 'administrador'
  if (cleanCode === 'admin' || cleanCode === 'administrador') {
    return {
      initialRole: 'admin',
      initialFreelancerCode: '',
      initialPath: '/admin',
      authMode: 'admin',
    };
  }

  // Se for código de freelancer
  if (cleanCode) {
    return {
      initialRole: 'freelancer',
      initialFreelancerCode: cleanCode,
      initialPath: '/leads',
      authMode: 'freelancer',
    };
  }

  // Se já há sessão de freelancer armazenada e não está acessando /admin
  const freeSession = getActiveFreelancerSession();
  if (freeSession?.token && !pathname.startsWith('/admin')) {
    return {
      initialRole: 'freelancer',
      initialFreelancerCode: freeSession.freelancer?.access_code || '',
      initialPath: pathname === '/' || pathname.startsWith('/f/') || pathname === '/dashboard' ? '/leads' : pathname,
      authMode: 'freelancer',
    };
  }

  // Rota administrativa ou padrão
  let initialPath = '/dashboard';
  if (pathname.startsWith('/admin')) initialPath = pathname;
  else if (['/leads', '/search', '/outreach', '/pipeline', '/templates', '/favorites', '/settings'].includes(pathname)) {
    initialPath = pathname;
  }

  return {
    initialRole: 'admin',
    initialFreelancerCode: '',
    initialPath,
    authMode: pathname.startsWith('/f') ? 'freelancer' : 'admin',
  };
}

export default function App() {
  const [bootstrap] = useState(getInitialSessionContext);

  const [userRole, setUserRole] = useState<UserRole>(bootstrap.initialRole);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  const [authMode, setAuthMode] = useState<'admin' | 'freelancer'>(bootstrap.authMode);
  const [freelancerCodeToVerify, setFreelancerCodeToVerify] = useState<string>(bootstrap.initialFreelancerCode);
  const [freelancerLinkError, setFreelancerLinkError] = useState<string | null>(null);

  const [adminUser, setAdminUser] = useState<{ email: string; name: string } | null>(null);
  const [activeFreelancer, setActiveFreelancer] = useState<Freelancer | null>(null);

  // Navegação
  const [currentPath, setCurrentPath] = useState<string>(bootstrap.initialPath);
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

  // 1. Verificação de sessão criptográfica e autenticação rigorosa no servidor
  useEffect(() => {
    let isCancelled = false;

    async function checkAuth() {
      setIsAuthChecking(true);

      // Limpeza de tokens legados inseguros
      if (typeof window !== 'undefined') {
        const storedAdminToken = localStorage.getItem('gh_admin_token');
        if (storedAdminToken === 'admin_master_session_token') {
          localStorage.removeItem('gh_admin_token');
          localStorage.removeItem('gh_admin_user');
        }
      }

      // Caso A: O usuário abriu com código de freelancer no link (ex: /f/andre ou /andre)
      if (bootstrap.initialFreelancerCode) {
        try {
          const res = await api.verifyFreelancerLink(bootstrap.initialFreelancerCode);
          if (isCancelled) return;
          if (res?.freelancer && res?.token) {
            setActiveFreelancer(res.freelancer);
            setUserRole('freelancer');
            setIsAuthenticated(true);
            setCurrentPath('/leads');
            setIsAuthChecking(false);
            return;
          }
        } catch (err: unknown) {
          if (isCancelled) return;
          console.warn('[App] Falha ao autenticar link de freelancer:', err);
          setFreelancerLinkError(err instanceof Error ? err.message : 'Não foi possível validar este workspace.');
          setIsAuthenticated(false);
          setAuthMode('freelancer');
          setIsAuthChecking(false);
          return;
        }
      }

      // Caso B: Verificação de token de Admin armazenado
      const adminToken = typeof window !== 'undefined' ? localStorage.getItem('gh_admin_token') : null;
      if (adminToken && adminToken.includes('.')) {
        try {
          const data = await api.adminGetMe();
          if (isCancelled) return;
          if (data?.user) {
            setAdminUser({ email: data.user.email || 'gustavohcsantos.mm2020@gmail.com', name: data.user.name || 'Gustavo Santos' });
            setUserRole('admin');
            setActiveFreelancer(null);
            setIsAuthenticated(true);
            setIsAuthChecking(false);
            return;
          }
        } catch {
          if (isCancelled) return;
          localStorage.removeItem('gh_admin_token');
          localStorage.removeItem('gh_admin_user');
        }
      }

      // Caso C: Verificação de token de Freelancer armazenado
      const freelancerToken = typeof window !== 'undefined' ? localStorage.getItem('gh_freelancer_token') : null;
      if (freelancerToken && freelancerToken.includes('.')) {
        try {
          const data = await api.getFreelancerMe();
          if (isCancelled) return;
          if (data?.freelancer) {
            setActiveFreelancer(data.freelancer);
            setUserRole('freelancer');
            setAdminUser(null);
            setIsAuthenticated(true);
            setIsAuthChecking(false);
            return;
          }
        } catch {
          if (isCancelled) return;
          localStorage.removeItem('gh_freelancer_token');
          localStorage.removeItem('gh_freelancer_session');
        }
      }

      // Caso D: Nenhuma sessão válida encontrada no servidor
      if (!isCancelled) {
        setIsAuthenticated(false);
        setIsAuthChecking(false);
      }
    }

    checkAuth();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Serverless-safe search driver. One awaited cell per request, persisted in
  // Supabase, so reload/navigation does not lose completed progress.
  useEffect(() => {
    if (!isAuthenticated) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let index = 0;
    const drive = async () => {
      let hasWork = false;
      try {
        const jobs = await api.getSearchJobs();
        if (stopped) return;
        const active = jobs.filter(j => j.status === 'pending' || j.status === 'running');
        hasWork = active.length > 0;
        if (hasWork) {
          const next = active[index % active.length];
          index++;
          await api.stepSearchJob(next.id);
        }
      } catch (err) {
        if (!stopped) console.warn('[SearchDriver] Falha transitória ao processar lote:', err);
      } finally {
        if (!stopped) timer = setTimeout(drive, hasWork ? 1200 : 5000);
      }
    };
    void drive();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [isAuthenticated, userRole, activeFreelancer?.id]);

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

  // 3. Carregar dados do dashboard quando autenticado
  useEffect(() => {
    if (isAuthenticated) {
      loadInitialData();
    }
  }, [userRole, isAuthenticated]);

  const loadInitialData = async () => {
    setIsRefreshing(true);
    try {
      const isFreelancer = userRole === 'freelancer';
      const fid = isFreelancer
        ? (activeFreelancer?.id || (activeFreelancer?.access_code ? `free_${activeFreelancer.access_code}` : undefined))
        : undefined;

      const [s, set] = await Promise.all([
        api.getDashboardStats(fid).catch((e) => {
          console.warn('[App] Erro ao carregar stats da API:', e);
          return null;
        }),
        !isFreelancer
          ? api.getSettings().catch((e) => {
              console.warn('[App] Erro ao carregar settings da API:', e);
              return null;
            })
          : Promise.resolve(null),
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
      if (userRole === 'admin') {
        await api.syncSupabase().catch((e) => console.warn('[App] Verificação do Supabase falhou:', e));
      }
      await loadInitialData();
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error('Falha ao atualizar dados:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleNavigate = (path: string) => {
    // Bloqueia tentativas de freelancer acessar rotas administrativas
    if (userRole === 'freelancer' && (path.startsWith('/admin') || path === '/settings')) {
      setCurrentPath('/leads');
      return;
    }

    setCurrentPath(path);
    if (!path.startsWith('/search/')) {
      setActiveSearchJobId(null);
    }
    if (!path.startsWith('/admin/freelancers/')) {
      setSelectedFreelancerIdForDetail(null);
    }
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

  const handleLogout = async () => {
    if (userRole === 'freelancer') {
      await api.freelancerLogout();
      setActiveFreelancer(null);
      setIsAuthenticated(false);
      setAuthMode('freelancer');
      setCurrentPath('/leads');
    } else {
      await api.adminLogout();
      setAdminUser(null);
      setIsAuthenticated(false);
      setAuthMode('admin');
      setCurrentPath('/dashboard');
    }
  };

  const handleSwitchToAdmin = (admin: { name: string; email: string }) => {
    setAdminUser(admin);
    setUserRole('admin');
    setActiveFreelancer(null);
    setIsAuthenticated(true);
    setAuthMode('admin');
    setCurrentPath('/admin');

    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
      window.history.pushState(null, '', '/admin');
    }

    invalidateLeadsCache();
    loadInitialData();
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

  if (!isAuthenticated) {
    if (isAuthChecking) {
      return (
        <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-6">
          <div className="h-8 w-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mb-3" />
          <span className="text-xs font-medium text-neutral-400">
            {bootstrap.initialFreelancerCode ? 'Carregando workspace do freelancer...' : 'Verificando sessão segura...'}
          </span>
        </div>
      );
    }

    if (authMode === 'freelancer') {
      return (
        <FreelancerAccessView
          initialCode={freelancerCodeToVerify}
          initialError={freelancerLinkError}
          onWorkspaceReady={(freelancer) => {
            setActiveFreelancer(freelancer);
            setUserRole('freelancer');
            setAdminUser(null);
            setIsAuthenticated(true);
            setCurrentPath('/leads');
            loadInitialData();
          }}
          onGoToAdminLogin={() => {
            setAuthMode('admin');
            if (window.history && window.history.pushState) {
              window.history.pushState({}, '', '/admin');
            }
          }}
        />
      );
    }

    return (
      <LoginView
        onLoginSuccess={(user) => {
          setAdminUser({ email: user.email, name: user.name });
          setUserRole('admin');
          setActiveFreelancer(null);
          setIsAuthenticated(true);
          setCurrentPath(currentPath.startsWith('/admin') ? currentPath : '/dashboard');
          loadInitialData();
        }}
        onGoToFreelancerAccess={() => {
          setAuthMode('freelancer');
          if (window.history && window.history.pushState) {
            window.history.pushState({}, '', '/f');
          }
        }}
      />
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
        onSwitchToAdmin={handleSwitchToAdmin}
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
              userRole={userRole}
              activeFreelancer={activeFreelancer}
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
              onNavigateToSearch={() => handleNavigate('/search')}
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
              onNavigateToLeads={() => handleNavigate('/leads')}
              onNavigateToSearch={() => handleNavigate('/search')}
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
          onDeleteLead={() => {
            setSelectedLead(null);
            setRefreshTrigger((prev) => prev + 1);
            loadInitialData();
          }}
        />
      )}
    </div>
  );
}
