import { Lead } from '../../types';
import { OutreachTemplate } from '../../types/templates';
import { DEFAULT_OUTREACH_TEMPLATES } from './defaultTemplates';

const STORAGE_KEY = 'gh_outreach_custom_templates_v1';

export function getStoredTemplates(): OutreachTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_OUTREACH_TEMPLATES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    console.warn('[TemplateStorage] Erro ao carregar templates locais:', err);
  }
  return DEFAULT_OUTREACH_TEMPLATES;
}

export function saveTemplates(templates: OutreachTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch (err) {
    console.error('[TemplateStorage] Erro ao salvar templates:', err);
  }
}

export function resetTemplatesToDefault(): OutreachTemplate[] {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error(e);
  }
  return DEFAULT_OUTREACH_TEMPLATES;
}

export function saveSingleTemplate(template: OutreachTemplate): OutreachTemplate[] {
  const all = getStoredTemplates();
  const index = all.findIndex((t) => t.id === template.id);

  let updated: OutreachTemplate[];
  const now = new Date().toISOString();

  if (index >= 0) {
    updated = [...all];
    updated[index] = {
      ...template,
      updatedAt: now,
    };
  } else {
    updated = [
      {
        ...template,
        createdAt: now,
        updatedAt: now,
      },
      ...all,
    ];
  }

  saveTemplates(updated);
  return updated;
}

export function deleteTemplateById(id: string): OutreachTemplate[] {
  const all = getStoredTemplates();
  const filtered = all.filter((t) => t.id !== id);
  saveTemplates(filtered);
  return filtered;
}

export function renderTemplateText(
  rawText: string,
  lead?: Partial<Lead> | null,
  options?: {
    senderName?: string;
    agencyName?: string;
    previewUrl?: string;
  }
): string {
  if (!rawText) return '';

  const companyName = lead?.name || 'sua empresa';
  const niche = lead?.niche || 'comércio local';
  const city = lead?.city || 'sua cidade';
  const state = lead?.state || 'seu estado';
  const rating = lead?.rating ? lead.rating.toFixed(1) : '4.9';
  const reviews = lead?.reviews_count ? String(lead.reviews_count) : '15';
  const preview =
    options?.previewUrl ||
    (lead?.id ? `${window.location.origin}/preview?leadId=${lead.id}` : 'https://seusite.com/preview?leadId=demo');
  const sender = options?.senderName || localStorage.getItem('prospecta_sender_name') || 'Gustavo Santos';
  const agency = options?.agencyName || localStorage.getItem('prospecta_agency_name') || 'GH Soluções Digitais';

  let rendered = rawText;
  rendered = rendered.replace(/\{\{nome_empresa\}\}/g, companyName);
  rendered = rendered.replace(/\{\{nicho\}\}/g, niche);
  rendered = rendered.replace(/\{\{cidade\}\}/g, city);
  rendered = rendered.replace(/\{\{estado\}\}/g, state);
  rendered = rendered.replace(/\{\{nota_google\}\}/g, rating);
  rendered = rendered.replace(/\{\{avaliacoes\}\}/g, reviews);
  rendered = rendered.replace(/\{\{link_mockup\}\}/g, preview);
  rendered = rendered.replace(/\{\{meu_nome\}\}/g, sender);
  rendered = rendered.replace(/\{\{minha_agencia\}\}/g, agency);

  return rendered;
}
