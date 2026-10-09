import React, { useState } from 'react';
import {
  X,
  Printer,
  Copy,
  Check,
  Send,
  FileText,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  ShieldAlert,
  ArrowRight,
  Star,
  MapPin,
  Globe,
  Phone,
  Sparkles,
} from 'lucide-react';
import { Lead } from '../../types';
import { generateAuditReport, AuditReportData } from '../../lib/audit/auditReport';
import { formatBrazilianPhone } from '../../utils/whatsapp';

interface DigitalAuditModalProps {
  lead: Lead;
  onClose: () => void;
  onOpenPitch?: () => void;
}

export const DigitalAuditModal: React.FC<DigitalAuditModalProps> = ({
  lead,
  onClose,
  onOpenPitch,
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const audit: AuditReportData = generateAuditReport(lead);

  const handlePrint = () => {
    window.print();
  };

  const handleCopySummary = () => {
    navigator.clipboard.writeText(audit.whatsappSummary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendWhatsApp = () => {
    if (!lead.phone) return;
    const clean = lead.phone.replace(/\D/g, '');
    const fullNumber = clean.startsWith('55') ? clean : `55${clean}`;
    const url = `https://wa.me/${fullNumber}?text=${encodeURIComponent(audit.whatsappSummary)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-neutral-950/80 backdrop-blur-xs overflow-y-auto">
      {/* Estilos específicos de impressão para PDF impecável */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-audit-report, #printable-audit-report * {
            visibility: visible;
          }
          #printable-audit-report {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 20px;
            background: white !important;
            color: black !important;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-neutral-200 overflow-hidden my-6">
        {/* Barra Superior de Ações (Não sai na impressão) */}
        <div className="no-print bg-neutral-900 border-b border-neutral-800 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Diagnóstico Digital & Auditoria Express B2B</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300">
                  {audit.auditId}
                </span>
              </h3>
              <p className="text-[11px] text-neutral-400">
                Relatório executivo pronto para envio ao cliente em PDF ou WhatsApp
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-neutral-900 font-bold text-xs hover:bg-neutral-100 transition-colors shadow-xs cursor-pointer"
              title="Imprimir ou Salvar como PDF"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Salvar em PDF / Imprimir</span>
            </button>

            <button
              type="button"
              onClick={handleCopySummary}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition-colors cursor-pointer"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? 'Copiado!' : 'Copiar Resumo'}</span>
            </button>

            {lead.phone && (
              <button
                type="button"
                onClick={handleSendWhatsApp}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                <span>WhatsApp</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer ml-1"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* DOCUMENTO AUDITORIA (Imprimível) */}
        <div id="printable-audit-report" className="p-6 sm:p-10 space-y-6 text-neutral-800 bg-white">
          {/* Cabeçalho do Laudo */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-neutral-200 gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  Laudo Técnico de Presença Digital
                </span>
                <span className="text-xs text-neutral-400 font-mono">
                  {audit.auditId}
                </span>
              </div>
              <h1 className="text-2xl font-black text-neutral-900 mt-2">
                {lead.name}
              </h1>
              <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500 mt-1">
                <span className="font-semibold text-neutral-700">{lead.niche}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-neutral-400" />
                  {lead.address || `${lead.city} - ${lead.state}`}
                </span>
                <span>•</span>
                <span>Data de Emissão: {audit.dateFormatted}</span>
              </div>
            </div>

            {/* Score de Saúde Digital Circular */}
            <div className="flex items-center gap-4 bg-neutral-50 p-4 rounded-2xl border border-neutral-200 self-start sm:self-auto shrink-0">
              <div className="relative flex items-center justify-center w-16 h-16 rounded-full border-4 border-rose-500 bg-white shadow-2xs">
                <span className="text-xl font-black font-mono text-neutral-900">
                  {audit.overallScore}
                </span>
              </div>
              <div>
                <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
                  Índice de Saúde Digital
                </div>
                <div className={`text-xs font-bold px-2 py-0.5 rounded-md border mt-1 inline-block ${audit.scoreColor}`}>
                  {audit.scoreLabel}
                </div>
              </div>
            </div>
          </div>

          {/* Destaque Executivo de Alerta (O Diagnóstico Principal) */}
          <div className="p-4 sm:p-5 rounded-2xl bg-amber-50/60 border border-amber-200 space-y-2">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>Diagnóstico de Oportunidade Identificado</span>
            </div>
            <p className="text-xs text-amber-900/90 leading-relaxed">
              A <strong>{lead.name}</strong> possui reputação sólida perante os consumidores locais com nota <strong>{(typeof lead.rating === 'number' ? lead.rating : 0).toFixed(1)} ★</strong> no Google Maps. No entanto, a ausência de uma página web oficial causa uma <strong>ruptura na jornada de compra</strong> do cliente móvel, desviando pesquisas qualificadas da região de {lead.city} para estabelecimentos concorrentes que possuem catálogo e botão direto.
            </p>
          </div>

          {/* Os 4 Pilares Avaliados */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
              1. Análise dos Pilares de Presença Online
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {audit.pillars.map((p, idx) => (
                <div key={idx} className="p-4 rounded-xl border border-neutral-200 bg-neutral-50/40 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs text-neutral-900 flex items-center gap-1.5">
                      {p.status === 'good' ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-rose-500" />
                      )}
                      <span>{p.name}</span>
                    </h4>
                    <span className="font-mono text-xs font-bold text-neutral-800">
                      {p.score}/100
                    </span>
                  </div>

                  {/* Barra de Progresso */}
                  <div className="w-full bg-neutral-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        p.status === 'good'
                          ? 'bg-emerald-500'
                          : p.status === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                      }`}
                      style={{ width: `${p.score}%` }}
                    />
                  </div>

                  <ul className="space-y-1 pt-1">
                    {p.points.map((pt, i) => (
                      <li key={i} className="text-[11px] text-neutral-600 flex items-start gap-1.5 leading-relaxed">
                        <span className="text-neutral-400 mt-0.5">•</span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Estimativa de Impacto Financeiro & Clientes Perdidos */}
          <div className="p-5 rounded-2xl bg-neutral-900 text-white space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-rose-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                  2. Estimativa de Oportunidades & Faturamento Não Capturado
                </h3>
              </div>
              <span className="text-[11px] text-neutral-400 font-mono">
                Mercado Local: {lead.city}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center sm:text-left">
              <div className="p-3 bg-neutral-800/80 rounded-xl border border-neutral-700/80">
                <div className="text-[11px] text-neutral-400">Buscas Estimadas / Mês</div>
                <div className="text-lg font-bold text-white font-mono mt-0.5">
                  ~{audit.estimatedMonthlySearches} buscas
                </div>
                <div className="text-[10px] text-neutral-400 mt-1">Por serviços de {lead.niche}</div>
              </div>

              <div className="p-3 bg-neutral-800/80 rounded-xl border border-neutral-700/80">
                <div className="text-[11px] text-rose-300 font-medium">Contatos Perdidos / Mês</div>
                <div className="text-lg font-bold text-rose-400 font-mono mt-0.5">
                  ~{audit.estimatedMissedClicks} clientes
                </div>
                <div className="text-[10px] text-neutral-400 mt-1">Desistem por falta de site</div>
              </div>

              <div className="p-3 bg-neutral-800/80 rounded-xl border border-neutral-700/80">
                <div className="text-[11px] text-amber-300 font-medium">Perda Estimada em Vendas</div>
                <div className="text-base font-bold text-amber-400 font-mono mt-0.5">
                  R$ {audit.estimatedRevenueLossMin.toLocaleString('pt-BR')} - {audit.estimatedRevenueLossMax.toLocaleString('pt-BR')}
                </div>
                <div className="text-[10px] text-neutral-400 mt-1">Por mês de faturamento</div>
              </div>
            </div>
          </div>

          {/* Plano de Ação Recomendado */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
              3. Plano de Ação Recomendado (Solução em 3 Etapas)
            </h3>

            <div className="space-y-2.5">
              {audit.actionPlan.map((act, i) => (
                <div key={i} className="flex items-start gap-3 p-3.5 rounded-xl border border-neutral-200 bg-white shadow-2xs">
                  <div className="w-6 h-6 rounded-full bg-neutral-900 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-neutral-900">{act.title}</h4>
                      <span className="text-[10px] font-mono text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded">
                        {act.phase}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-600 mt-0.5 leading-relaxed">
                      {act.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rodapé Oficial do Laudo */}
          <div className="pt-6 border-t border-neutral-200 flex flex-col sm:flex-row items-center justify-between text-[11px] text-neutral-400 gap-2">
            <span>ProspectaPlaces B2B Intelligence · Documento gerado com base em dados públicos do Google Maps</span>
            <span>Relatório confidencial elaborado exclusivamente para a {lead.name}</span>
          </div>
        </div>

        {/* Barra Inferior (Não sai na impressão) */}
        <div className="no-print px-6 py-3 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between text-xs">
          <span className="text-neutral-500">
            Dica: Ao clicar em "Salvar em PDF", selecione a opção "Salvar como PDF" na janela de impressão do seu navegador.
          </span>
          <div className="flex items-center gap-2">
            {onOpenPitch && (
              <button
                type="button"
                onClick={onOpenPitch}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white font-semibold text-xs hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                <span>Ver Pitch para Este Lead</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-700 hover:bg-neutral-100 font-medium transition-colors cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
