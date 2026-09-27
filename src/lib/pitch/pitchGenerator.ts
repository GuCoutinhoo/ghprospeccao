import { Lead } from '../../types';
import { formatBrazilianPhone } from '../../utils/whatsapp';

export type PitchType = 'consultive' | 'mockup' | 'direct' | 'call';

export interface GeneratedPitch {
  title: string;
  type: PitchType;
  description: string;
  targetChannel: 'whatsapp' | 'call' | 'both';
  text: string;
}

export function generatePitches(lead: Lead, options?: { senderName?: string; agencyName?: string; previewUrl?: string }): GeneratedPitch[] {
  const sender = options?.senderName?.trim() || 'Gustavo Santos';
  const agency = options?.agencyName?.trim() || 'ProspectaPlaces Soluções Digitais';
  const phone = formatBrazilianPhone(lead.phone);
  const reviews = lead.reviews_count || 10;
  const rating = lead.rating ? lead.rating.toFixed(1) : '5.0';
  const niche = lead.niche || 'Comércio Local';
  const city = lead.city || 'sua cidade';
  const previewLink = options?.previewUrl || `${window.location.origin}/preview?leadId=${lead.id}`;

  return [
    {
      title: '🎯 Pitch Consultivo (Foco em Oportunidade)',
      type: 'consultive',
      description: 'Elogia a reputação real da loja no Google e aponta com sutileza a perda de clientes por falta de site próprio.',
      targetChannel: 'whatsapp',
      text: `Olá, equipe da *${lead.name}*! Tudo bem?

Meu nome é ${sender}, sou especialista em presença digital local pela *${agency}*.

Estava mapeando as empresas de maior destaque no segmento de *${niche}* em *${city}* e encontrei o perfil de vocês no Google com uma reputação incrível: nota *${rating} ★* e *${reviews} avaliações* de clientes! Parabéns pelo trabalho 👏

Notei apenas um detalhe estratégico: quando alguém pesquisa por vocês no Google pelo celular, não encontra um *site oficial com catálogo/agendamento online*.

Muitos clientes acabam desistindo ou caindo em concorrentes que têm página com botão direto.

Preparei uma proposta rápida mostrando como podemos criar a presença digital da *${lead.name}* para captar esses clientes direto no seu WhatsApp.

Posso te enviar uma demonstração rápida de 2 minutinhos por aqui sem compromisso?`,
    },

    {
      title: '⚡ Pitch de Impacto (Com Demonstração Pronta)',
      type: 'mockup',
      description: 'Gera o "Efeito Uau": envia a prévia interativa do site já pronta no nome do cliente. Taxa de resposta máxima.',
      targetChannel: 'whatsapp',
      text: `Olá! Falo com o responsável pelo atendimento da *${lead.name}*?

Aqui é o ${sender}. Vi que vocês têm excelente avaliação no Google Maps em *${city}* (${reviews} avaliações positivas!).

Como notei que vocês ainda não possuem um site institucional responsivo para agendar e tirar dúvidas dos clientes, tomei a liberdade de montar uma *prévia interativa exclusiva de demonstração* para vocês verem como ficaria a presença digital da loja na internet:

👉 Acesse a prévia aqui: ${previewLink}

Ficou bem moderno, com botão direto pro WhatsApp e os depoimentos reais de vocês.

Dá uma olhada e me diz o que achou!`,
    },

    {
      title: '🚀 Pitch Direto & Objetivo (Venda Express)',
      type: 'direct',
      description: 'Mensagem curta e direta para comércios com rotina corrida. Ótima para donos ocupados.',
      targetChannel: 'whatsapp',
      text: `Olá, tudo bem?

Acompanho o trabalho da *${lead.name}* aqui em *${city}*. Vocês têm uma das melhores notas no Google (${rating} estrelas)!

Trabalho criando páginas profissionais e catálogos no WhatsApp para o nicho de *${niche}*. Notei que vocês ainda não têm site oficial e estão perdendo os clientes que pesquisam no Google todo dia.

Conseguimos colocar a página profissional da *${lead.name}* no ar em até 48 horas, com design sob medida e investimento super acessível para comércio local.

Tem 3 minutos para eu te mostrar como funciona?`,
    },

    {
      title: '📞 Roteiro Completo para Ligação Telefônica',
      type: 'call',
      description: 'Script estruturado de 4 etapas para prospecção por voz, com quebra de gelo e agendamento de reunião.',
      targetChannel: 'call',
      text: `[ETAPA 1 - ABERTURA & QUEBRA DE PADRÃO - 15 segundos]
"Alô, bom dia / boa tarde! Por favor, o(a) responsável ou proprietário(a) da ${lead.name} está disponível?"
(Se for recepcionista): "É sobre uma solicitação referente à página oficial e buscas no Google Maps da empresa."

[ETAPA 2 - O GANCHO / ELOGIO REAL]
"Olá [Nome do Dono/Gerente], meu nome é ${sender}, sou da ${agency}.
Não estou ligando para te tomar tempo. Eu vi que a ${lead.name} tem uma avaliação excelente no Google aqui em ${city}, com nota ${rating} e mais de ${reviews} clientes elogiando o serviço de vocês."

[ETAPA 3 - A DOR & OPORTUNIDADE]
"Acontece que hoje, mais de 70% das pessoas em ${city} que procuram por ${niche} no Google clicam para ver um site ou agendar direto. E a loja de vocês hoje não tem uma página na web. Isso significa que pessoas prontas para comprar acabam indo para o concorrente mais próximo."

[ETAPA 4 - FECHAMENTO DE REUNIÃO / DEMONSTRAÇÃO]
"Eu já desenvolvi um protótipo visual de como ficaria a página oficial da ${lead.name} no ar, com botão pro WhatsApp e mapa.
Fica melhor eu te apresentar isso numa rápida chamada de vídeo de 10 minutos hoje às 16h ou amanhã às 10h da manhã?"`,
    },
  ];
}

export const COMMON_OBJECTIONS = [
  {
    objection: '"Já temos Instagram, não precisamos de site"',
    rebuttal: 'Com certeza o Instagram é excelente para quem já segue vocês! Mas o cliente com dor urgente pesquisa no Google (ex: "barbearia centro campinas" ou "dentista urgente"). No Google, quem tem site passa 5x mais credibilidade e o cliente não se distrai com notificações de redes sociais.',
  },
  {
    objection: '"Não temos orçamento ou está fora de hora"',
    rebuttal: 'Entendo perfeitamente! Justamente por isso criamos um modelo de baixo custo pensado para comércios locais, que se paga com apenas 1 ou 2 novos clientes no mês. Que tal dar uma olhada na prévia sem compromisso para você avaliar?',
  },
  {
    objection: '"Me manda as informações pelo WhatsApp"',
    rebuttal: 'Perfeito! Qual é o melhor número para eu te mandar a prévia com o design que montei para a loja? Já vou enviar agora mesmo e em seguida te dou um alô.',
  },
  {
    objection: '"Já tentamos fazer site antes e não deu resultado"',
    rebuttal: 'Muitas agências antigas faziam sites pesados que ninguém acessava. O que fazemos hoje é uma Landing Page de Alta Conversão focada em celulares, com botão direto que joga a pessoa na sua conversa de WhatsApp pronta para agendar.',
  },
];
