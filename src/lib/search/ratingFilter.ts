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
