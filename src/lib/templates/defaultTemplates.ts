import { OutreachTemplate } from '../../types/templates';

export const DEFAULT_OUTREACH_TEMPLATES: OutreachTemplate[] = [
  // ==========================================
  // 1. WHATSAPP (PRIMEIRO CONTATO)
  // ==========================================
  {
    id: 'tpl_wa_barbearia_posicionamento',
    title: 'Barbearia (Posicionamento & Permissão)',
    category: 'whatsapp',
    targetChannel: 'whatsapp',
    badge: '💈 Especial Barbearias',
    description: 'Abordagem consultiva de alto padrão focada em valorizar a marca e facilitar o agendamento da barbearia.',
    text: `Olá boa tarde, tudo bem?

Meu nome é Gustavo, trabalho com posicionamento digital e conheci o trabalho da {{nome_empresa}}.

Percebi que vocês têm uma estrutura muito boa, mas ainda não contam com um site próprio. Com isso, quem conhece vocês pela internet pode não enxergar de cara os diferenciais da barbearia e acabar procurando outra opção.

Por isso, montei uma prévia de um site de alto padrão para vocês, pensado para valorizar a marca e facilitar o agendamento.

Posso te mandar o link pra você ver como ficou?`,
  },
  {
    id: 'tpl_wa_mockup_effect',
    title: 'Efeito Uau com Demonstração Pronta',
    category: 'whatsapp',
    targetChannel: 'whatsapp',
    badge: '🔥 35% Taxa de Resposta',
    description: 'Envia a página da loja já construída no nome do cliente. Gera curiosidade e reciprocidade instantânea.',
    text: `Olá! Falo com o responsável pelo atendimento da *{{nome_empresa}}*?

Aqui é o {{meu_nome}}. Vi que vocês têm excelente reputação no Google Maps em *{{cidade}}* (nota *{{nota_google}} ⭐* com *{{avaliacoes}} avaliações* positivas!).

Como notei que vocês ainda não possuem um site institucional oficial para receber agendamentos e tirar dúvidas dos clientes pelo celular, tomei a liberdade de montar uma *demonstração interativa exclusiva* para vocês verem como ficaria a presença digital da loja na web:

👉 Acesse a demonstração aqui: {{link_mockup}}

Ficou bem moderno, com botão direto pro seu WhatsApp e as fotos/avaliações reais de vocês.

Dá uma olhada e me diz o que achou!`,
  },
  {
    id: 'tpl_wa_pattern_interrupt',
    title: 'Quebra de Padrão (Anti-Vendedor em 2 Linhas)',
    category: 'whatsapp',
    targetChannel: 'whatsapp',
    badge: '⚡ Resposta Relâmpago',
    description: 'Mensagem super curta que parece uma dúvida de cliente real. Quase impossível de ignorar.',
    text: `Opa, tudo bem? Vocês ainda atendem clientes aqui de *{{cidade}}*?

Achei o perfil da *{{nome_empresa}}* pelo Google com nota *{{nota_google}}* e queria confirmar se o atendimento para {{nicho}} está funcionando por esse número.`,
  },
  {
    id: 'tpl_wa_google_opportunity',
    title: 'Oportunidade do Google Maps (Consultivo)',
    category: 'whatsapp',
    targetChannel: 'whatsapp',
    badge: '🎯 Foco em Faturamento',
    description: 'Elogia as avaliações no Google e mostra de forma elegante quanto dinheiro eles deixam na mesa por falta de site.',
    text: `Olá, equipe da *{{nome_empresa}}*! Tudo bem?

Meu nome é {{meu_nome}}, especialista em presença digital local pela {{minha_agencia}}.

Estava mapeando os comércios de destaque no segmento de *{{nicho}}* em *{{cidade}}* e achei a reputação de vocês fantástica no Google: nota *{{nota_google}} ★* com *{{avaliacoes}} clientes satisfeitos*. Parabéns! 👏

Notei apenas uma oportunidade: quando as pessoas pesquisam pelo serviço de vocês no Google pelo celular, não encontram um *site oficial com botão de atendimento rápido*.

Muitos clientes acabam desistindo ou indo para o concorrente que tem página no ar.

Montei uma proposta visual rápida mostrando como ficaria a página oficial da *{{nome_empresa}}*: {{link_mockup}}

Posso te explicar como funciona em 2 minutinhos por aqui sem compromisso?`,
  },
  {
    id: 'tpl_wa_express_48h',
    title: 'Venda Express (Entrega em 48 Horas)',
    category: 'whatsapp',
    targetChannel: 'whatsapp',
    badge: '🚀 Venda Direta',
    description: 'Ideal para proprietários ocupados que querem praticidade e baixo custo para resolver a presença digital.',
    text: `Olá, tudo bem?

Acompanho o trabalho da *{{nome_empresa}}* aqui em *{{cidade}}*. Vocês têm nota *{{nota_google}}* no Google, parabéns!

Trabalho desenvolvendo páginas profissionais de alta velocidade para o setor de *{{nicho}}*. Notei que vocês ainda estão sem site oficial e perdendo as buscas diárias de quem pesquisa no celular.

Conseguimos colocar a página oficial da *{{nome_empresa}}* no ar em até 48 horas, pronta para celular e com botão de WhatsApp direto: {{link_mockup}}

Tem 3 minutos para conversarmos sobre?`,
  },

  // ==========================================
  // 2. INSTAGRAM DIRECT (ANTI-VÁCUO)
  // ==========================================
  {
    id: 'tpl_ig_direct_curiosity',
    title: 'Direct Curiosidade & Quebra de Padrão',
    category: 'instagram',
    targetChannel: 'instagram',
    badge: '📸 Ideal para Direct',
    description: 'Mensagem leve e informal. Funciona perfeitamente porque parece que veio de alguém que frequenta a região.',
    text: `Opa, tudo bem? Vocês ainda atendem clientes aqui da região de {{cidade}}?

Achei a *{{nome_empresa}}* pelas avaliações do Google com nota {{nota_google}} e achei o espaço de vocês muito bacana! 👏

Notei que vocês não tinham um site ou botão oficial de agendamento na bio do perfil. Eu montei uma demonstração rápida no computador de como ficaria a presença digital de vocês na web: {{link_mockup}}

Dá uma olhadinha quando tiver um tempinho, acho que vão curtir bastante!`,
  },
  {
    id: 'tpl_ig_direct_compliment',
    title: 'Elogio de Reputação + Demonstração na Bio',
    category: 'instagram',
    targetChannel: 'instagram',
    badge: '🌟 Elogio Sincero',
    description: 'Focado em parabenizar pela nota e demonstrar como o perfil do Instagram fica 10x mais profissional com um site.',
    text: `Fala pessoal da *{{nome_empresa}}*, parabéns pelo perfil e pelas {{avaliacoes}} avaliações excelentes no Google!

Trabalho criando páginas profissionais para empresas de {{nicho}} aqui no estado.

Tomei a liberdade de criar uma demonstração moderna de um site oficial para vocês colocarem o link na bio do Instagram e receber clientes direto no WhatsApp: {{link_mockup}}

Ficou bem bonito no celular. O que acharam?`,
  },
  {
    id: 'tpl_ig_story_reply',
    title: 'Resposta aos Stories (Gatilho de Conexão)',
    category: 'instagram',
    targetChannel: 'instagram',
    badge: '💬 80% Abertura',
    description: 'Para responder a qualquer story recente da empresa. Gera conversa natural sem parecer propaganda fria.',
    text: `Muito bacana o trabalho de vocês! 👏

Acompanho a *{{nome_empresa}}* aqui em {{cidade}}. Inclusive montei uma demonstração de uma página oficial para agilizar o atendimento de vocês: {{link_mockup}}

Depois dá uma olhadinha, acho que vai ajudar muito a converter quem visita o perfil de vocês!`,
  },

  // ==========================================
  // 3. ROTEIROS DE ÁUDIO (20 A 30 SEGUNDOS)
  // ==========================================
  {
    id: 'tpl_audio_natural_20s',
    title: 'Áudio Humanizado Amigável (Efeito Uau)',
    category: 'audio',
    targetChannel: 'audio',
    badge: '🎙️ 4x Mais Resposta',
    description: 'Grave este áudio pelo celular com tom calmo e sorriso na voz. Nenhum texto bate o calor de um áudio pessoal.',
    text: `[GRAVE COM VOZ NATURAL E AMIGÁVEL - 20 segundos]

"Fala pessoal da {{nome_empresa}}, tudo bem? Aqui é o {{meu_nome}}.
Cara, eu tava olhando aqui as empresas do segmento de {{nicho}} em {{cidade}} e vi o perfil de vocês no Google... parabéns demais pelas {{avaliacoes}} avaliações com nota {{nota_google}}!
Eu só notei que quando alguém pesquisa por vocês, não encontra um site oficial com botão de agendamento.
Aí eu tomei a liberdade e montei uma demonstração rápida aqui no meu computador de como ficaria a página oficial de vocês na internet.
Vou deixar o link logo abaixo desse áudio, dá uma olhada quando puder e me diz o que achou!"`,
  },
  {
    id: 'tpl_audio_authority_30s',
    title: 'Áudio Consultivo de Autoridade',
    category: 'audio',
    targetChannel: 'audio',
    badge: '💎 Alta Credibilidade',
    description: 'Para donos de empresas mais formais (clínicas, imobiliárias, escritórios, consultórios).',
    text: `[TOM PROFISSIONAL E CONFIANTE - 30 segundos]

"Olá, bom dia! Aqui é o {{meu_nome}}, especialista em posicionamento comercial no Google.
Estava fazendo um levantamento dos negócios de destaque em {{cidade}} e identifiquei a {{nome_empresa}} com uma excelente reputação de nota {{nota_google}}.
No entanto, identificamos que mais de 70% das buscas no Google pelo celular procuram por um site seguro para clicar e comprar, e hoje vocês não têm essa presença ativa.
Eu desenvolvi um protótipo funcional para vocês analisarem sem compromisso.
Segue o link abaixo. Se fizer sentido, podemos agendar 5 minutos para conversarmos sobre."`,
  },

  // ==========================================
  // 4. RECUPERAÇÃO DE VÁCUO (FOLLOW-UP)
  // ==========================================
  {
    id: 'tpl_followup_24h_soft',
    title: 'Follow-up 24h Suave (Sem Pressão)',
    category: 'followup',
    targetChannel: 'both',
    badge: '🔄 Resgata 40% do Vácuo',
    description: 'Envie no dia seguinte para quem visualizou ou não respondeu. Donos de comércio são muito ocupados.',
    text: `Opa, tudo bem? Imagino que a rotina aí na *{{nome_empresa}}* deva estar corrida!

Conseguiu abrir a demonstração da página que te mandei ontem? ({{link_mockup}})

Ficou alguma dúvida sobre como funciona o botão de agendamento pro WhatsApp?`,
  },
  {
    id: 'tpl_followup_72h_scarcity',
    title: 'Follow-up 72h (Gatilho de Escassez Regional)',
    category: 'followup',
    targetChannel: 'both',
    badge: '⏳ Escassez Real',
    description: 'Gera urgência honesta: avisa que está fechando a rodada de projetos daquela cidade.',
    text: `Olá pessoal da *{{nome_empresa}}*, tudo joia?

Estou finalizando essa semana os novos projetos de presença digital para o segmento de *{{nicho}}* aqui na região de *{{cidade}}*.

Como vocês são uma das principais referências locais no Google, gostaria de priorizar vocês com aquela condição especial de lançamento que comentei.

Ainda faz sentido colocarmos a página oficial de vocês no ar? Abraço!`,
  },
  {
    id: 'tpl_followup_breakup_light',
    title: 'Despedida Elegante (Gatilho de Perda)',
    category: 'followup',
    targetChannel: 'both',
    badge: '💔 Reativação Final',
    description: 'Quando o cliente sente que vai perder a oportunidade, ele responde na hora.',
    text: `Olá! Imagino que agora não seja o momento prioritário para a *{{nome_empresa}}* investir em site próprio, sem problemas!

Vou desativar a demonstração provisória da página de vocês no meu servidor para liberar espaço para outros clientes de {{cidade}}.

Se no futuro vocês quiserem reativar a página e receber mais clientes no WhatsApp, é só me mandar uma mensagem por aqui. Desejo muito sucesso nas vendas! 👏`,
  },

  // ==========================================
  // 5. FECHAMENTO & RESPOSTA AO "QUANTO CUSTA?"
  // ==========================================
  {
    id: 'tpl_closing_price_framing',
    title: 'Como Responder ao "Quanto Custa?" (Ancoragem)',
    category: 'closing',
    targetChannel: 'whatsapp',
    badge: '💰 Fechamento Rápido',
    description: 'O modelo que fecha contratos. Nunca diga apenas o preço seco; ancore o valor e ofereça 2 opções fáceis de escolher.',
    text: `Excelente pergunta! Normalmente uma agência tradicional cobra de R$ 1.500 a R$ 2.500 para criar um site do zero e demora 30 dias.

Como nós já criamos a estrutura completa da *{{nome_empresa}}* pronta para entrega em 48h, temos duas opções super acessíveis para comércio local:

👉 *Plano Essencial (Mais Escolhido):*
• Página Oficial de Alta Conversão no ar em 48h
• Botão direto para o seu WhatsApp comercial
• Integração completa com Google Maps e avaliações reais
• Hospedagem segura e suporte incluso
💳 Apenas *R$ 497 à vista* (ou 12x de R$ 49 no cartão)

👉 *Plano VIP Pro:*
• Tudo do Plano Essencial +
• Otimização do perfil no Google Meu Negócio para subir nas buscas
• Cardápio / Catálogo online interativo
💳 Apenas *R$ 897 à vista* (ou 12x de R$ 89)

💡 Além disso, oferecemos *Garantia Incondicional de 7 dias*: se você não gostar da página no ar, devolvemos 100% do seu dinheiro.

Qual dessas duas opções atende melhor a *{{nome_empresa}}* no momento?`,
  },
  {
    id: 'tpl_closing_has_instagram',
    title: 'Resposta à Objeção: "Já Temos Instagram"',
    category: 'closing',
    targetChannel: 'both',
    badge: '🛡️ Quebra de Objeção',
    description: 'Mostra com elegância que o cliente com dinheiro no bolso e urgência pesquisa no Google, não no Instagram.',
    text: `Com certeza! O Instagram de vocês é excelente para quem já é seguidor e quer ver fotos do dia a dia.

A grande diferença é que quando alguém tem uma dor urgente ou quer contratar um serviço de *{{nicho}}* em *{{cidade}}*, essa pessoa não vai no Instagram: ela pesquisa no *Google* (ex: "{{nicho}} centro {{cidade}}").

No Google, quando a pessoa vê uma empresa com nota alta e clica num *site oficial rápido*, a credibilidade é imediata e ela clica no WhatsApp já pronta para agendar.

Um complementa o outro: o site oficial serve justamente para colocar na bio do Instagram e no Google para converter cliques em dinheiro no caixa.

Faz sentido para vocês?`,
  },
  {
    id: 'tpl_closing_risk_reversal',
    title: 'Fechamento com Risco Zero (Paga Depois)',
    category: 'closing',
    targetChannel: 'whatsapp',
    badge: '🤝 Irrecusável',
    description: 'Para o cliente que está em dúvida se confia. Elimina qualquer objeção de risco.',
    text: `Para você ver o quanto confio na qualidade do meu trabalho para a *{{nome_empresa}}*, fazemos o seguinte:

Você não precisa pagar o valor total adiantado.

Eu finalizo a página no domínio oficial de vocês, coloco no ar com todos os botões funcionando e te mostro ao vivo.

Você só faz o pagamento quando ver a página no ar funcionando 100% perfeitamente no seu celular.

Podemos fechar assim e eu já finalizo para você hoje mesmo?`,
  },
];
