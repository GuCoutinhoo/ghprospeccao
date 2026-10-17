import type { SearchJobFilters } from '../../types';

// A API do Google Places não filtra resultados por intervalo de nota.
// O filtro é aplicado antes de criar qualquer lead no workspace.
export function matchesRatingRange(
  ratingValue: number | undefined,
  filters: Pick<SearchJobFilters, 'minRating' | 'maxRating'>
): boolean {
  const minRating = filters.minRating || 0;
  const maxRating = filters.maxRating;
  if (minRating <= 0 && (maxRating === undefined || maxRating === null)) {
    return true;
  }
  const rating = Number(ratingValue);
  // Empresas sem nota não devem passar em buscas por intervalo de avaliações.
  if (!Number.isFinite(rating) || rating <= 0) {
    return false;
  }
  if (minRating > 0 && rating < minRating) {
    return false;
  }
  if (maxRating !== undefined && maxRating !== null && rating > maxRating) {
    return false;
  }
  return true;
}

export type RatingMode =
  | 'any'
  | 'around_3_5'
  | 'exact_3_5'
  | 'up_to_3_5'
  | 'min_3_0'
  | 'min_3_5'
  | 'min_4_0'
  | 'min_4_5'
  | 'custom';

export interface RatingPreset {
  id: RatingMode;
  label: string;
  badgeLabel?: string;
  description: string;
  minRating: number;
  maxRating?: number;
}

export const RATING_PRESETS: RatingPreset[] = [
  {
    id: 'any',
    label: 'Qualquer nota (0 a 5 estrelas)',
    badgeLabel: 'Qualquer nota',
    description: 'Sem restrição de avaliação: traz empresas com qualquer nota ou sem avaliação.',
    minRating: 0,
    maxRating: undefined,
  },
  {
    id: 'around_3_5',
    label: '⭐ Nota ~3,5 (Faixa 3,0 a 3,9 - Reputação a melhorar)',
    badgeLabel: 'Nota ~3,5 (3.0 a 3.9)',
    description: 'Estabelecimentos com nota em torno de 3,5 (3,0 a 3,9 estrelas). Excelente oportunidade para vender melhorias de reputação, atendimento e presença digital.',
    minRating: 3.0,
    maxRating: 3.9,
  },
  {
    id: 'exact_3_5',
    label: '🎯 Nota 3,5 exata (Apenas 3,5 estrelas)',
    badgeLabel: 'Nota 3,5 exata',
    description: 'Filtra estritamente empresas com avaliação 3,5 estrelas.',
    minRating: 3.5,
    maxRating: 3.5,
  },
  {
    id: 'up_to_3_5',
    label: '⚠️ Até 3,5 estrelas (Notas baixas / Críticas)',
    badgeLabel: 'Até 3,5 estrelas',
    description: 'Empresas com nota de até 3,5 estrelas no Google, indicando clientes insatisfeitos ou falta de gestão.',
    minRating: 0.1,
    maxRating: 3.5,
  },
  {
    id: 'min_3_0',
    label: '3,0 ou mais',
    badgeLabel: '3,0+',
    description: 'Empresas com nota a partir de 3,0 estrelas.',
    minRating: 3.0,
    maxRating: undefined,
  },
  {
    id: 'min_3_5',
    label: '3,5 ou mais',
    badgeLabel: '3,5+',
    description: 'Empresas com nota a partir de 3,5 estrelas.',
    minRating: 3.5,
    maxRating: undefined,
  },
  {
    id: 'min_4_0',
    label: '4,0 ou mais (Recomendado)',
    badgeLabel: '4,0+',
    description: 'Empresas bem avaliadas com 4,0 ou mais estrelas.',
    minRating: 4.0,
    maxRating: undefined,
  },
  {
    id: 'min_4_5',
    label: '4,5 ou mais (Alto padrão)',
    badgeLabel: '4,5+',
    description: 'Empresas com reputação de alto padrão (4,5 a 5,0 estrelas).',
    minRating: 4.5,
    maxRating: undefined,
  },
];

export function resolveRatingRange(mode: RatingMode | string): { minRating: number; maxRating?: number } {
  switch (mode) {
    case 'around_3_5':
      return { minRating: 3.0, maxRating: 3.9 };
    case 'exact_3_5':
      return { minRating: 3.5, maxRating: 3.5 };
    case 'up_to_3_5':
      return { minRating: 0.1, maxRating: 3.5 };
    case 'min_3_0':
      return { minRating: 3.0 };
    case 'min_3_5':
      return { minRating: 3.5 };
    case 'min_4_0':
      return { minRating: 4.0 };
    case 'min_4_5':
      return { minRating: 4.5 };
    default:
      return { minRating: 0 };
  }
}
