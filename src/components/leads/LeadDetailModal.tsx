import React, { useState, useEffect } from 'react';
import {
  X,
  ExternalLink,
  MessageCircle,
  Copy,
  Check,
  MapPin,
  Phone,
  Globe,
  Sparkles,
  Send,
  Star,
  FileText,
  CheckCircle2,
  Navigation,
  Compass,
  Store,
  Scissors,
  Stethoscope,
  Zap,
  Wrench,
  Utensils,
  Car,
  Home,
  Clock,
  Eye,
  Smartphone,
  ShieldCheck,
  Heart,
  Printer,
  Flame,
  Award,
  Maximize2,
  Trash2,
  RotateCw,
} from 'lucide-react';
import { Lead, LeadNote, PipelineStatus } from '../../types';
import { api } from '../../lib/api';
import { calculateLeadScore, getScoreColorClass } from '../../lib/scoring/leadScore';
import { formatBrazilianPhone, getWhatsAppUrl } from '../../utils/whatsapp';
import { PitchGeneratorModal } from './PitchGeneratorModal';
import { MockupModal } from '../preview/MockupModal';
import { DigitalAuditModal } from '../audit/DigitalAuditModal';
import { WebsiteMockupView } from '../preview/WebsiteMockupView';
import { generatePitches, COMMON_OBJECTIONS, PitchType } from '../../lib/pitch/pitchGenerator';
import { generateAuditReport } from '../../lib/audit/auditReport';

interface LeadDetailModalProps {
  leadId: string;
  onClose: () => void;
  onLeadUpdated: (updated: Lead) => void;
  onDeleteLead?: (leadId: string) => void;
}

const PIPELINE_STATUSES: PipelineStatus[] = [
  'NOVO',
  'PRÉVIA CRIADA',
  'CONTATADO',
  'RESPONDEU',
  'INTERESSADO',
  'FOLLOW_UP',
  'NEGOCIACAO',
  'REUNIÃO',
  'PROPOSTA',
  'FECHADO',
  'PERDIDO',
  'NAO_INTERESSADO',
  'SEM_RESPOSTA',
];

// Ícones por nicho para dar identidade visual à loja
function getNicheIcon(niche: string) {
  const n = niche.toLowerCase();
  if (n.includes('barbearia') || n.includes('cabelo') || n.includes('salao')) return Scissors;
  if (n.includes('odonto') || n.includes('dent') || n.includes('clinica')) return Stethoscope;
  if (n.includes('eletri') || n.includes('solar') || n.includes('energia')) return Zap;
  if (n.includes('mecan') || n.includes('oficina') || n.includes('auto')) return Wrench;
  if (n.includes('restaur') || n.includes('pizza') || n.includes('comida')) return Utensils;
  if (n.includes('imobil')) return Home;
  return Store;
}

export const LeadDetailModal: React.FC<LeadDetailModalProps> = ({
  leadId,
  onClose,
  onLeadUpdated,
  onDeleteLead,
}) => {
  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [newNote, setNewNote] = useState<string>('');
  const [submittingNote, setSubmittingNote] = useState<boolean>(false);
  const [copiedPhone, setCopiedPhone] = useState<boolean>(false);
  const [copiedAddress, setCopiedAddress] = useState<boolean>(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Tabs do modal: 'loja' (vitrine e mapas), 'mockup' (prévia do site), 'pitch' (scripts), 'audit' (diagnóstico), 'notas'
  const [activeTab, setActiveTab] = useState<'loja' | 'mockup' | 'pitch' | 'audit' | 'notas'>('loja');
  const [openFullMockup, setOpenFullMockup] = useState<boolean>(false);
  const [openFullPitch, setOpenFullPitch] = useState<boolean>(false);
  const [openFullAudit, setOpenFullAudit] = useState<boolean>(false);

  useEffect(() => {
    async function loadData() {
      try {
        const res = await api.getLeadById(leadId);
        setLead(res.lead);
        setNotes(res.notes);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [leadId]);

  const handleStatusChange = async (newStatus: PipelineStatus) => {
    if (!lead) return;
    try {
      const updated = await api.updateLead(lead.id, {
        pipeline_status: newStatus,
        contacted_at: newStatus === 'CONTATADO' ? new Date().toISOString() : lead.contacted_at,
      });
      setLead(updated);
      onLeadUpdated(updated);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRegisterContact = async (channel: string = 'WhatsApp') => {
    if (!lead) return;
    try {
      const res = await api.registerContactAttempt(lead.id, channel);
      if (res?.lead) {
        setLead(res.lead);
        onLeadUpdated(res.lead);
      }
    } catch (err) {
      console.error('Erro ao registrar contato:', err);
    }
  };

  const handleRegisterResponse = async () => {
    if (!lead) return;
    try {
      const updated = await api.updateLead(lead.id, {
        pipeline_status: 'RESPONDEU',
        response_at: new Date().toISOString(),
      });
      setLead(updated);
      onLeadUpdated(updated);
    } catch (err) {
      console.error('Erro ao registrar resposta:', err);
    }
  };

  const handleRegisterFollowUp = async () => {
    if (!lead) return;
    try {
      const updated = await api.updateLead(lead.id, {
        pipeline_status: 'FOLLOW_UP',
        follow_up_at: new Date().toISOString(),
      });
      setLead(updated);
      onLeadUpdated(updated);
    } catch (err) {
      console.error('Erro ao registrar follow-up:', err);
    }
  };

  const handleRegisterNegotiation = async () => {
    if (!lead) return;
    try {
      const updated = await api.updateLead(lead.id, {
        pipeline_status: 'NEGOCIACAO',
        negotiation_at: new Date().toISOString(),
      });
      setLead(updated);
      onLeadUpdated(updated);
    } catch (err) {
      console.error('Erro ao iniciar negociação:', err);
    }
  };

  const handleRegisterSale = async () => {
    if (!lead) return;
    const valStr = prompt('Informe o valor total do contrato fechado (R$):', '1500');
    if (valStr === null) return;
    const value = parseFloat(valStr.replace(',', '.')) || 0;
    try {
      const res = await api.registerSale(lead.id, value);
      if (res?.lead) {
        setLead(res.lead);
        onLeadUpdated(res.lead);
        alert(`Venda fechada de R$ ${value.toFixed(2)} registrada com sucesso no sistema!`);
      }
    } catch (err) {
      console.error('Erro ao registrar venda:', err);
    }
  };

  const handleToggleFavorite = async () => {
    if (!lead) return;
    try {
      const updated = await api.toggleLeadFavorite(lead.id);
      setLead(updated);
      onLeadUpdated(updated);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead || !newNote.trim()) return;

    setSubmittingNote(true);
    try {
      const note = await api.addLeadNote(lead.id, newNote.trim());
      setNotes((prev) => [note, ...prev]);
      setNewNote('');
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingNote(false);
    }
  };

  const copyPhoneToClipboard = () => {
    if (!lead?.phone) return;
    navigator.clipboard.writeText(lead.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const copyAddressToClipboard = () => {
    if (!lead?.address) return;
    navigator.clipboard.writeText(lead.address);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleDeleteLead = () => {
    setShowConfirmDelete(true);
  };

  const handleExecuteDelete = async () => {
    if (!lead || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteLead(lead.id);
      if (onDeleteLead) onDeleteLead(lead.id);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao excluir lead.';
      console.error('Erro ao excluir lead:', err);
      setDeleteError(msg);
      setIsDeleting(false);
    }
  };

  if (loading && !lead) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-xs p-4">
        <div className="rounded-xl bg-white p-6 shadow-xl text-xs text-neutral-500">
          Carregando informações da loja...
        </div>
      </div>
    );
  }

  if (!lead) return null;

  const scoreInfo = calculateLeadScore({
    website_status: lead.website_status,
    website: lead.website,
    phone: lead.phone,
    rating: lead.rating,
    reviews_count: lead.reviews_count,
  });

  const { badgeBg } = getScoreColorClass(lead.lead_score);
  const waUrl = getWhatsAppUrl(lead.phone, lead.name, lead.niche);
  const NicheIcon = getNicheIcon(lead.niche);

  // URL do Google Maps oficial e Embed interativo
  const mapsSearchUrl = lead.maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lead.name} ${lead.address || `${lead.city} ${lead.state}`}`)}`;
  const mapsEmbedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(`${lead.name}, ${lead.address || `${lead.city} - ${lead.state}`}`)}&t=&z=15&ie=UTF8&iwloc=&output=embed`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 backdrop-blur-xs p-3 sm:p-5 overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl border border-neutral-200 bg-white shadow-2xl my-auto overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Banner Vitrine da Loja */}
        <div className="relative bg-gradient-to-r from-neutral-900 via-neutral-850 to-neutral-900 text-white p-6 overflow-hidden">
          {/* Luz de fundo sutil */}
          <div className="absolute -right-10 -bottom-10 h-48 w-48 rounded-full bg-emerald-500/10 blur-2xl pointer-events-none" />
          
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {/* Avatar da Loja com Ícone Temático */}
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/10 border border-white/15 text-white backdrop-blur-xs shadow-md shrink-0">
                <NicheIcon className="h-7 w-7 text-amber-400" />
              </div>

              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                    {lead.name}
                  </h2>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Ativa no Google
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-300">
                  <span className="font-medium text-white">{lead.niche}</span>
                  <span aria-hidden="true" className="text-neutral-500">·</span>
                  <span className="flex items-center gap-1 text-neutral-300">
                    <MapPin className="h-3 w-3 text-neutral-400" />
                    {lead.city} - {lead.state}
                  </span>
                  <span aria-hidden="true" className="text-neutral-500">·</span>
                  <span className="text-amber-300 font-semibold flex items-center gap-1">
                    ★ {lead.rating.toFixed(1)}
                    <span className="text-neutral-400 font-normal">({lead.reviews_count} avaliações)</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start">
              <button
                type="button"
                onClick={handleToggleFavorite}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all border shadow-xs cursor-pointer ${
                  lead.is_favorite
                    ? 'bg-rose-500/20 text-rose-200 border-rose-500/40 hover:bg-rose-500/30'
                    : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                }`}
                title={lead.is_favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              >
                <Heart className={`h-3.5 w-3.5 ${lead.is_favorite ? 'fill-rose-400 text-rose-400' : 'text-neutral-300'}`} />
                <span>{lead.is_favorite ? 'Favoritado' : 'Favoritar'}</span>
              </button>

              <button
                type="button"
                onClick={handleDeleteLead}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 cursor-pointer shadow-xs"
                title="Excluir lead permanentemente"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Excluir</span>
              </button>

              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-white text-neutral-900 shadow-sm`}
              >
                Lead Score {lead.lead_score}/100
              </span>
              <button
                onClick={onClose}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Abas Superiores do Modal */}
          <div className="flex items-center gap-1.5 mt-6 -mb-6 border-b border-white/10 pt-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab('loja')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'loja'
                  ? 'border-white text-white font-semibold'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Store className="h-3.5 w-3.5" />
              <span>Vitrine & Maps</span>
            </button>

            <button
              onClick={() => setActiveTab('mockup')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'mockup'
                  ? 'border-amber-400 text-amber-300 font-semibold'
                  : 'border-transparent text-neutral-400 hover:text-amber-200'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span>⚡ Mockup do Site</span>
            </button>

            <button
              onClick={() => setActiveTab('pitch')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'pitch'
                  ? 'border-emerald-400 text-emerald-300 font-semibold'
                  : 'border-transparent text-neutral-400 hover:text-emerald-200'
              }`}
            >
              <Flame className="h-3.5 w-3.5 text-emerald-400" />
              <span>🎯 Scripts de Pitch</span>
            </button>

            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'audit'
                  ? 'border-blue-400 text-blue-300 font-semibold'
                  : 'border-transparent text-neutral-400 hover:text-blue-200'
              }`}
            >
              <FileText className="h-3.5 w-3.5 text-blue-400" />
              <span>📊 Diagnóstico PDF</span>
            </button>

            <button
              onClick={() => setActiveTab('notas')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'notas'
                  ? 'border-white text-white font-semibold'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Histórico ({notes.length})</span>
            </button>
          </div>
        </div>

        {/* Barra de Ações Rápidas em Destaque */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-neutral-100 bg-neutral-50/80">
          <div className="flex flex-wrap items-center gap-2">
            {/* 3 FERRAMENTAS DE ALTO IMPACTO */}
            <button
              type="button"
              onClick={() => setOpenFullPitch(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 transition-colors shadow-2xs cursor-pointer"
              title="Gerador de Scripts e Pitches para WhatsApp e Ligação"
            >
              <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
              <span>Gerar Pitch</span>
            </button>

            <button
              type="button"
              onClick={() => setOpenFullMockup(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors shadow-2xs cursor-pointer"
              title="Ver Mockup Online Interativo (Computador / Celular)"
            >
              <Smartphone className="h-3.5 w-3.5 text-amber-600" />
              <span>Ver Mockup Online</span>
            </button>

            <button
              type="button"
              onClick={() => setOpenFullAudit(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-800 bg-blue-50 border border-blue-300 rounded-lg hover:bg-blue-100 transition-colors shadow-2xs cursor-pointer"
              title="Auditoria Digital e Laudo Executivo em PDF"
            >
              <Printer className="h-3.5 w-3.5 text-blue-600" />
              <span>Auditoria em PDF</span>
            </button>

            <div className="h-4 w-px bg-neutral-300 mx-1 hidden sm:block" />

            {/* Botão Ver no Google Maps com destaque visual */}
            <a
              href={mapsSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-800 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-all shadow-2xs group"
            >
              <Compass className="h-3.5 w-3.5 text-red-500 group-hover:scale-110 transition-transform" />
              <span>Google Maps</span>
              <ExternalLink className="h-3 w-3 text-neutral-400" />
            </a>

            {/* Botão WhatsApp Comercial */}
            {waUrl ? (
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-2xs"
              >
                <MessageCircle className="h-3.5 w-3.5 fill-white" />
                <span>WhatsApp</span>
              </a>
            ) : null}

            {/* Botão Copiar Telefone */}
            {lead.phone && (
              <button
                onClick={copyPhoneToClipboard}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors shadow-2xs"
              >
                {copiedPhone ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-emerald-700 font-semibold">Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-neutral-500" />
                    <span>Copiar Telefone</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Seletor de Status Comercial */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500 font-medium">Status:</span>
            <select
              value={lead.pipeline_status}
              onChange={(e) => handleStatusChange(e.target.value as PipelineStatus)}
              className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-bold text-neutral-900 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
            >
              {PIPELINE_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>

            {/* Ações Rápidas de Esteira com Auditoria */}
            <div className="flex items-center gap-1.5 ml-auto flex-wrap">
              <button
                type="button"
                onClick={() => handleRegisterContact('WhatsApp')}
                className="px-2.5 py-1 text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
                title="Registrar tentativa de contato neste lead"
              >
                + Contato ({lead.contact_attempts_count || (lead.contacted_at ? 1 : 0)})
              </button>

              <button
                type="button"
                onClick={handleRegisterResponse}
                className="px-2.5 py-1 text-[11px] font-semibold bg-sky-50 text-sky-800 border border-sky-200 rounded-lg hover:bg-sky-100 transition-colors cursor-pointer"
                title="Registrar que o cliente respondeu à abordagem"
              >
                + Respondeu
              </button>

              <button
                type="button"
                onClick={handleRegisterFollowUp}
                className="px-2.5 py-1 text-[11px] font-semibold bg-purple-50 text-purple-800 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors cursor-pointer"
                title="Agendar ou registrar follow-up"
              >
                + Follow-up
              </button>

              <button
                type="button"
                onClick={handleRegisterNegotiation}
                className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors cursor-pointer"
                title="Mover para fase de negociação"
              >
                + Negociação
              </button>

              <button
                type="button"
                onClick={handleRegisterSale}
                className="px-2.5 py-1 text-[11px] font-bold bg-amber-400 hover:bg-amber-300 text-neutral-950 rounded-lg transition-colors cursor-pointer shadow-2xs"
                title="Registrar venda fechada com valor em R$"
              >
                ★ Venda Fechada
              </button>
            </div>
          </div>
        </div>

        {/* Conteúdo por Abas */}
        <div className="p-6 max-h-[65vh] overflow-y-auto space-y-6">
          {/* ABA 1: VITRINE DA LOJA & MAPS */}
          {activeTab === 'loja' && (
            <div className="space-y-6">
              {/* Alerta de Diagnóstico Comercial */}
              {!lead.website ? (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/60 p-4">
                  <div className="rounded-lg bg-amber-100 p-2 text-amber-800 shrink-0">
                    <Globe className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                      Oportunidade Comercial: Loja Sem Website Cadastrado
                    </h4>
                    <p className="text-xs text-amber-800 leading-relaxed">
                      Esta empresa já construiu autoridade no Google Maps (nota <strong>{lead.rating.toFixed(1)}</strong> com <strong>{lead.reviews_count} clientes</strong>), mas não possui website cadastrado no Google Maps para apresentação institucional e agendamento.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-xl border border-blue-200/80 bg-blue-50/60 p-4">
                  <div className="rounded-lg bg-blue-100 p-2 text-blue-800 shrink-0">
                    <Globe className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-blue-900 uppercase tracking-wider">
                      Presença Web: Website Cadastrado
                    </h4>
                    <p className="text-xs text-blue-800 leading-relaxed">
                      A empresa possui o link cadastrado:{' '}
                      <a
                        href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold underline text-blue-900 hover:text-blue-700 break-all"
                      >
                        {lead.website}
                      </a>
                    </p>
                  </div>
                </div>
              )}

              {/* Grid: Cartão de Contato da Loja + Mapa Interativo Embutido */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Cartão de Informações Cadastrais */}
                <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
                    <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Store className="h-4 w-4 text-neutral-700" />
                      <span>Ficha da Loja</span>
                    </h3>
                    <span className="text-[11px] text-neutral-400 font-mono">Dados Verificados</span>
                  </div>

                  {/* Telefone em Destaque */}
                  <div className="rounded-lg bg-neutral-50 p-3.5 border border-neutral-150 space-y-1">
                    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                      Telefone Principal para Contato
                    </span>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-emerald-600" />
                        <span className="text-base font-bold text-neutral-900 font-mono">
                          {formatBrazilianPhone(lead.phone)}
                        </span>
                      </div>
                      {lead.phone && (
                        <a
                          href={`tel:${lead.phone.replace(/\D/g, '')}`}
                          className="text-[11px] font-semibold text-neutral-600 hover:text-neutral-900 underline"
                        >
                          Ligar
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Endereço Completo */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                      Localização Física
                    </span>
                    <div className="flex items-start justify-between gap-2 text-xs text-neutral-800">
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 text-neutral-400 shrink-0 mt-0.5" />
                        <span>{lead.address || `${lead.city} - ${lead.state}`}</span>
                      </div>
                      <button
                        onClick={copyAddressToClipboard}
                        className="p-1 text-neutral-400 hover:text-neutral-700 rounded hover:bg-neutral-100 transition-colors shrink-0"
                        title="Copiar endereço"
                      >
                        {copiedAddress ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Website da Empresa se houver */}
                  {lead.website && (
                    <div className="space-y-1 pt-2 border-t border-neutral-100">
                      <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                        Website Registrado
                      </span>
                      <div className="flex items-center justify-between text-xs">
                        <a
                          href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-blue-600 hover:text-blue-800 underline flex items-center gap-1.5 truncate max-w-[220px]"
                        >
                          <Globe className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{lead.website}</span>
                        </a>
                        <ExternalLink className="h-3 w-3 text-neutral-400" />
                      </div>
                    </div>
                  )}

                  {/* Avaliações do Google */}
                  <div className="space-y-1 pt-2 border-t border-neutral-100">
                    <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                      Reputação no Google Places
                    </span>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 text-amber-500">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={`h-4 w-4 ${
                              star <= Math.round(lead.rating)
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-neutral-200'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-xs font-bold text-neutral-900 font-mono">
                        {lead.rating.toFixed(1)}
                      </span>
                      <span className="text-xs text-neutral-500 font-mono">
                        ({lead.reviews_count} clientes avaliaram)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Mapa Interativo Embutido da Loja */}
                <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
                    <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Navigation className="h-4 w-4 text-red-500" />
                      <span>Localização no Google Maps</span>
                    </h3>
                    <a
                      href={mapsSearchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-neutral-600 hover:text-neutral-900 font-medium flex items-center gap-1"
                    >
                      <span>Abrir mapa completo</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  {/* Iframe Interativo do Mapa da Loja */}
                  <div className="relative w-full h-52 rounded-lg overflow-hidden border border-neutral-200 bg-neutral-100">
                    <iframe
                      title={`Mapa de ${lead.name}`}
                      width="100%"
                      height="100%"
                      loading="lazy"
                      allowFullScreen
                      referrerPolicy="no-referrer-when-downgrade"
                      src={mapsEmbedUrl}
                      className="w-full h-full border-0"
                    />
                  </div>

                  <a
                    href={mapsSearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-neutral-700 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-lg transition-colors"
                  >
                    <Compass className="h-3.5 w-3.5 text-red-500" />
                    <span>Ver fotos, horário e rotas no Google Maps</span>
                  </a>
                </div>
              </div>

              {/* Critérios do Lead Score Comercial */}
              <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
                  <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
                    Por que este estabelecimento é uma boa oportunidade?
                  </h3>
                  <span className="text-xs font-mono font-bold text-neutral-900">
                    {scoreInfo.score}/100 Pontos
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {scoreInfo.reasons.map((r, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between p-2.5 rounded-lg border text-xs ${
                        r.applied
                          ? 'border-emerald-200 bg-emerald-50/50 text-emerald-900'
                          : 'border-neutral-100 bg-neutral-50/50 text-neutral-400'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {r.applied ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                        ) : (
                          <div className="h-4 w-4 rounded-full border border-neutral-300 shrink-0" />
                        )}
                        <span className="font-medium truncate">{r.label}</span>
                      </span>
                      <span className="font-mono font-bold tabular-nums">
                        {r.applied ? `+${r.points}` : '0'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ABA 2: MOCKUP DO SITE (LANDING PAGE INTERATIVA) */}
          {activeTab === 'mockup' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-neutral-200 bg-amber-50/50">
                <div>
                  <h3 className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    <span>Prévia de Demonstração Personalizada para a Loja</span>
                  </h3>
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    Envie o link interativo direto para o proprietário da {lead.name} ver como ficaria sua presença online.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenFullMockup(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white font-bold text-xs hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    <span>Abrir em Tela Cheia / Dispositivos</span>
                  </button>
                </div>
              </div>

              {/* Prévia Embarcada do Site */}
              <div className="rounded-xl border border-neutral-300 overflow-hidden shadow-md max-h-[600px] overflow-y-auto">
                <WebsiteMockupView lead={lead} isEmbed={true} />
              </div>
            </div>
          )}

          {/* ABA 3: GERADOR DE PITCHES & SCRIPTS */}
          {activeTab === 'pitch' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl border border-neutral-200 bg-emerald-50/50">
                <div>
                  <h3 className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
                    <Flame className="h-4 w-4 text-emerald-600" />
                    <span>Scripts de Abordagem com Dados Reais da Loja</span>
                  </h3>
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    Pitches prontos baseados na nota ({lead.rating.toFixed(1)} ★) e {lead.reviews_count} avaliações reais do Google.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setOpenFullPitch(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors shadow-2xs cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Abrir Central de Pitches & Objeções</span>
                </button>
              </div>

              {/* Grid com os 3 Pitches de Destaque */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {generatePitches(lead).slice(0, 2).map((p, i) => (
                  <div key={i} className="p-4 rounded-xl border border-neutral-200 bg-white shadow-2xs space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-neutral-900">{p.title}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(p.text);
                          alert('Script copiado com sucesso!');
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-neutral-200 hover:bg-neutral-50 text-neutral-700 transition-colors cursor-pointer"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Copiar</span>
                      </button>
                    </div>

                    <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-100 font-mono text-[11px] text-neutral-700 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {p.text}
                    </div>

                    {lead.phone && (
                      <button
                        type="button"
                        onClick={() => {
                          const clean = lead.phone!.replace(/\D/g, '');
                          const fullNumber = clean.startsWith('55') ? clean : `55${clean}`;
                          window.open(`https://wa.me/${fullNumber}?text=${encodeURIComponent(p.text)}`, '_blank');
                        }}
                        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors cursor-pointer shadow-2xs"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>Enviar no WhatsApp</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ABA 4: AUDITORIA DIGITAL & LAUDO */}
          {activeTab === 'audit' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl border border-neutral-200 bg-blue-50/50">
                <div>
                  <h3 className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-blue-600" />
                    <span>Diagnóstico da Presença Digital & Oportunidades</span>
                  </h3>
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    Cálculo de oportunidades perdidas e plano de ação em PDF para a {lead.name}.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setOpenFullAudit(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-colors shadow-2xs cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Ver Laudo Completo / Salvar em PDF</span>
                </button>
              </div>

              {/* Resumo dos Indicadores da Auditoria */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl border border-neutral-200 bg-white shadow-2xs space-y-1">
                  <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
                    Saúde Digital
                  </span>
                  <div className="text-2xl font-black font-mono text-neutral-900">
                    {generateAuditReport(lead).overallScore}/100
                  </div>
                  <span className="text-xs font-semibold text-rose-600 block">
                    {generateAuditReport(lead).scoreLabel}
                  </span>
                </div>

                <div className="p-4 rounded-xl border border-neutral-200 bg-white shadow-2xs space-y-1">
                  <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
                    Perda de Contatos / Mês
                  </span>
                  <div className="text-2xl font-black font-mono text-rose-600">
                    ~{generateAuditReport(lead).estimatedMissedClicks} clientes
                  </div>
                  <span className="text-xs text-neutral-500 block">
                    Desistem por falta de site oficial
                  </span>
                </div>

                <div className="p-4 rounded-xl border border-neutral-200 bg-white shadow-2xs space-y-1">
                  <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
                    Perda Estimada em Vendas
                  </span>
                  <div className="text-lg font-black font-mono text-amber-600">
                    R$ {generateAuditReport(lead).estimatedRevenueLossMin.toLocaleString('pt-BR')} - {generateAuditReport(lead).estimatedRevenueLossMax.toLocaleString('pt-BR')}
                  </div>
                  <span className="text-xs text-neutral-500 block">
                    Por mês de faturamento não captado
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ABA 5: HISTÓRICO DE NOTAS */}
          {activeTab === 'notas' && (
            <div className="space-y-4">
              <form onSubmit={handleAddNote} className="space-y-2">
                <textarea
                  placeholder="Registre o que conversou com a loja (ex: 'Falei com o dono pelo WhatsApp, pediu para ligar amanhã às 14h')..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-neutral-200 p-3 text-xs text-neutral-800 placeholder-neutral-400 shadow-2xs focus:border-neutral-900 focus:outline-hidden"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingNote || !newNote.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 disabled:opacity-40 transition-colors shadow-xs"
                  >
                    <Send className="h-3 w-3" />
                    <span>Salvar Anotação</span>
                  </button>
                </div>
              </form>

              <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
                {notes.length === 0 ? (
                  <div className="p-8 text-center text-xs text-neutral-400">
                    Nenhuma anotação de contato registrada ainda para esta loja.
                  </div>
                ) : (
                  notes.map((note) => (
                    <div key={note.id} className="p-4 text-xs space-y-1.5">
                      <div className="flex items-center justify-between text-neutral-400 text-[10px]">
                        <span className="font-semibold text-neutral-700">Contato Comercial</span>
                        <span className="font-mono">
                          {new Date(note.created_at).toLocaleString('pt-BR')}
                        </span>
                      </div>
                      <p className="text-neutral-800 leading-relaxed font-sans">{note.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: GERADOR DE PITCHES & SCRIPTS */}
      {openFullPitch && (
        <PitchGeneratorModal
          lead={lead}
          onClose={() => setOpenFullPitch(false)}
          onOpenMockup={() => {
            setOpenFullPitch(false);
            setOpenFullMockup(true);
          }}
        />
      )}

      {/* MODAL 2: MOCKUP INTERATIVO (DESKTOP & CELULAR) */}
      {openFullMockup && (
        <MockupModal
          lead={lead}
          onClose={() => setOpenFullMockup(false)}
          onLeadUpdated={(updated) => {
            setLead(updated);
            onLeadUpdated(updated);
          }}
        />
      )}

      {/* MODAL 3: AUDITORIA DIGITAL & LAUDO EM PDF */}
      {openFullAudit && (
        <DigitalAuditModal
          lead={lead}
          onClose={() => setOpenFullAudit(false)}
          onOpenPitch={() => {
            setOpenFullAudit(false);
            setOpenFullPitch(true);
          }}
        />
      )}

      {/* Modal de Confirmação: Exclusão do Lead */}
      {showConfirmDelete && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-neutral-950/70 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => !isDeleting && setShowConfirmDelete(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-neutral-200 space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-neutral-900 leading-tight">
                  Excluir Lead
                </h3>
                <p className="text-xs text-neutral-600">
                  Tem certeza que deseja excluir este lead? Essa ação não poderá ser desfeita.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 text-xs space-y-1">
              <div className="font-bold text-neutral-900 text-sm">{lead.name}</div>
              <div className="text-neutral-500 flex items-center gap-2">
                <span>{lead.niche}</span>
                <span>·</span>
                <span>{lead.city} - {lead.state}</span>
              </div>
              {lead.phone && (
                <div className="text-neutral-600 font-mono text-[11px] pt-1">
                  📞 {formatBrazilianPhone(lead.phone)}
                </div>
              )}
            </div>

            {deleteError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                {deleteError}
              </div>
            )}

            <p className="text-[11px] text-neutral-400">
              O lead será removido permanentemente do banco de dados e do Firestore.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmDelete(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold text-neutral-700 bg-white border border-neutral-200 rounded-xl hover:bg-neutral-100 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteDelete}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 disabled:opacity-50 rounded-xl transition-all shadow-xs cursor-pointer"
              >
                {isDeleting ? (
                  <>
                    <RotateCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Excluindo...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Excluir Lead</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
