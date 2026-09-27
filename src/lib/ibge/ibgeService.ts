import { IBGEState, IBGECity } from '../../types';

export const BRAZILIAN_STATES: IBGEState[] = [
  { id: 12, sigla: 'AC', nome: 'Acre' },
  { id: 27, sigla: 'AL', nome: 'Alagoas' },
  { id: 16, sigla: 'AP', nome: 'Amapá' },
  { id: 13, sigla: 'AM', nome: 'Amazonas' },
  { id: 29, sigla: 'BA', nome: 'Bahia' },
  { id: 23, sigla: 'CE', nome: 'Ceará' },
  { id: 53, sigla: 'DF', nome: 'Distrito Federal' },
  { id: 32, sigla: 'ES', nome: 'Espírito Santo' },
  { id: 52, sigla: 'GO', nome: 'Goiás' },
  { id: 21, sigla: 'MA', nome: 'Maranhão' },
  { id: 51, sigla: 'MT', nome: 'Mato Grosso' },
  { id: 50, sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { id: 31, sigla: 'MG', nome: 'Minas Gerais' },
  { id: 15, sigla: 'PA', nome: 'Pará' },
  { id: 25, sigla: 'PB', nome: 'Paraíba' },
  { id: 41, sigla: 'PR', nome: 'Paraná' },
  { id: 26, sigla: 'PE', nome: 'Pernambuco' },
  { id: 22, sigla: 'PI', nome: 'Piauí' },
  { id: 33, sigla: 'RJ', nome: 'Rio de Janeiro' },
  { id: 24, sigla: 'RN', nome: 'Rio Grande do Norte' },
  { id: 43, sigla: 'RS', nome: 'Rio Grande do Sul' },
  { id: 11, sigla: 'RO', nome: 'Rondônia' },
  { id: 14, sigla: 'RR', nome: 'Roraima' },
  { id: 42, sigla: 'SC', nome: 'Santa Catarina' },
  { id: 35, sigla: 'SP', nome: 'São Paulo' },
  { id: 28, sigla: 'SE', nome: 'Sergipe' },
  { id: 17, sigla: 'TO', nome: 'Tocantins' },
];

// Fallback das principais cidades para quando o IBGE demorar ou estiver indisponível
export const POPULAR_CITIES_BY_STATE: Record<string, string[]> = {
  SP: ['São Paulo', 'Campinas', 'Guarulhos', 'São Bernardo do Campo', 'Santo André', 'Osasco', 'Ribeirão Preto', 'Sorocaba', 'Santos', 'São José dos Campos', 'Jundiaí', 'Piracicaba', 'Bauru', 'Franca'],
  RJ: ['Rio de Janeiro', 'São Gonçalo', 'Duque de Caxias', 'Nova Iguaçu', 'Niterói', 'Belford Roxo', 'Campos dos Goytacazes', 'Petrópolis', 'Volta Redonda', 'Cabo Frio'],
  MG: ['Belo Horizonte', 'Uberlândia', 'Contagem', 'Juiz de Fora', 'Betim', 'Montes Claros', 'Ribeirão das Neves', 'Uberaba', 'Governador Valadares', 'Ipatinga'],
  PR: ['Curitiba', 'Londrina', 'Maringá', 'Ponta Grossa', 'Cascavel', 'São José dos Pinhais', 'Foz do Iguaçu', 'Colombo', 'Guarapuava'],
  RS: ['Porto Alegre', 'Caxias do Sul', 'Canoas', 'Pelotas', 'Santa Maria', 'Gravataí', 'Viamão', 'Novo Hamburgo', 'São Leopoldo'],
  SC: ['Florianópolis', 'Joinville', 'Blumenau', 'São José', 'Chapecó', 'Itajaí', 'Criciúma', 'Jaraguá do Sul', 'Palhoça', 'Balneário Camboriú'],
  BA: ['Salvador', 'Feira de Santana', 'Vitória da Conquista', 'Camaçari', 'Juazeiro', 'Itabuna', 'Lauro de Freitas', 'Ilhéus'],
  PE: ['Recife', 'Jaboatão dos Guararapes', 'Olinda', 'Caruaru', 'Petrolina', 'Paulista', 'Cabo de Santo Agostinho'],
  CE: ['Fortaleza', 'Caucaia', 'Juazeiro do Norte', 'Maracanaú', 'Sobral', 'Crato', 'Itapipoca'],
  GO: ['Goiânia', 'Aparecida de Goiânia', 'Anápolis', 'Rio Verde', 'Águas Lindas de Goiás', 'Luziânia', 'Valparaíso de Goiás'],
  ES: ['Vitória', 'Vila Velha', 'Serra', 'Cariacica', 'Cachoeiro de Itapemirim', 'Linhares', 'São Mateus', 'Colatina'],
  DF: ['Brasília', 'Taguatinga', 'Ceilândia', 'Águas Claras', 'Samambaia', 'Plano Piloto'],
  AM: ['Manaus', 'Parintins', 'Itacoatiara', 'Manacapuru', 'Coari'],
  PA: ['Belém', 'Ananindeua', 'Santarém', 'Marabá', 'Parauapebas', 'Castanhal'],
  MT: ['Cuiabá', 'Várzea Grande', 'Rondonópolis', 'Sinop', 'Tangará da Serra'],
  MS: ['Campo Grande', 'Dourados', 'Três Lagoas', 'Corumbá', 'Ponta Porã'],
  RN: ['Natal', 'Mossoró', 'Parnamirim', 'São Gonçalo do Amarante'],
  PB: ['João Pessoa', 'Campina Grande', 'Santa Rita', 'Patos', 'Bayeux'],
  AL: ['Maceió', 'Arapiraca', 'Rio Largo', 'Palmeira dos Índios'],
  MA: ['São Luís', 'Imperatriz', 'São José de Ribamar', 'Timon', 'Caxias'],
  PI: ['Teresina', 'Parnaíba', 'Picos', 'Piripiri', 'Floriano'],
  SE: ['Aracaju', 'Nossa Senhora do Socorro', 'Lagarto', 'Itabaiana', 'São Cristóvão'],
  RO: ['Porto Velho', 'Ji-Paraná', 'Ariquemes', 'Vilhena', 'Cacoal'],
  TO: ['Palmas', 'Araguaína', 'Gurupi', 'Porto Nacional'],
  AC: ['Rio Branco', 'Cruzeiro do Sul', 'Sena Madureira'],
  AP: ['Macapá', 'Santana', 'Laranjal do Jari'],
  RR: ['Boa Vista', 'Rorainópolis', 'Caracaraí'],
};

// Coordenadas aproximadas do centro das principais capitais e cidades
export const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  'São Paulo': { lat: -23.5505, lng: -46.6333 },
  'Campinas': { lat: -22.9056, lng: -47.0608 },
  'Santos': { lat: -23.9608, lng: -46.3336 },
  'Sorocaba': { lat: -23.5015, lng: -47.4526 },
  'Ribeirão Preto': { lat: -21.1767, lng: -47.8108 },
  'São José dos Campos': { lat: -23.1791, lng: -45.8872 },
  'Rio de Janeiro': { lat: -22.9068, lng: -43.1729 },
  'Niterói': { lat: -22.8833, lng: -43.1039 },
  'Belo Horizonte': { lat: -19.9167, lng: -43.9345 },
  'Curitiba': { lat: -25.4284, lng: -49.2733 },
  'Porto Alegre': { lat: -30.0346, lng: -51.2177 },
  'Florianópolis': { lat: -27.5954, lng: -48.5480 },
  'Salvador': { lat: -12.9714, lng: -38.5014 },
  'Recife': { lat: -8.0476, lng: -34.8770 },
  'Fortaleza': { lat: -3.7172, lng: -38.5433 },
  'Brasília': { lat: -15.7975, lng: -47.8919 },
  'Goiânia': { lat: -16.6869, lng: -49.2648 },
  'Vitória': { lat: -20.3155, lng: -40.3128 },
  'Cuiabá': { lat: -15.6014, lng: -56.0979 },
  'Campo Grande': { lat: -20.4697, lng: -54.6201 },
  'Manaus': { lat: -3.1190, lng: -60.0217 },
  'Belém': { lat: -1.4558, lng: -48.4902 },
  'Natal': { lat: -5.7945, lng: -35.2110 },
  'João Pessoa': { lat: -7.1195, lng: -34.8450 },
  'Maceió': { lat: -9.6658, lng: -35.7353 },
  'São Luís': { lat: -2.5307, lng: -44.3068 },
  'Teresina': { lat: -5.0920, lng: -42.8038 },
  'Aracaju': { lat: -10.9472, lng: -37.0731 },
  'Porto Velho': { lat: -8.7619, lng: -63.9039 },
  'Palmas': { lat: -10.2491, lng: -48.3243 },
  'Rio Branco': { lat: -9.9754, lng: -67.8249 },
  'Macapá': { lat: 0.0356, lng: -51.0705 },
  'Boa Vista': { lat: 2.8235, lng: -60.6758 },
};

// Subdivisões geográficas para cidades grandes (grid por bairros/regiões)
export const METROPOLITAN_GRIDS: Record<string, { name: string; lat: number; lng: number; radius: number }[]> = {
  'São Paulo': [
    { name: 'São Paulo - Centro / República / Sé', lat: -23.5475, lng: -46.6361, radius: 4000 },
    { name: 'São Paulo - Paulista / Jardins / Bela Vista', lat: -23.5615, lng: -46.6559, radius: 4000 },
    { name: 'São Paulo - Pinheiros / Vila Madalena', lat: -23.5673, lng: -46.7020, radius: 4500 },
    { name: 'São Paulo - Moema / Vila Mariana / Ibirapuera', lat: -23.6022, lng: -46.6622, radius: 4500 },
    { name: 'São Paulo - Itaim Bibi / Vila Olímpia / Morumbi', lat: -23.5936, lng: -46.6855, radius: 5000 },
    { name: 'São Paulo - Tatuapé / Mooca / Anália Franco', lat: -23.5401, lng: -46.5772, radius: 5000 },
    { name: 'São Paulo - Santana / Tucuruvi (Zona Norte)', lat: -23.5042, lng: -46.6264, radius: 6000 },
    { name: 'São Paulo - Santo Amaro / Interlagos (Zona Sul)', lat: -23.6534, lng: -46.7088, radius: 6500 },
    { name: 'São Paulo - Lapa / Perdizes / Pompéia (Zona Oeste)', lat: -23.5287, lng: -46.6851, radius: 4500 },
    { name: 'São Paulo - Penha / Itaquera (Zona Leste)', lat: -23.5350, lng: -46.4710, radius: 7000 },
  ],
  'Rio de Janeiro': [
    { name: 'Rio de Janeiro - Centro / Lapa', lat: -22.9068, lng: -43.1729, radius: 4000 },
    { name: 'Rio de Janeiro - Copacabana / Ipanema / Leblon', lat: -22.9711, lng: -43.1822, radius: 4500 },
    { name: 'Rio de Janeiro - Botafogo / Flamengo / Tijuca', lat: -22.9519, lng: -43.1843, radius: 5000 },
    { name: 'Rio de Janeiro - Barra da Tijuca / Recreio', lat: -23.0003, lng: -43.3659, radius: 7500 },
    { name: 'Rio de Janeiro - Méier / Madureira (Zona Norte)', lat: -22.8920, lng: -43.2790, radius: 6000 },
  ],
  'Belo Horizonte': [
    { name: 'Belo Horizonte - Centro / Savassi / Lourdes', lat: -19.9324, lng: -43.9381, radius: 4000 },
    { name: 'Belo Horizonte - Pampulha / Castelo', lat: -19.8519, lng: -43.9785, radius: 5000 },
    { name: 'Belo Horizonte - Barreiro / Buritis', lat: -19.9723, lng: -44.0201, radius: 5500 },
    { name: 'Belo Horizonte - Venda Nova / Santa Inês', lat: -19.8145, lng: -43.9570, radius: 5500 },
  ],
  'Curitiba': [
    { name: 'Curitiba - Centro / Batel / Bigorrilho', lat: -25.4372, lng: -49.2780, radius: 4000 },
    { name: 'Curitiba - Portão / Água Verde / Santa Quitéria', lat: -25.4678, lng: -49.2932, radius: 4500 },
    { name: 'Curitiba - Boqueirão / Hauer / Pinheirinho', lat: -25.5029, lng: -49.2458, radius: 5500 },
    { name: 'Curitiba - Boa Vista / Bacacheri / Cabral', lat: -25.3950, lng: -49.2480, radius: 5000 },
  ],
};

const memoryCitiesCache = new Map<string, IBGECity[]>();

export async function fetchStates(): Promise<IBGEState[]> {
  try {
    const res = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json() as IBGEState[];
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch {
    // fallback gracefully to static BRAZILIAN_STATES
  }
  return BRAZILIAN_STATES;
}

export async function fetchCitiesByState(uf: string): Promise<IBGECity[]> {
  const upperUf = uf.toUpperCase().trim();
  if (memoryCitiesCache.has(upperUf)) {
    return memoryCitiesCache.get(upperUf)!;
  }

  try {
    const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${upperUf}/municipios`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json() as IBGECity[];
      if (Array.isArray(data) && data.length > 0) {
        // Ordena alfabeticamente
        data.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        memoryCitiesCache.set(upperUf, data);
        return data;
      }
    }
  } catch {
    // fallback
  }

  // Fallback com cidades populares
  const popular = POPULAR_CITIES_BY_STATE[upperUf] || ['Capital', 'Região Central', 'Interior'];
  const fallbackCities: IBGECity[] = popular.map((name, index) => ({
    id: 1000 + index,
    nome: name,
  }));
  memoryCitiesCache.set(upperUf, fallbackCities);
  return fallbackCities;
}
