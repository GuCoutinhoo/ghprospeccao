/**
 * Normaliza e gera link direto para o WhatsApp de telefones brasileiros
 * Formato padrão: https://wa.me/55 + DDD + NUMERO
 */

export function normalizeBrazilianPhone(phone?: string | null): string | null {
  if (!phone) return null;

  // Remove tudo que não for dígito
  const digits = phone.replace(/\D/g, '');

  if (digits.length < 8) return null;

  // Se já começar com código do Brasil 55
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }

  // Se tiver DDD + número (10 ou 11 dígitos, ex: 11987654321 ou 1187654321)
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  // Se tiver 8 ou 9 dígitos sem DDD, não podemos adivinhar com segurança o DDD
  return null;
}

export function formatBrazilianPhone(phone?: string | null): string {
  if (!phone) return 'Não informado';

  const digits = phone.replace(/\D/g, '');

  // Se tiver 55 no início, remove para formatar amigável
  const localDigits = (digits.startsWith('55') && digits.length >= 12) 
    ? digits.substring(2) 
    : digits;

  if (localDigits.length === 11) {
    return `(${localDigits.substring(0, 2)}) ${localDigits.substring(2, 7)}-${localDigits.substring(7)}`;
  }
  if (localDigits.length === 10) {
    return `(${localDigits.substring(0, 2)}) ${localDigits.substring(2, 6)}-${localDigits.substring(6)}`;
  }

  return phone;
}

export function getWhatsAppUrl(phone?: string | null, companyName?: string): string | null {
  const normalized = normalizeBrazilianPhone(phone);
  if (!normalized) return null;

  let text = '';
  if (companyName) {
    const greeting = 'Olá! Tudo bem?';
    text = encodeURIComponent(`${greeting} Gostaria de falar com o responsável pela ${companyName}.`);
  }

  return `https://wa.me/${normalized}${text ? `?text=${text}` : ''}`;
}
