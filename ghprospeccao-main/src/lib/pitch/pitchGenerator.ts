import { Lead } from '../../types';
import { formatBrazilianPhone, normalizeBrazilianPhone } from '../../utils/whatsapp';

export type PitchType =
  | 'mockup'
  | 'niche_specialized'
  | 'direct'
  | 'consultive'
  | 'instagram_direct'
  | 'audio_script'
  | 'followup_24h'
  | 'followup_72h'
  | 'call';

export interface GeneratedPitch {
  title: string;
  type: PitchType;
  description: string;
  targetChannel: 'whatsapp' | 'instagram' | 'audio' | 'call' | 'both';
  text: string;
}

export function getInstagramSearchUrl(businessName: string, city?: string): string {
  const query = `${businessName} ${city || ''}`.trim();
  return `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}`;
}

export function getWhatsAppDirectUrl(phone: string | null | undefined, message: string): string | null {
  const normalized = normalizeBrazilianPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/**
 * Retorna argumento e gatilho psicológico específico para o nicho da empresa
 */
export function getNicheArguments(nicheName?: string) {
  const n = (nicheName || '').toLowerCase();

  if (n.includes('acad') || n.includes('fit') || n.includes('cross') || n.includes('treino') || n.includes('pilates')) {
    return {
      category: 'Academia & Fitness',
      pain: 'Quando moradores do bairro pesquisam por academia no celular, querem ver fotos da estrutura, grade de aulas e valores de planos sem ter que ligar ou ir até a recepção.',
      solution: 'uma página moderna com botão direto para agendar aula experimental gratuita e consultar modalidades',
      callToAction: 'Colocando essa página no ar, vocês captam alunos novos toda semana que hoje acabam indo para redes maiores.',
    };
  }

  if (n.includes('barbearia') || n.includes('cabelo') || n.includes('salao') || n.includes('estet') || n.includes('manicure') || n.includes('spa')) {
    return {
      category: 'Barbearia & Beleza',
      pain: 'O profissional fica cortando cabelo ou atendendo cliente e não consegue responder o WhatsApp na hora, perdendo clientes para salões vizinhos.',
      solution: 'um site oficial com catálogo de serviços (cortes, barba, química), tabela de valores e botão de agendamento rápido',
      callToAction: 'Assim o cliente agenda sozinho em 30 segundos pelo celular e vocês não perdem clientes nos horários de pico.',
    };
  }

  if (n.includes('odonto') || n.includes('dent') || n.includes('clinica') || n.includes('saud') || n.includes('medic') || n.includes('psico') || n.includes('fisio')) {
    return {
      category: 'Saúde & Odontologia',
      pain: 'Pacientes com urgência ou que procuram tratamentos de maior valor (como implantes, alinhadores e estética) exigem credibilidade e segurança técnica antes de marcar.',
      solution: 'uma página médica oficial com especialidades, fotos do consultório, depoimentos e botão de agendamento de avaliação',
      callToAction: 'Isso passa 5x mais confiança e atrai pacientes qualificados que pesquisam no Google Maps todos os dias.',
    };
  }

  if (n.includes('restaur') || n.includes('pizza') || n.includes('comida') || n.includes('burger') || n.includes('hamburg') || n.includes('lanch') || n.includes('bar') || n.includes('cafe')) {
    return {
      category: 'Restaurante & Gastronomia',
      pain: 'Ficar refém de comissões abusivas de 12% a 27% dos aplicativos de delivery e clientes não acharem cardápio legível no Google.',
      solution: 'um cardápio digital oficial, leve para celular e com botão de pedidos direto no WhatsApp sem pagar taxa nenhuma de comissão',
      callToAction: 'Cada pedido que entra direto pelo site oficial de vocês vai 100% de lucro para o caixa da loja.',
    };
  }

  if (n.includes('mecan') || n.includes('oficina') || n.includes('auto') || n.includes('pneu') || n.includes('funilar') || n.includes('carro') || n.includes('moto')) {
    return {
      category: 'Oficina & Automotivo',
      pain: 'Motoristas que têm pane na rua ou precisam de revisão urgente pesquisam a oficina mais próxima com nota alta no Google e precisam de socorro rápido.',
      solution: 'uma página com botão de socorro/guincho, localização precisa no mapa e solicitação de orçamento pelo WhatsApp',
      callToAction: 'Conseguimos colocar a oficina de vocês como a primeira opção confiável para os motoristas da região.',
    };
  }

  if (n.includes('imobil') || n.includes('corretor') || n.includes('imovel')) {
    return {
      category: 'Imobiliária',
      pain: 'Clientes que pesquisam no Google querem ver fotos nítidas dos imóveis em destaque e agendar visitas sem burocracia.',
      solution: 'uma vitrine com imóveis em destaque para compra e locação com botão para falar direto com o corretor responsável',
      callToAction: 'Ideal para filtrar clientes qualificados com alto poder de compra em sua cidade.',
    };
  }

  if (n.includes('pet') || n.includes('veterin') || n.includes('banho') || n.includes('tosa')) {
    return {
      category: 'Pet Shop & Veterinária',
      pain: 'Tutores de pets buscam agilidade para marcar banho & tosa e encontrar atendimento veterinário de confiança.',
      solution: 'uma página amigável com agendamento de banho e tosa, consulta veterinária e vacinas direto no WhatsApp',
      callToAction: 'Aumenta a fidelidade dos tutores do bairro e preenche a agenda dos dias de menor movimento.',
    };
  }

  // Padrão Geral
  return {
    category: nicheName || 'Comércio Local',
    pain: 'Mais de 70% das pessoas em sua cidade pesquisam no celular antes de comprar e procuram um site oficial com catálogo e botão direto.',
    solution: 'uma página profissional responsiva para celulares com botão direto para o WhatsApp e dados reais da loja',
    callToAction: 'Garante que os clientes que pesquisam por sua empresa no Google caiam direto no seu WhatsApp prontos para comprar.',
  };
}

export function generatePitches(
  lead: Lead,
  options?: { senderName?: string; agencyName?: string; previewUrl?: string }
): GeneratedPitch[] {
  const sender = options?.senderName?.trim() || 'Gustavo Santos';
  const agency = options?.agencyName?.trim() || 'GH Prospecção';
  const reviews = lead.reviews_count || 12;
  const rating = lead.rating ? lead.rating.toFixed(1) : '4.9';
  const niche = lead.niche || 'Comércio Local';
  const city = lead.city || 'sua cidade';
  const previewLink = options?.previewUrl || `${window.location.origin}/preview?leadId=${lead.id}`;
  const nicheArgs = getNicheArguments(niche);

  const isBarbearia =
    (lead.niche || '').toLowerCase().includes('barbearia') ||
    (lead.name || '').toLowerCase().includes('barbearia') ||
    (lead.name || '').toLowerCase().includes('barber');

  const barbeariaPitchText = `Olá boa tarde, tudo bem?

Meu nome é Gustavo, trabalho com posicionamento digital e conheci o trabalho da ${lead.name}.

Percebi que vocês têm uma estrutura muito boa, mas ainda não contam com um site próprio. Com isso, quem conhece vocês pela internet pode não enxergar de cara os diferenciais da barbearia e acabar procurando outra opção.

Por isso, montei uma prévia de um site de alto padrão para vocês, pensado para valorizar a marca e facilitar o agendamento.

Posso te mandar o link pra você ver como ficou?`;

  return [
    {
      title: isBarbearia ? '💈 WhatsApp Barbearia (Permissão)' : `🎯 Pitch Especializado (${nicheArgs.category})`,
      type: 'niche_specialized',
      description: isBarbearia
        ? 'Mensagem com tom consultivo e pedido de permissão para envio do link. Máxima taxa de resposta.'
        : `Argumento sob medida para o nicho de ${nicheArgs.category}. Ataca a dor exata e oferece a solução ideal.`,
      targetChannel: 'whatsapp',
      text: isBarbearia
        ? barbeariaPitchText
        : `Olá! Falo com a gerência ou atendimento da *${lead.name}*?

Aqui é o ${sender}. Vi a avaliação excelente de vocês no Google em *${city}* (${reviews} clientes e nota *${rating} ⭐*, parabéns pelo serviço!).

Trabalho estruturando a presença digital de empresas do segmento de *${niche}*. Notei que vocês ainda não possuem um site oficial próprio.

O grande ponto é: ${nicheArgs.pain}

Por isso, montei uma *demonstração prática exclusiva* mostrando como ficaria ${nicheArgs.solution}:

👉 Acesse a demonstração aqui: ${previewLink}

${nicheArgs.callToAction}

Dá uma olhada no celular e me diz o que achou da prévia!`,
    },

    {
      title: isBarbearia ? '⚡ WhatsApp Barbearia (Com Link)' : '⚡ WhatsApp Express (Com Prévia Pronta)',
      type: 'mockup',
      description: 'Gera o "Efeito Uau". Manda a prévia já interativa no nome do cliente. Taxa de resposta máxima.',
      targetChannel: 'whatsapp',
      text: isBarbearia
        ? `Olá boa tarde, tudo bem?

Meu nome é Gustavo, trabalho com posicionamento digital e conheci o trabalho da ${lead.name}.

Percebi que vocês têm uma estrutura muito boa, mas ainda não contam com um site próprio. Com isso, quem conhece vocês pela internet pode não enxergar de cara os diferenciais da barbearia e acabar procurando outra opção.

Por isso, montei uma prévia de um site de alto padrão para vocês, pensado para valorizar a marca e facilitar o agendamento: ${previewLink}

Dá uma olhada no celular e me diz o que achou!`
        : `Olá! Falo com o responsável pelo atendimento da *${lead.name}*?

Aqui é o ${sender}. Vi que vocês têm excelente reputação no Google Maps em *${city}* (${reviews} avaliações positivas com nota ${rating} ⭐!).

Como notei que vocês ainda não possuem um site oficial responsivo para agendar e tirar dúvidas dos clientes, tomei a liberdade de montar uma *prévia interativa de demonstração* exclusiva para vocês verem como ficaria a presença digital da loja na internet:

👉 Acesse a prévia aqui: ${previewLink}

Ficou bem moderno, com botão direto pro WhatsApp e os dados reais de vocês.

Dá uma olhada e me diz o que achou!`,
    },

    {
      title: '📸 Instagram Direct (Curto & Anti-Vácuo)',
      type: 'instagram_direct',
      description: 'Mensagem leve e humana para Direct. Quebra de padrão com curiosidade irresistível.',
      targetChannel: 'instagram',
      text: `Opa, tudo bem? Vocês ainda atendem clientes aqui de ${city}?

Achei o perfil da *${lead.name}* pelo Google Maps com nota ${rating} e adorei o trabalho de vocês! 👏

Notei que vocês não tinham um link oficial de agendamento/site na bio. Eu montei uma demonstração rápida de como ficaria a página de vocês na web: ${previewLink}

Dá uma olhadinha quando puder, acho que vão curtir!`,
    },

    {
      title: '🎙️ Roteiro de Áudio (20 Segundos Falado)',
      type: 'audio_script',
      description: 'Grave um áudio no WhatsApp ou Direct lendo esse texto natural. Resposta até 4x maior que texto!',
      targetChannel: 'audio',
      text: `[GRAVAR ÁUDIO NATURAL COM VOZ AMIGÁVEL - 20 segundos]
"Fala pessoal da ${lead.name}, tudo bem?
Cara, tava olhando aqui as empresas do segmento de ${niche} em ${city} e vi o perfil de vocês no Google, parabéns pelas ${reviews} avaliações com nota ${rating}!
Eu só notei que vocês ainda não tinham um site oficial com botão de WhatsApp e agendamento.
Eu montei uma demonstração rápida aqui no meu computador de como ficaria a página de vocês na internet.
Vou te mandar o link aqui logo abaixo, dá uma olhada e me fala o que achou!"`,
    },

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

Preparei uma demonstração prática mostrando como podemos criar a presença digital da *${lead.name}* para captar esses clientes direto no seu WhatsApp: ${previewLink}

Posso te explicar como funciona em 2 minutinhos?`,
    },

    {
      title: '🚀 Pitch Direto & Objetivo (Venda Express)',
      type: 'direct',
      description: 'Mensagem curta e direta para comércios com rotina corrida. Ótima para donos ocupados.',
      targetChannel: 'whatsapp',
      text: `Olá, tudo bem?

Acompanho o trabalho da *${lead.name}* aqui em *${city}*. Vocês têm uma das melhores notas no Google (${rating} estrelas)!

Trabalho criando páginas profissionais e catálogos no WhatsApp para o nicho de *${niche}*. Notei que vocês ainda não têm site oficial e estão perdendo os clientes que pesquisam no Google todo dia.

Conseguimos colocar a página profissional da *${lead.name}* no ar em até 48 horas, com design sob medida e investimento super acessível para comércio local: ${previewLink}

Tem 3 minutos para conversarmos sobre?`,
    },

    {
      title: '🔄 Follow-up 24h (Recuperação de Vácuo)',
      type: 'followup_24h',
      description: 'Para enviar no dia seguinte caso a pessoa não tenha respondido ainda.',
      targetChannel: 'both',
      text: `Opa, tudo bem? Imagino que a rotina aí na *${lead.name}* deva estar corrida!

Conseguiu abrir a demonstração da página que te mandei ontem (${previewLink})?

Ficou alguma dúvida sobre como funciona o botão de agendamento pro WhatsApp?`,
    },

    {
      title: '⏳ Follow-up 72h (Gatilho de Escassez)',
      type: 'followup_72h',
      description: 'Último contato elegante gerando urgência regional.',
      targetChannel: 'both',
      text: `Olá pessoal da *${lead.name}*, tudo joia?

Estou finalizando essa semana os projetos de presença digital para o segmento de *${niche}* aqui na região de *${city}*.

Como vocês são referência pelo Google, gostaria de priorizar vocês com aquela condição especial de lançamento.

Ainda faz sentido colocarmos a página oficial de vocês no ar? Abraço!`,
    },

    {
      title: '📞 Roteiro para Ligação Telefônica',
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
"Eu já desenvolvi um protótipo visual de como ficaria a página oficial da ${lead.name} no ar, com botão pro WhatsApp e mapa: ${previewLink}
Fica melhor eu te apresentar isso numa rápida chamada de vídeo de 10 minutos hoje às 16h ou amanhã às 10h da manhã?"`,
    },
  ];
}

export const COMMON_OBJECTIONS = [
  {
    objection: '"Já temos Instagram, não precisamos de site"',
    rebuttal:
      'Com certeza o Instagram é excelente para quem já segue vocês! Mas o cliente com dor urgente pesquisa no Google (ex: "barbearia centro campinas" ou "dentista urgente"). No Google, quem tem site passa 5x mais credibilidade e o cliente não se distrai com notificações de redes sociais.',
  },
  {
    objection: '"Não temos orçamento ou está fora de hora"',
    rebuttal:
      'Entendo perfeitamente! Justamente por isso criamos um modelo de baixo custo pensado para comércios locais, que se paga com apenas 1 ou 2 novos clientes no mês. Que tal dar uma olhada na prévia sem compromisso para você avaliar?',
  },
  {
    objection: '"Me manda as informações pelo WhatsApp"',
    rebuttal:
      'Perfeito! Qual é o melhor número para eu te mandar a prévia com o design que montei para a loja? Já vou enviar agora mesmo e em seguida te dou um alô.',
  },
  {
    objection: '"Já tentamos fazer site antes e não deu resultado"',
    rebuttal:
      'Muitas agências antigas faziam sites pesados que ninguém acessava. O que fazemos hoje é uma Landing Page de Alta Conversão focada em celulares, com botão direto que joga a pessoa na sua conversa de WhatsApp pronta para agendar.',
  },
];
