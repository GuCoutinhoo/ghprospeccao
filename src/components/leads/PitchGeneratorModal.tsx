import React, { useState } from 'react';
import {
  X,
  MessageCircle,
  Copy,
  Check,
  Send,
  Sparkles,
  Phone,
  HelpCircle,
  ExternalLink,
  ShieldCheck,
  User,
  Building,
  Flame,
  Instagram,
  Volume2,
} from 'lucide-react';
import { Lead } from '../../types';
import {
  generatePitches,
  COMMON_OBJECTIONS,
  PitchType,
  getInstagramSearchUrl,
} from '../../lib/pitch/pitchGenerator';

interface PitchGeneratorModalProps {
  lead: Lead;
  onClose: () => void;
  onOpenMockup?: () => void;
}

export const PitchGeneratorModal: React.FC<PitchGeneratorModalProps> = ({
  lead,
  onClose,
  onOpenMockup,
}) => {
  const [senderName, setSenderName] = useState<string>(() => {
    return localStorage.getItem('prospecta_sender_name') || 'Gustavo Santos';
  });
  const [agencyName, setAgencyName] = useState<string>(() => {
    return localStorage.getItem('prospecta_agency_name') || 'ProspectaPlaces Soluções Digitais';
  });

  const [activeTab, setActiveTab] = useState<PitchType | 'objections'>('mockup');
  const [copied, setCopied] = useState<boolean>(false);

  const pitches = generatePitches(lead, {
    senderName,
    agencyName,
    previewUrl: `${window.location.origin}/preview?leadId=${lead.id}`,
  });

  const activePitch = pitches.find((p) => p.type === activeTab) || pitches[0];

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenWhatsApp = (text: string) => {
    if (!lead.phone) return;
    const clean = lead.phone.replace(/\D/g, '');
    const fullNumber = clean.startsWith('55') ? clean : `55${clean}`;
    const url = `https://wa.me/${fullNumber}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const saveSettings = (name: string, agency: string) => {
    setSenderName(name);
    setAgencyName(agency);
    localStorage.setItem('prospecta_sender_name', name);
    localStorage.setItem('prospecta_agency_name', agency);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/70 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-neutral-200 overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-neutral-900 text-white border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-400/20 text-amber-300 border border-amber-400/30">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Gerador de Scripts & Pitches de Alta Conversão</span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Dados Reais
                </span>
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Prospecção para <strong className="text-neutral-200">{lead.name}</strong> ({lead.niche} em {lead.city} - {lead.state})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
            aria-label="Fechar modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Barra de Personalização do Remetente */}
        <div className="bg-neutral-50 px-6 py-2.5 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 text-neutral-600">
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-neutral-400" />
              <span>Seu Nome:</span>
              <input
                type="text"
                value={senderName}
                onChange={(e) => saveSettings(e.target.value, agencyName)}
                className="bg-white px-2 py-0.5 border border-neutral-300 rounded text-neutral-900 font-medium text-xs focus:outline-hidden focus:border-neutral-900"
                placeholder="Ex: Gustavo Santos"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <Building className="h-3.5 w-3.5 text-neutral-400" />
              <span>Sua Agência:</span>
              <input
                type="text"
                value={agencyName}
                onChange={(e) => saveSettings(senderName, e.target.value)}
                className="bg-white px-2 py-0.5 border border-neutral-300 rounded text-neutral-900 font-medium text-xs focus:outline-hidden focus:border-neutral-900"
                placeholder="Ex: ProspectaPlaces"
              />
            </div>
          </div>

          {onOpenMockup && (
            <button
              type="button"
              onClick={onOpenMockup}
              className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
            >
              <ExternalLink className="h-3 w-3" />
              <span>Ver Prévia do Site da Loja</span>
            </button>
          )}
        </div>

        {/* Abas dos Tipos de Pitch */}
        <div className="flex items-center gap-1.5 px-6 pt-3 border-b border-neutral-200 bg-white overflow-x-auto">
          {pitches.map((p) => {
            const isActive = activeTab === p.type;
            return (
              <button
                key={p.type}
                onClick={() => setActiveTab(p.type)}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'border-neutral-900 text-neutral-900 bg-neutral-100/70'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50'
                }`}
              >
                {p.type === 'niche_specialized' && <Sparkles className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />}
                {p.type === 'mockup' && <Flame className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />}
                {p.type === 'instagram_direct' && <Instagram className="h-3.5 w-3.5 text-pink-500" />}
                {p.type === 'audio_script' && <Volume2 className="h-3.5 w-3.5 text-amber-500" />}
                {p.type === 'call' && <Phone className="h-3.5 w-3.5 text-blue-500" />}
                {p.type !== 'mockup' && p.type !== 'niche_specialized' && p.type !== 'instagram_direct' && p.type !== 'audio_script' && p.type !== 'call' && (
                  <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />
                )}
                <span>{p.title.split('(')[0]}</span>
              </button>
            );
          })}

          <button
            onClick={() => setActiveTab('objections')}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-all cursor-pointer whitespace-nowrap ml-auto ${
              activeTab === 'objections'
                ? 'border-rose-600 text-rose-700 bg-rose-50'
                : 'border-transparent text-neutral-500 hover:text-rose-700 hover:bg-rose-50/50'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5 text-rose-500" />
            <span>Guia de Objeções</span>
          </button>
        </div>

        {/* Conteúdo do Pitch Ativo */}
        <div className="p-6 bg-neutral-50/50">
          {activeTab !== 'objections' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-neutral-200 text-xs">
                <div>
                  <h4 className="font-bold text-neutral-900">{activePitch.title}</h4>
                  <p className="text-neutral-500 mt-0.5">{activePitch.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(activePitch.text)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-700 font-medium text-xs transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copied ? 'Copiado!' : 'Copiar Texto'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      handleCopy(activePitch.text);
                      window.open(getInstagramSearchUrl(lead.name, lead.city), '_blank');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-700 text-white font-semibold text-xs transition-colors shadow-2xs cursor-pointer"
                    title="Copia o texto e abre o Instagram para mandar Direct"
                  >
                    <Instagram className="h-3.5 w-3.5" />
                    <span>Abrir Direct</span>
                  </button>

                  {lead.phone && (
                    <button
                      type="button"
                      onClick={() => handleOpenWhatsApp(activePitch.text)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors shadow-2xs cursor-pointer"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>Abrir no WhatsApp</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Caixa de Texto do Script Formatado */}
              <div className="relative rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs font-mono text-xs text-neutral-800 leading-relaxed whitespace-pre-wrap selection:bg-amber-100 max-h-96 overflow-y-auto">
                {activePitch.text}
              </div>

              <div className="flex items-center justify-between text-[11px] text-neutral-400">
                <span>Dica: Os trechos entre asteriscos (*) aparecem em <strong>negrito</strong> no WhatsApp.</span>
                <span>Telefone de destino: <strong>{lead.phone || 'Sem telefone'}</strong></span>
              </div>
            </div>
          ) : (
            /* Guia de Objeções */
            <div className="space-y-3">
              <div className="p-3 bg-white rounded-xl border border-neutral-200 text-xs">
                <h4 className="font-bold text-neutral-900 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-rose-500" />
                  <span>Respostas Prontas para as 4 Maiores Objeções dos Comércios Locais</span>
                </h4>
                <p className="text-neutral-500 mt-0.5">
                  Quando o cliente responder com dúvidas ou resistência, use estes argumentos testados:
                </p>
              </div>

              <div className="space-y-3">
                {COMMON_OBJECTIONS.map((obj, i) => (
                  <div key={i} className="p-4 rounded-xl border border-neutral-200 bg-white shadow-2xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                        {obj.objection}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(obj.rebuttal)}
                        className="text-[11px] text-neutral-500 hover:text-neutral-900 flex items-center gap-1 font-medium cursor-pointer"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Copiar Resposta</span>
                      </button>
                    </div>
                    <p className="text-xs text-neutral-700 leading-relaxed">
                      👉 <strong>Como responder:</strong> {obj.rebuttal}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="px-6 py-3 bg-white border-t border-neutral-200 flex items-center justify-between text-xs text-neutral-500">
          <span>Otimizado para WhatsApp Web e Mobile</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-neutral-200 text-neutral-700 hover:bg-neutral-100 font-medium transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
