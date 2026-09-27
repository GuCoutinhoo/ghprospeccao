import React, { useState } from 'react';
import {
  X,
  Monitor,
  Smartphone,
  ExternalLink,
  Copy,
  Check,
  Send,
  Sparkles,
  ArrowRight,
  Maximize2,
  CheckCircle2,
} from 'lucide-react';
import { Lead } from '../../types';
import { WebsiteMockupView } from './WebsiteMockupView';
import { api } from '../../lib/api';

interface MockupModalProps {
  lead: Lead;
  onClose: () => void;
  onLeadUpdated?: (lead: Lead) => void;
}

export const MockupModal: React.FC<MockupModalProps> = ({
  lead,
  onClose,
  onLeadUpdated,
}) => {
  const [deviceMode, setDeviceMode] = useState<'desktop' | 'mobile'>('desktop');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [statusUpdated, setStatusUpdated] = useState<boolean>(lead.pipeline_status === 'PRÉVIA CRIADA');

  const previewUrl = `${window.location.origin}/preview?leadId=${lead.id}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(previewUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleMarkAsPreviewCreated = async () => {
    try {
      const updated = await api.updateLead(lead.id, { pipeline_status: 'PRÉVIA CRIADA' });
      setStatusUpdated(true);
      if (onLeadUpdated) onLeadUpdated(updated);
    } catch (err) {
      console.error('Erro ao atualizar status do lead:', err);
    }
  };

  const handleSendViaWhatsApp = () => {
    if (!lead.phone) return;
    const clean = lead.phone.replace(/\D/g, '');
    const fullNumber = clean.startsWith('55') ? clean : `55${clean}`;
    const text = `Olá! Vi o trabalho de excelência da *${lead.name}* no Google Maps (${lead.rating.toFixed(1)} estrelas).
Como vocês não têm site institucional para transformar buscas em agendamentos, preparei uma prévia interativa exclusiva de como a página de vocês ficaria:

👉 Acesse aqui: ${previewUrl}

Dá uma olhada no celular e me conta o que achou!`;

    const url = `https://wa.me/${fullNumber}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950/85 backdrop-blur-md overflow-hidden">
      {/* Barra Superior do Vendedor */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-4 sm:px-6 py-3 flex items-center justify-between text-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
              <span>Mockup Visual da Loja: {lead.name}</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300">
                {lead.niche}
              </span>
            </h3>
            <p className="text-[11px] text-neutral-400 hidden sm:block">
              Simulação de site moderno e responsivo focada em conversão direta no WhatsApp
            </p>
          </div>
        </div>

        {/* Alternador de Dispositivo (Desktop / Celular) */}
        <div className="flex items-center gap-1 bg-neutral-800 p-1 rounded-xl border border-neutral-700">
          <button
            type="button"
            onClick={() => setDeviceMode('desktop')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              deviceMode === 'desktop'
                ? 'bg-neutral-700 text-white font-bold shadow-xs'
                : 'text-neutral-400 hover:text-white'
            }`}
            title="Visualização Computador"
          >
            <Monitor className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Desktop</span>
          </button>

          <button
            type="button"
            onClick={() => setDeviceMode('mobile')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              deviceMode === 'mobile'
                ? 'bg-neutral-700 text-white font-bold shadow-xs'
                : 'text-neutral-400 hover:text-white'
            }`}
            title="Visualização Celular"
          >
            <Smartphone className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Mobile (iPhone)</span>
          </button>
        </div>

        {/* Ações do Vendedor: Copiar Link, WhatsApp, Marcar Pipeline, Fechar */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyLink}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition-colors cursor-pointer"
            title="Copiar Link para enviar ao prospect"
          >
            {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{copiedLink ? 'Link Copiado!' : 'Copiar Link'}</span>
          </button>

          {lead.phone && (
            <button
              type="button"
              onClick={handleSendViaWhatsApp}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-2xs cursor-pointer"
              title="Enviar prévia pelo WhatsApp"
            >
              <Send className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Enviar no WhatsApp</span>
            </button>
          )}

          {!statusUpdated ? (
            <button
              type="button"
              onClick={handleMarkAsPreviewCreated}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600/80 hover:bg-blue-600 text-white text-xs font-medium transition-colors cursor-pointer hidden md:flex"
              title="Marcar no Funil de Vendas"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Salvar no Funil</span>
            </button>
          ) : (
            <span className="text-[11px] font-mono text-emerald-400 px-2 py-1 bg-emerald-950/60 rounded-md border border-emerald-800 hidden md:inline-flex items-center gap-1">
              <Check className="h-3 w-3" /> Prévia Criada
            </span>
          )}

          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
            title="Abrir em Nova Aba"
          >
            <Maximize2 className="h-4 w-4" />
          </a>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer ml-1"
            title="Fechar Prévia"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Área de Exibição / Viewport com Frame */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-6 flex items-start justify-center">
        {deviceMode === 'desktop' ? (
          /* Desktop Frame */
          <div className="w-full max-w-5xl rounded-2xl border border-neutral-700 bg-white shadow-2xl overflow-hidden mb-8">
            {/* Top Bar Navegador Fake */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-neutral-100 border-b border-neutral-200">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div className="h-3 w-3 rounded-full bg-amber-400" />
                <div className="h-3 w-3 rounded-full bg-emerald-400" />
              </div>
              <div className="flex-1 max-w-md mx-auto rounded-lg bg-white border border-neutral-200 px-3 py-1 text-xs text-neutral-600 font-mono truncate text-center flex items-center justify-center gap-1.5 shadow-2xs">
                <span className="text-emerald-600 font-bold">https://</span>
                <span>www.{lead.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com.br</span>
              </div>
            </div>

            {/* Conteúdo do Site */}
            <WebsiteMockupView lead={lead} isEmbed={true} />
          </div>
        ) : (
          /* Mobile Frame (iPhone Style) */
          <div className="w-full max-w-[390px] rounded-[44px] border-[10px] border-neutral-800 bg-black shadow-2xl overflow-hidden my-4">
            {/* Dynamic Island / Notch Fake */}
            <div className="bg-neutral-800 pt-3 pb-1 px-6 flex justify-between items-center text-white text-[10px] font-mono">
              <span>9:41</span>
              <div className="w-20 h-4 bg-black rounded-full" />
              <div className="flex items-center gap-1">
                <span>5G</span>
                <span>100%</span>
              </div>
            </div>

            {/* Conteúdo do Site no Mobile */}
            <div className="bg-white max-h-[750px] overflow-y-auto">
              <WebsiteMockupView lead={lead} isEmbed={true} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
