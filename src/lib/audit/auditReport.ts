import { Lead } from '../../types';
import { formatBrazilianPhone } from '../../utils/whatsapp';

export interface AuditPillar {
  name: string;
  score: number; // 0 a 100
  status: 'critical' | 'warning' | 'good';
  points: string[];
}

export interface AuditReportData {
  lead: Lead;
  auditId: string;
  dateFormatted: string;
  overallScore: number;
  scoreLabel: string;
  scoreColor: string;
  pillars: AuditPillar[];
  estimatedMonthlySearches: number;
  estimatedMissedClicks: number;
  estimatedRevenueLossMin: number;
  estimatedRevenueLossMax: number;
  actionPlan: { phase: string; title: string; desc: string }[];
  whatsappSummary: string;
}

export function generateAuditReport(lead: Lead): AuditReportData {
  const auditId = `AUD-${lead.id.slice(-6).toUpperCase()}-${new Date().getFullYear()}`;
  const now = new Date();
  const dateFormatted = now.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const hasWebsite = Boolean(lead.website && lead.website_status !== 'no_website');
  const hasPhone = Boolean(lead.phone);
  const reviews = lead.reviews_count || 5;
  const rating = lead.rating || 4.5;

  // Cálculo de pontuação de saúde digital (0 a 100)
  // Se não tem site, o score de presença web despenca
  const googleScore = Math.min(100, Math.round((rating / 5) * 60 + Math.min(40, reviews * 1.5)));
  const webScore = hasWebsite ? 85 : 15;
  const conversionScore = hasPhone ? (hasWebsite ? 80 : 40) : 10;
  const compScore = hasWebsite ? 75 : 30;

  const overallScore = Math.round(
    googleScore * 0.35 + webScore * 0.35 + conversionScore * 0.2 + compScore * 0.1
  );

  let scoreLabel = 'Crítico - Alta Perda de Clientes';
  let scoreColor = 'text-rose-600 bg-rose-50 border-rose-200';
  if (overallScore >= 70) {
    scoreLabel = 'Excelente Presença Digital';
    scoreColor = 'text-emerald-600 bg-emerald-50 border-emerald-200';
  } else if (overallScore >= 45) {
    scoreLabel = 'Moderado - Oportunidades Não Exploradas';
    scoreColor = 'text-amber-600 bg-amber-50 border-amber-200';
  }

  // Estimativas de buscas locais no nicho
  const nicheLower = (lead.niche || '').toLowerCase();
  let baseSearches = 450;
  let avgTicket = 120;

  if (nicheLower.includes('barbearia') || nicheLower.includes('cabelo')) {
    baseSearches = 550;
    avgTicket = 65;
  } else if (nicheLower.includes('odonto') || nicheLower.includes('dent')) {
    baseSearches = 600;
    avgTicket = 350;
  } else if (nicheLower.includes('mecan') || nicheLower.includes('oficina')) {
    baseSearches = 400;
    avgTicket = 450;
  } else if (nicheLower.includes('restaur') || nicheLower.includes('comida')) {
    baseSearches = 1200;
    avgTicket = 85;
  } else if (nicheLower.includes('solar') || nicheLower.includes('energia')) {
    baseSearches = 300;
    avgTicket = 2500;
  }

  const estimatedMonthlySearches = baseSearches;
  // Cerca de 38% dos cliques vão embora se não houver site oficial
  const estimatedMissedClicks = hasWebsite ? 20 : Math.round(baseSearches * 0.38);
  const estimatedRevenueLossMin = Math.round((estimatedMissedClicks * 0.08) * avgTicket);
  const estimatedRevenueLossMax = Math.round((estimatedMissedClicks * 0.18) * avgTicket);

  const pillars: AuditPillar[] = [
    {
      name: 'Google Maps & Autoridade Local',
      score: googleScore,
      status: googleScore >= 70 ? 'good' : googleScore >= 40 ? 'warning' : 'critical',
      points: [
        `Nota média pública: ${rating.toFixed(1)} estrelas no Google`,
        `Volume de depoimentos: ${reviews} avaliações de clientes`,
        rating >= 4.5
          ? 'Excelente percepção do consumidor local'
          : 'Pode melhorar incentivando novos feedbacks positivos',
      ],
    },
    {
      name: 'Website Oficial & Infraestrutura Mobile',
      score: webScore,
      status: webScore >= 70 ? 'good' : 'critical',
      points: hasWebsite
        ? [
            `Domínio detectado: ${lead.website}`,
            'Possui página na web para apresentação institucional',
          ]
        : [
            'SEM SITE OFICIAL: Não possui página institucional própria',
            'Ausência de catálogo de serviços nos navegadores de celulares',
            'Perda de tráfego de clientes que pesquisam pelo serviço no Google',
          ],
    },
    {
      name: 'Canais de Atendimento & Conversão Rápida',
      score: conversionScore,
      status: conversionScore >= 70 ? 'good' : conversionScore >= 40 ? 'warning' : 'critical',
      points: [
        hasPhone
          ? `Telefone comercial detectado: ${formatBrazilianPhone(lead.phone)}`
          : 'Telefone comercial não localizado no cadastro público',
        hasWebsite
          ? 'Facilidade para o usuário enviar mensagem imediata'
          : 'Falta botão de WhatsApp flutuante direto conectado a uma página',
      ],
    },
    {
      name: 'Competitividade Perante Concorrentes Locais',
      score: compScore,
      status: compScore >= 70 ? 'good' : 'warning',
      points: [
        `Concorrência no segmento de ${lead.niche} em ${lead.city}`,
        hasWebsite
          ? 'Posicionamento equiparado aos concorrentes de ponta'
          : 'Concorrentes com site no bairro capturam clientes indecisos',
      ],
    },
  ];

  const actionPlan = [
    {
      phase: 'Fase 1 (Imediata - 48h)',
      title: 'Implantação de Landing Page Mobile de Alta Conversão',
      desc: `Publicar uma página oficial para a ${lead.name} contendo catálogo dos principais serviços, fotos do local e botão direto de WhatsApp.`,
    },
    {
      phase: 'Fase 2 (Curto Prazo - 7 dias)',
      title: 'Integração do Link no Google Meu Negócio',
      desc: 'Inserir a URL oficial no botão "Website" do perfil da empresa no Google Maps para transformar pesquisas em chamados diretos.',
    },
    {
      phase: 'Fase 3 (Médio Prazo - 30 dias)',
      title: 'Otimização de SEO Local & Campanha de Avaliações',
      desc: 'Configurar palavras-chave do bairro e cidade para manter a empresa no topo do ranking das buscas orgânicas da região.',
    },
  ];

  const whatsappSummary = `📊 *DIAGNÓSTICO DIGITAL EXECUTIVO*
🏢 *Empresa:* ${lead.name}
📍 *Local:* ${lead.city} - ${lead.state}
🏆 *Reputação Google:* ${rating.toFixed(1)} ★ (${reviews} avaliações)

🚨 *Índice de Saúde Digital:* ${overallScore}/100 (${scoreLabel.split('-')[0].trim()})
⚠️ *Diagnóstico Principal:* A empresa possui excelente avaliação dos clientes, porém *NÃO POSSUI SITE OFICIAL*.

📉 *Impacto Estimado na Região de ${lead.city}:*
• ~${estimatedMissedClicks} clientes em potencial deixam de agendar por falta de link direto no Google todo mês.
• Perda estimada de faturamento: *R$ ${estimatedRevenueLossMin.toLocaleString('pt-BR')} a R$ ${estimatedRevenueLossMax.toLocaleString('pt-BR')}/mês*.

💡 *Solução Recomendada:* Ativação de uma página web responsiva com botão de WhatsApp e catálogo em até 48 horas.`;

  return {
    lead,
    auditId,
    dateFormatted,
    overallScore,
    scoreLabel,
    scoreColor,
    pillars,
    estimatedMonthlySearches,
    estimatedMissedClicks,
    estimatedRevenueLossMin,
    estimatedRevenueLossMax,
    actionPlan,
    whatsappSummary,
  };
}
