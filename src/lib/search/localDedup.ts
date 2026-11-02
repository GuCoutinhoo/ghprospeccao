/**
 * Conservative identity matching for TEST's browser-only prospecting.
 * Never mutates, hides or rewrites any previously collected lead.
 */
export type ProspectIdentity = {
  id?: string;
  place_id?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
};

function cleanText(value?: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\bavenida\b/g, 'av')
    .replace(/\brua\b/g, 'r')
    .replace(/\btravessa\b/g, 'tv')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanPhone(value?: string): string {
  const digits = (value || '').replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  return local.length >= 10 && local.length <= 11 ? local : '';
}

export function prospectIdentityKeys(place: ProspectIdentity): string[] {
  const keys: string[] = [];
  for (const id of [place.place_id, place.id]) {
    const clean = (id || '').trim();
    if (clean && clean.length <= 200) keys.push('id:' + clean);
  }
  const name = cleanText(place.name);
  const city = cleanText(place.city);
  const state = cleanText(place.state);
  const address = cleanText(place.address);
  const phone = cleanPhone(place.phone);
  // Require enough information to avoid merging unrelated branches/companies
  // that happen to have a shared phone or similar trading names.
  if (name.length >= 3 && city && state && address.length >= 8) {
    keys.push('place:' + state + ':' + city + ':' + name + ':' + address);
  }
  if (name.length >= 3 && city && state && phone) {
    keys.push('phone:' + state + ':' + city + ':' + name + ':' + phone);
  }
  return [...new Set(keys)];
}

export function isAlreadyCollected(place: ProspectIdentity, previousKeys: ReadonlySet<string>): boolean {
  return prospectIdentityKeys(place).some(key => previousKeys.has(key));
}

export function addCollectedIdentity(place: ProspectIdentity, previousKeys: Set<string>): void {
  for (const key of prospectIdentityKeys(place)) previousKeys.add(key);
}
