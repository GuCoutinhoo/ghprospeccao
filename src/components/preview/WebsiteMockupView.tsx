import React from 'react';
import {
  Star,
  Phone,
  MessageCircle,
  MapPin,
  Clock,
  ShieldCheck,
  Award,
  Users,
  CheckCircle2,
  Calendar,
  Sparkles,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { Lead } from '../../types';
import { formatBrazilianPhone, getWhatsAppUrl } from '../../utils/whatsapp';

interface WebsiteMockupViewProps {
  lead: Lead;
  isEmbed?: boolean;
}

export const WebsiteMockupView: React.FC<WebsiteMockupViewProps> = ({ lead, isEmbed = false }) => {
  const waUrl = getWhatsAppUrl(
    lead.phone,
    `Olá! Vi o site da ${lead.name} e gostaria de solicitar um atendimento/orçamento.`
  );

  const nicheLower = (lead.niche || '').toLowerCase();

  // Customização de conteúdo e estilo por nicho
  let theme = {
    primaryBg: 'bg-neutral-900',
    primaryText: 'text-neutral-900',
    accentColor: 'text-amber-500',
    badgeBg: 'bg-amber-50 text-amber-900 border-amber-200',
    heroTag: 'Referência em Qualidade & Atendimento',
    heroTitle: `O melhor em ${lead.niche} em ${lead.city}`,
    heroSubtitle: `Atendimento exclusivo, estrutura moderna e profissionais dedicados a oferecer a melhor experiência para você e sua família.`,
    services: [
      { title: 'Atendimento Personalizado', desc: 'Soluções pensadas sob medida com foco na sua total satisfação.' },
      { title: 'Estrutura Completa', desc: 'Espaço climatizado, equipamentos modernos e fácil localização.' },
      { title: 'Agilidade & Pontualidade', desc: 'Respeito ao seu tempo com horários flexíveis e atendimento rápido.' },
      { title: 'Garantia de Qualidade', desc: 'Profissionais experientes e materiais de primeira linha.' },
    ],
    ctaButton: 'Falar pelo WhatsApp',
  };

  if (nicheLower.includes('barbearia') || nicheLower.includes('cabelo') || nicheLower.includes('salao')) {
    theme = {
      primaryBg: 'bg-stone-900',
      primaryText: 'text-stone-900',
      accentColor: 'text-amber-500',
      badgeBg: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      heroTag: 'Tradição, Estilo & Cuidado Masculino',
      heroTitle: `Eleve seu estilo na ${lead.name}`,
      heroSubtitle: `Cortes clássicos e modernos, barba terapia com toalha quente e um ambiente exclusivo pensado para o seu momento de relaxar.`,
      services: [
        { title: 'Corte de Cabelo Personalizado', desc: 'Visagismo, degradê e acabamento perfeito para o seu rosto.' },
        { title: 'Barba Terapia com Toalha Quente', desc: 'Alinhamento com navalha, hidratação e óleos essenciais.' },
        { title: 'Tratamentos Capilares & Barba', desc: 'Selagem, pigmentação e cuidados profundos contra queda.' },
        { title: 'Ambiente Premium', desc: 'Cerveja gelada, café especial e atendimento com hora marcada.' },
      ],
      ctaButton: 'Agendar Horário Online',
    };
  } else if (nicheLower.includes('odonto') || nicheLower.includes('dent') || nicheLower.includes('clinica')) {
    theme = {
      primaryBg: 'bg-teal-950',
      primaryText: 'text-teal-900',
      accentColor: 'text-teal-500',
      badgeBg: 'bg-teal-50 text-teal-800 border-teal-200',
      heroTag: 'Saúde, Conforto & Tecnologia Odontológica',
      heroTitle: `O sorriso dos seus sonhos com a ${lead.name}`,
      heroSubtitle: `Tratamentos odontológicos modernos, sem dor e com atendimento humanizado para devolver a sua autoestima em ${lead.city}.`,
      services: [
        { title: 'Implantes & Próteses Fixas', desc: 'Tecnologia de ponta para recuperar sua mastigação e confiança.' },
        { title: 'Alinhadores Invisíveis & Ortodontia', desc: 'Sorriso alinhado de forma discreta, confortável e rápida.' },
        { title: 'Clareamento Dental a Laser', desc: 'Dentes brancos e brilhantes com segurança e sem sensibilidade.' },
        { title: 'Odontologia Preventiva & Check-up', desc: 'Limpeza profunda, aplicação de flúor e prevenção contínua.' },
      ],
      ctaButton: 'Agendar Consulta de Avaliação',
    };
  } else if (nicheLower.includes('restaur') || nicheLower.includes('pizza') || nicheLower.includes('comida') || nicheLower.includes('hamburguer')) {
    theme = {
      primaryBg: 'bg-amber-950',
      primaryText: 'text-amber-900',
      accentColor: 'text-amber-500',
      badgeBg: 'bg-amber-50 text-amber-800 border-amber-200',
      heroTag: 'Gastronomia, Sabor & Experiência Única',
      heroTitle: `Sabores inesquecíveis na ${lead.name}`,
      heroSubtitle: `Ingredientes selecionados, receitas autênticas e ambiente acolhedor para momentos especiais em ${lead.city}.`,
      services: [
        { title: 'Cardápio Exclusivo', desc: 'Pratos elaborados por chefs apaixonados pela culinária autêntica.' },
        { title: 'Delivery Rápido & Quentinho', desc: 'Receba nossos sabores no conforto da sua casa com agilidade.' },
        { title: 'Ambiente Familiar & Eventos', desc: 'Espaço aconchegante para confraternizações, aniversários e casais.' },
        { title: 'Bebidas & Sobremesas', desc: 'Carta especial de bebidas e sobremesas artesanais de dar água na boca.' },
      ],
      ctaButton: 'Ver Cardápio & Fazer Pedido',
    };
  } else if (nicheLower.includes('mecan') || nicheLower.includes('auto') || nicheLower.includes('oficina') || nicheLower.includes('carro')) {
    theme = {
      primaryBg: 'bg-slate-950',
      primaryText: 'text-slate-900',
      accentColor: 'text-blue-500',
      badgeBg: 'bg-blue-50 text-blue-800 border-blue-200',
      heroTag: 'Mecânica de Confiança & Alta Precisão',
      heroTitle: `Seu veículo em mãos de especialistas na ${lead.name}`,
      heroSubtitle: `Diagnóstico computadorizado, peças originais e garantia em todos os serviços automotivos em ${lead.city}.`,
      services: [
        { title: 'Revisão Preventiva Geral', desc: 'Mais de 40 itens inspecionados para a total segurança da sua família.' },
        { title: 'Injeção Eletrônica & Motor', desc: 'Diagnóstico computadorizado rápido com scanners de última geração.' },
        { title: 'Freios, Suspensão & Pneus', desc: 'Alinhamento 3D, balanceamento e manutenção de sistemas de frenagem.' },
        { title: 'Ar-Condicionado & Elétrica', desc: 'Higienização com ozônio, recarga de gás e reparos elétricos completos.' },
      ],
      ctaButton: 'Solicitar Orçamento Rápido',
    };
  }

  return (
    <div className="w-full bg-white text-neutral-800 font-sans selection:bg-amber-100 selection:text-neutral-900">
      {/* 1. Barra de Aviso Superior (Demonstração Provisória) */}
      <div className="bg-neutral-900 text-neutral-200 px-4 py-2 text-center text-xs flex items-center justify-center gap-2 border-b border-neutral-800">
        <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <span>
          Prévia Oficial de Demonstração criada para <strong>{lead.name}</strong> ({lead.niche} em {lead.city}/{lead.state})
        </span>
      </div>

      {/* 2. Top Header / Navbar da Loja */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-neutral-200/80 px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-neutral-900 text-white flex items-center justify-center font-bold text-sm shadow-xs">
            {lead.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-neutral-900 leading-tight">
              {lead.name}
            </h1>
            <span className="text-[11px] text-neutral-500 flex items-center gap-1 font-medium">
              <MapPin className="h-3 w-3 text-neutral-400" />
              {lead.city}, {lead.state}
            </span>
          </div>
        </div>

        {/* Links de navegação */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-neutral-600">
          <a href="#sobre" className="hover:text-neutral-900 transition-colors">Sobre</a>
          <a href="#servicos" className="hover:text-neutral-900 transition-colors">Serviços</a>
          <a href="#avaliacoes" className="hover:text-neutral-900 transition-colors">Avaliações ({lead.reviews_count})</a>
          <a href="#localizacao" className="hover:text-neutral-900 transition-colors">Onde Estamos</a>
        </nav>

        {/* Botão de Contato WhatsApp */}
        {waUrl && (
          <a
            href={waUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors shadow-2xs cursor-pointer"
          >
            <MessageCircle className="h-4 w-4" />
            <span className="hidden sm:inline">WhatsApp Direto</span>
            <span className="sm:hidden">Conversar</span>
          </a>
        )}
      </header>

      {/* 3. Hero Section com Banner e Reputação do Google */}
      <section className="relative overflow-hidden bg-gradient-to-b from-neutral-50 to-white py-12 sm:py-20 px-4 sm:px-8 border-b border-neutral-100">
        <div className="max-w-4xl mx-auto text-center space-y-5">
          {/* Badge de Reputação Real do Google */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border bg-white shadow-2xs text-xs font-semibold">
            <span className="flex items-center gap-1 text-amber-500 font-bold">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              {(typeof lead.rating === 'number' ? lead.rating : 0).toFixed(1)} no Google Maps
            </span>
            <span className="text-neutral-300">·</span>
            <span className="text-neutral-600 font-medium">
              Mais de {lead.reviews_count ?? 0} clientes satisfeitos
            </span>
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 ml-1" />
          </div>

          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold text-neutral-900 tracking-tight leading-tight max-w-3xl mx-auto">
            {theme.heroTitle}
          </h2>

          <p className="text-sm sm:text-base text-neutral-600 max-w-2xl mx-auto leading-relaxed">
            {theme.heroSubtitle}
          </p>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            {waUrl && (
              <a
                href={waUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white font-bold text-sm transition-all shadow-md hover:shadow-lg cursor-pointer"
              >
                <MessageCircle className="h-4 w-4 text-emerald-400" />
                <span>{theme.ctaButton}</span>
                <ArrowRight className="h-4 w-4 text-neutral-400" />
              </a>
            )}

            <a
              href="#servicos"
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-3.5 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-700 font-semibold text-sm transition-colors"
            >
              Conhecer Nossos Serviços
            </a>
          </div>

          {/* Micro diferenciais */}
          <div className="pt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
            <div className="p-3 bg-white rounded-xl border border-neutral-200/80 shadow-2xs">
              <div className="text-base font-bold text-neutral-900 font-mono">100%</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">Atendimento local</div>
            </div>
            <div className="p-3 bg-white rounded-xl border border-neutral-200/80 shadow-2xs">
              <div className="text-base font-bold text-amber-600 font-mono">★ {(typeof lead.rating === 'number' ? lead.rating : 0).toFixed(1)}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">Nota média Google</div>
            </div>
            <div className="p-3 bg-white rounded-xl border border-neutral-200/80 shadow-2xs">
              <div className="text-base font-bold text-neutral-900 font-mono">+{lead.reviews_count ?? 0}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">Avaliações públicas</div>
            </div>
            <div className="p-3 bg-white rounded-xl border border-neutral-200/80 shadow-2xs">
              <div className="text-base font-bold text-emerald-600 font-mono">Rápido</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">Resposta WhatsApp</div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Serviços em Destaque */}
      <section id="servicos" className="py-12 sm:py-16 px-4 sm:px-8 max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
            Nossas Especialidades
          </span>
          <h3 className="text-xl sm:text-2xl font-bold text-neutral-900">
            O que oferecemos na {lead.name}
          </h3>
          <p className="text-xs sm:text-sm text-neutral-500 max-w-xl mx-auto">
            Serviços executados com o mais alto padrão de qualidade para superar suas expectativas.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {theme.services.map((serv, i) => (
            <div
              key={i}
              className="p-5 rounded-2xl border border-neutral-200 bg-neutral-50/50 hover:bg-white hover:border-neutral-300 hover:shadow-md transition-all space-y-2"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-neutral-900 text-white">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <h4 className="font-bold text-neutral-900 text-sm">{serv.title}</h4>
              </div>
              <p className="text-xs text-neutral-600 leading-relaxed pl-10">
                {serv.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Depoimentos e Prova Social do Google Maps */}
      <section id="avaliacoes" className="bg-neutral-900 text-white py-12 sm:py-16 px-4 sm:px-8">
        <div className="max-w-4xl mx-auto space-y-8 text-center">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-amber-300 text-xs font-semibold">
              <Award className="h-3.5 w-3.5" />
              <span>Reconhecimento dos Clientes</span>
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-white">
              O que dizem sobre a {lead.name}
            </h3>
            <p className="text-xs text-neutral-400">
              Comentários e avaliações públicas deixadas por clientes no Google Maps.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
            <div className="p-5 rounded-xl bg-neutral-800 border border-neutral-700 space-y-3">
              <div className="flex items-center gap-1 text-amber-400">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-amber-400" />
                ))}
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed italic">
                "Excelente atendimento! Super profissionais, pontuais e atenciosos. Recomendo de olhos fechados em {lead.city}."
              </p>
              <div className="pt-2 border-t border-neutral-700 text-[11px] text-neutral-400 flex items-center justify-between">
                <span className="font-semibold text-neutral-200">Cliente Verificado</span>
                <span>Google Reviews</span>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-neutral-800 border border-neutral-700 space-y-3">
              <div className="flex items-center gap-1 text-amber-400">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-amber-400" />
                ))}
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed italic">
                "Melhor experiência que tive no segmento de {lead.niche}. O cuidado e a qualidade do serviço são impecáveis!"
              </p>
              <div className="pt-2 border-t border-neutral-700 text-[11px] text-neutral-400 flex items-center justify-between">
                <span className="font-semibold text-neutral-200">Cliente Recorrente</span>
                <span>Google Reviews</span>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-neutral-800 border border-neutral-700 space-y-3">
              <div className="flex items-center gap-1 text-amber-400">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-amber-400" />
                ))}
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed italic">
                "Ambiente agradável e equipe nota 10. Dá para ver a dedicação em cada detalhe. Parabéns pelo trabalho!"
              </p>
              <div className="pt-2 border-t border-neutral-700 text-[11px] text-neutral-400 flex items-center justify-between">
                <span className="font-semibold text-neutral-200">Morador Local</span>
                <span>Google Reviews</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Localização & Contato */}
      <section id="localizacao" className="py-12 sm:py-16 px-4 sm:px-8 max-w-5xl mx-auto">
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/50 p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                Fácil Acesso
              </span>
              <h3 className="text-xl font-bold text-neutral-900 mt-1">
                Venha nos visitar em {lead.city}
              </h3>
              <p className="text-xs text-neutral-600 mt-1 flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-rose-500 shrink-0" />
                <span>{lead.address || `${lead.city} - ${lead.state}`}</span>
              </p>
            </div>

            {lead.maps_url && (
              <a
                href={lead.maps_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-100 text-xs font-semibold text-neutral-800 transition-colors shadow-2xs self-start sm:self-auto cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Abrir no Google Maps</span>
              </a>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-neutral-200">
            <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-neutral-200">
              <Phone className="h-4 w-4 text-neutral-500" />
              <div>
                <div className="text-[11px] text-neutral-400">Telefone Direto</div>
                <div className="text-xs font-mono font-bold text-neutral-900">
                  {formatBrazilianPhone(lead.phone)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-neutral-200">
              <Clock className="h-4 w-4 text-neutral-500" />
              <div>
                <div className="text-[11px] text-neutral-400">Horário de Atendimento</div>
                <div className="text-xs font-medium text-neutral-900">
                  Segunda a Sábado · Atendimento com hora marcada
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Botão Flutuante do WhatsApp */}
      {waUrl && (
        <a
          href={waUrl}
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xl hover:scale-105 transition-all cursor-pointer"
          title="Fale Conosco pelo WhatsApp"
        >
          <MessageCircle className="h-5 w-5" />
          <span>Falar no WhatsApp</span>
        </a>
      )}

      {/* 8. Rodapé Oficial da Página */}
      <footer className="bg-neutral-950 text-neutral-400 py-8 px-4 text-center text-xs border-t border-neutral-900 space-y-2">
        <p className="font-semibold text-neutral-300">
          © {new Date().getFullYear()} {lead.name} · Todos os direitos reservados.
        </p>
        <p className="text-[11px] text-neutral-600">
          Página desenvolvida e gerenciada com a tecnologia ProspectaPlaces B2B.
        </p>
      </footer>
    </div>
  );
};
