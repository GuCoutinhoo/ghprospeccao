import { LeadScoreBreakdown, Place, AppSettings } from '../../types';

export const DEFAULT_SCORING_WEIGHTS = {
  noWebsite: 30,
  withPhone: 20,
  highRating: 10, // rating >= 4.5
  reviewsOver50: 15,
  reviewsOver200: 15,
  activeProfile: 10,
};

export function calculateLeadScore(
  place: Partial<Place>,
  customWeights?: Partial<typeof DEFAULT_SCORING_WEIGHTS>
): LeadScoreBreakdown {
  const weights = { ...DEFAULT_SCORING_WEIGHTS, ...customWeights };

  const isNoWebsite = (!place.website || place.website.trim() === '') && (place.website_status === 'no_website' || !place.website_status);
  const hasPhone = Boolean(place.phone && place.phone.trim().length >= 8);
  const rating = Number(place.rating || 0);
  const isHighRating = rating >= 4.5;
  const reviewsCount = Number(place.reviews_count || 0);
  const isOver50Reviews = reviewsCount >= 50;
  const isOver200Reviews = reviewsCount >= 200;
  const isActiveProfile = !place.business_status || place.business_status === 'OPERATIONAL';

  const reasons = [
    {
      label: 'Sem site cadastrado',
      points: weights.noWebsite,
      applied: isNoWebsite,
    },
    {
      label: 'Telefone disponível para contato',
      points: weights.withPhone,
      applied: hasPhone,
    },
    {
      label: 'Avaliação excelente (>= 4.5 estrelas)',
      points: weights.highRating,
      applied: isHighRating,
    },
    {
      label: 'Mais de 50 avaliações de clientes',
      points: weights.reviewsOver50,
      applied: isOver50Reviews,
    },
    {
      label: 'Alta autoridade local (mais de 200 avaliações)',
      points: weights.reviewsOver200,
      applied: isOver200Reviews,
    },
    {
      label: 'Perfil ativo e operacional no Google',
      points: weights.activeProfile,
      applied: isActiveProfile,
    },
  ];

  let rawTotal = 0;
  for (const r of reasons) {
    if (r.applied) {
      rawTotal += r.points;
    }
  }

  // Cap at 100
  const score = Math.min(100, Math.max(0, rawTotal));

  let tier: 'Baixa prioridade' | 'Boa oportunidade' | 'Alta oportunidade';
  if (score >= 70) {
    tier = 'Alta oportunidade';
  } else if (score >= 40) {
    tier = 'Boa oportunidade';
  } else {
    tier = 'Baixa prioridade';
  }

  return {
    score,
    tier,
    reasons,
  };
}

export function getScoreColorClass(score: number): {
  badgeBg: string;
  badgeText: string;
  barColor: string;
} {
  if (score >= 70) {
    return {
      badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      badgeText: 'text-emerald-700',
      barColor: 'bg-emerald-600',
    };
  }
  if (score >= 40) {
    return {
      badgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
      badgeText: 'text-amber-700',
      barColor: 'bg-amber-500',
    };
  }
  return {
    badgeBg: 'bg-neutral-100 text-neutral-600 border-neutral-200',
    badgeText: 'text-neutral-600',
    barColor: 'bg-neutral-400',
  };
}
