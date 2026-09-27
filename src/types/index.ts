export type WebsiteStatus = 'no_website' | 'website_found' | 'not_verified' | 'invalid_website';

export type PipelineStatus = 
  | 'NOVO'
  | 'PRÉVIA CRIADA'
  | 'CONTATADO'
  | 'RESPONDEU'
  | 'INTERESSADO'
  | 'REUNIÃO'
  | 'PROPOSTA'
  | 'FECHADO'
  | 'PERDIDO';

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
  created_at: string;
  updated_at: string;
  contacted_at?: string;
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
}

export interface SearchJob {
  id: string;
  user_id: string;
  state: string;
  city: string; // 'all' or specific city name
  niche: string;
  status: SearchJobStatus;
  filters: SearchJobFilters;
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
