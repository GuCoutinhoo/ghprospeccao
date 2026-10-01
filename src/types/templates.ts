export type TemplateCategory =
  | 'whatsapp'
  | 'instagram'
  | 'audio'
  | 'followup'
  | 'closing';

export interface OutreachTemplate {
  id: string;
  title: string;
  category: TemplateCategory;
  targetChannel: 'whatsapp' | 'instagram' | 'audio' | 'both';
  badge: string;
  description: string;
  text: string;
  isCustom?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const TEMPLATE_VARIABLES = [
  { tag: '{{nome_empresa}}', label: 'Nome da Empresa', example: 'Barbearia Don Corleone' },
  { tag: '{{nicho}}', label: 'Nicho / Segmento', example: 'Barbearia' },
  { tag: '{{cidade}}', label: 'Cidade', example: 'Campinas' },
  { tag: '{{estado}}', label: 'UF / Estado', example: 'SP' },
  { tag: '{{nota_google}}', label: 'Nota Google', example: '4.9' },
  { tag: '{{avaliacoes}}', label: 'Nº Avaliações Google', example: '38' },
  { tag: '{{link_mockup}}', label: 'Link da Prévia Pronta', example: 'https://seusite.com/preview?leadId=...' },
  { tag: '{{meu_nome}}', label: 'Seu Nome', example: 'Gustavo Santos' },
  { tag: '{{minha_agencia}}', label: 'Sua Agência / Empresa', example: 'GH Soluções Digitais' },
];
