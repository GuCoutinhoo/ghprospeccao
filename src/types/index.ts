export type WebsiteStatus = 'no_website' | 'website_found' | 'not_verified' | 'invalid_website';

export type UserRole = 'admin' | 'freelancer';

export type FreelancerStatus = 'active' | 'blocked' | 'inactive';

export interface Freelancer {
  id: string; // e.g. "free_7F4K92XQ"
  name: string;
  email: string;
  access_code: string; // e.g. "7F4K92XQ"
  status: FreelancerStatus;
  notes?: string;
  pin?: string;
  created_at: string;
  updated_at: string;
  last_access_at?: string;
  last_activity_at?: string;
}

export type ActivityActionType =
  | 'login'
  | 'search_performed'
  | 'search_completed'
  | 'lead_opened'
  | 'lead_contacted'
  | 'contact_attempt'
  | 'status_changed'
  | 'response_registered'
  | 'follow_up_registered'
  | 'negotiation_started'
  | 'sale_registered'
  | 'freelancer_created'
  | 'freelancer_blocked'
  | 'freelancer_unblocked'
  | 'access_link_regenerated'
  | 'note_added';

export interface Activity {
  id: string;
  freelancer_id: string;
  freelancer_name?: string;
  action_type: ActivityActionType;
  description: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface FreelancerPerformance {
  freelancer: Freelancer;
  leadsFound: number;
  leadsContacted: number;
  contactAttempts: number;
  responses: number;
  followUps: number;
  negotiations: number;
  sales: number;
  responseRate: number; // percentage
  conversionRate: number; // percentage
  searchesCount: number;
  activeDays: number;
  lastActivity?: string;
  lastAccess?: string;
  leadsPerDay: { date: string; count: number }[];
  contactsPerDay: { date: string; count: number }[];
}

export interface AdminDashboardStats {
  totalFreelancers: number;
  activeFreelancers: number;
  blockedFreelancers: number;
  totalSearches: number;
  totalLeadsFound: number;
  totalLeadsContacted: number;
  totalResponses: number;
  totalFollowUps: number;
  totalNegotiations: number;
  totalSales: number;
  totalSalesValue?: number;
  overallResponseRate: number;
  overallConversionRate: number;
  recentActivities: Activity[];
  mostActiveFreelancers: FreelancerPerformance[];
  bestPerformingFreelancers: FreelancerPerformance[];
}

export type PipelineStatus = 
  | 'NOVO'
  | 'PRÉVIA CRIADA'
  | 'CONTATADO'
  | 'RESPONDEU'
  | 'INTERESSADO'
  | 'FOLLOW_UP'
  | 'NEGOCIACAO'
  | 'REUNIÃO'
  | 'PROPOSTA'
  | 'FECHADO'
  | 'PERDIDO'
  | 'NAO_INTERESSADO'
  | 'SEM_RESPOSTA';

export type SearchJobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface Place {
  id: string;
  place_id: string;
  name: string;
  formatted_address: string;
  city: string;
  state: string;
  postal_code?: string;
  lat: number;
  lng: number;
  phone?: string;
  website?: string;
  website_status: WebsiteStatus;
  rating?: number;
  reviews_count?: number;
  maps_url?: string;
  business_status?: string;
  raw_types?: string[];
  created_at: string;
  updated_at: string;
  last_fetched_at: string;
}

export interface Lead {
  id: string;
  user_id: string;
  freelancer_id?: string;
  freelancer_name?: string;
  place_id: string;
  name: string;
  niche: string;
  state: string;
  city: string;
  address?: string;
  phone?: string;
  website?: string;
  website_status: WebsiteStatus;
  maps_url?: string;
  rating: number;
  reviews_count: number;
  lead_score: number;
  pipeline_status: PipelineStatus;
  is_favorite?: boolean;
  notes?: string;
  contact_attempts_count?: number;
  sale_value?: number;
  sale_date?: string;
  contacted_at?: string;
  response_at?: string;
  follow_up_at?: string;
  negotiation_at?: string;
  created_at: string;
  updated_at: string;
}

export interface LeadNote {
  id: string;
  lead_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export interface SearchJobFilters {
  onlyWithoutWebsite: boolean;
  onlyWithPhone: boolean;
  minRating: number;
  minReviews: number;
  maxReviews?: number;
  targetLeads?: number; // 0 ou undefined = sem limite
}

export interface SearchJob {
  id: string;
  user_id: string;
  freelancer_id?: string;
  freelancer_name?: string;
  state: string;
  city: string; // 'all' or specific city name
  niche: string;
  status: SearchJobStatus;
  filters: SearchJobFilters;
  target_leads?: number;
  total_cities: number;
  processed_cities: number;
  total_search_areas: number;
  processed_search_areas: number;
  places_found: number;
  places_without_website: number;
  leads_created: number;
  error_message?: string;
  started_at?: string;
  finished_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SearchArea {
  id: string;
  search_job_id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  radius: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  places_found: number;
  processed_at?: string;
  error?: string;
}

export interface SearchQueryLog {
  id: string;
  search_job_id: string;
  search_area_id?: string;
  query: string;
  status: 'success' | 'quota_exceeded' | 'error' | 'skipped';
  results_count: number;
  created_at: string;
  duration_ms: number;
  error_details?: string;
}

export interface IBGEState {
  id: number;
  sigla: string;
  nome: string;
}

export interface IBGECity {
  id: number;
  nome: string;
  microrregiao?: {
    id: number;
    nome: string;
  };
}

export interface LeadScoreBreakdown {
  score: number;
  tier: 'Baixa prioridade' | 'Boa oportunidade' | 'Alta oportunidade';
  reasons: {
    label: string;
    points: number;
    applied: boolean;
  }[];
}

export interface DashboardStats {
  totalLeads: number;
  newLeads: number;
  contactedLeads: number;
  interestedLeads: number;
  closedLeads: number;
  noWebsiteLeads: number;
  withPhoneLeads: number;
  responseRate: number; // percentage
  closingRate: number; // percentage
  leadsByDay: { date: string; count: number }[];
  leadsByNiche: { niche: string; count: number }[];
  leadsByState: { state: string; count: number }[];
  pipelineDistribution: { status: PipelineStatus; count: number }[];
  topOpportunities: Lead[];
}

export interface AppSettings {
  googleMapsApiKey: string;
  hasCustomKey: boolean;
  maskedKey?: string;
  maxResultsPerJob: number;
  maxCitiesPerJob: number;
  requestDelayMs: number;
  scoringWeights: {
    noWebsite: number;
    withPhone: number;
    highRating: number; // >= 4.5
    reviewsOver50: number;
    reviewsOver200: number;
    activeProfile: number;
  };
}
