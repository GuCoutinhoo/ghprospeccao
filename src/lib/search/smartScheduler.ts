import type { SearchArea } from '../../types';

/**
 * Adaptive, deterministic geographic scheduler.
 *
 * One sample from each priority city first. Then invest in areas where earlier
 * cells discovered truly new places / relevant leads. Revisit underexplored
 * cities and penalize repetitions; never mark an unvisited area as completed.
 * The result is a new array -- persisted search plans and leads are untouched.
 */
export function prioritizeSearchAreas(areas: SearchArea[]): SearchArea[] {
  const firstCities = [...new Set(areas.map(area => area.city))].slice(0, 16);
  const cityOrder = new Map<string, number>();
  const metrics = new Map<string, {count:number; matches:number; leads:number; unique:number; saturation:number}>();
  areas.forEach((area,index) => {
    if (!cityOrder.has(area.city)) cityOrder.set(area.city,index);
    if (area.status !== 'completed') return;
    const stat = metrics.get(area.city) || {count:0,matches:0,leads:0,unique:0,saturation:0};
    stat.count++;
    stat.matches += area.matching_filters || 0;
    stat.leads += area.new_leads || 0;
    stat.unique += area.new_places_found === undefined ? Math.min(20,area.places_found)/2 : area.new_places_found;
    if ((area.new_places_found ?? 20) <= 2 && (area.matching_filters || 0) === 0) stat.saturation++;
    metrics.set(area.city,stat);
  });

  function score(city: string): number {
    const priority = firstCities.includes(city);
    const stat = metrics.get(city);
    if (!stat) return (priority ? 70 : 22);
    const avgMatches = stat.matches / stat.count;
    const avgLeads = stat.leads / stat.count;
    const avgNew = stat.unique / stat.count;
    const varietyPenalty = Math.min(65, stat.count * 9);
    return (priority ? 28 : 0) + avgMatches * 32 + avgLeads * 42 +
      Math.min(20,avgNew * 1.2) - varietyPenalty - stat.saturation * 10;
  }

  return areas.filter(area => area.status === 'pending' || area.status === 'processing')
    .sort((a,b) => score(b.city) - score(a.city)
      || (cityOrder.get(a.city) || 0) - (cityOrder.get(b.city) || 0)
      || areas.indexOf(a) - areas.indexOf(b));
}
