export const normalizeStr = (s?: string | null) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const groups = [
  { key: 'odontologia', terms: ['odontologia','odontologica','odontologicas','odontologico','dentista','dentistas','dental','odonto'], types: ['dentist','dental_clinic'] },
  { key: 'barbearia', terms: ['barbearia','barbearias','barbeiro','barber'], types: ['barber_shop'] },
  { key: 'restaurante', terms: ['restaurante','restaurantes','pizzaria','hamburgueria','churrascaria'], types: ['restaurant','pizza_restaurant','hamburger_restaurant'] },
  { key: 'academia', terms: ['academia','academias','fitness','crossfit'], types: ['gym','fitness_center'] },
  { key: 'advocacia', terms: ['advocacia','advogado','advogados'], types: ['lawyer'] },
  { key: 'contabilidade', terms: ['contabilidade','contador','contadores'], types: ['accounting'] },
  { key: 'mecanica', terms: ['mecanica','mecanicas','oficina','oficinas'], types: ['car_repair'] },
  { key: 'imobiliaria', terms: ['imobiliaria','imobiliarias','corretor'], types: ['real_estate_agency'] },
  { key: 'pet', terms: ['pet','veterinario','veterinaria'], types: ['pet_store','veterinary_care'] },
  { key: 'estetica', terms: ['estetica','estetico','beleza','manicure'], types: ['skin_care_clinic','beauty_salon','spa'] },
  { key: 'eletricista', terms: ['eletricista','eletricistas'], types: ['electrician'] },
];
const words = (s: string) => normalizeStr(s).split(' ');
const group = (s: string) => groups.find(g => g.terms.some(t => words(s).includes(t)) || g.types.some(t => normalizeStr(s) === normalizeStr(t)));
export const nicheKey = (s: string) => group(s)?.key || normalizeStr(s);
export function matchesNicheSemantics(text: string, niche: string): boolean {
  if (!text || !niche) return false;
  const g = group(niche);
  if (g) return g.terms.some(t => words(text).includes(t)) || g.types.some(t => normalizeStr(text) === normalizeStr(t));
  const tokens = words(niche).filter(w => w.length > 2 && !['clinica','clinicas','servico','servicos','para','com','de','em'].includes(w));
  return tokens.length > 0 && tokens.every(w => words(text).includes(w));
}
export function isPlaceRelevantToNiche(place: {name?: string; raw_types?: string[]}, niche: string): boolean {
  const g = group(niche);
  const types = place.raw_types || [];
  // A conflicting specific category takes precedence over words in a business name.
  if (g && groups.some(other => other !== g && types.some(t => other.types.includes(t)))) return false;
  // Clínicas de estética são diferentes de salões de beleza e de odontologia.
  // A classificação "beauty_salon" isolada é ampla demais para aceitar como clínica.
  if (g?.key === 'estetica' && normalizeStr(niche).includes('clinica')) {
    if (types.includes('skin_care_clinic')) return true;
    return types.some(t => ['spa','beauty_salon','medical_clinic'].includes(t)) &&
      matchesNicheSemantics(place.name || '', niche);
  }
  if (g && types.some(t => g.types.includes(t))) return true;
  return matchesNicheSemantics(place.name || '', niche) || types.some(t => matchesNicheSemantics(t, niche));
}
