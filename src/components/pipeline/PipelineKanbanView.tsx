import React, { useState, useEffect } from 'react';
import {
  KanbanSquare,
  MessageCircle,
  MoreHorizontal,
  ChevronRight,
  ChevronLeft,
  RotateCw,
  Plus,
  Phone,
  Building,
} from 'lucide-react';
import { Lead, PipelineStatus } from '../../types';
import { api } from '../../lib/api';
import { getScoreColorClass } from '../../lib/scoring/leadScore';
import { formatBrazilianPhone, getWhatsAppUrl } from '../../utils/whatsapp';

interface PipelineKanbanViewProps {
  onSelectLead: (lead: Lead) => void;
}

const STAGES: { id: PipelineStatus; label: string }[] = [
  { id: 'NOVO', label: 'Novo' },
  { id: 'PRÉVIA CRIADA', label: 'Prévia Criada' },
  { id: 'CONTATADO', label: 'Contatado' },
  { id: 'RESPONDEU', label: 'Respondeu' },
  { id: 'INTERESSADO', label: 'Interessado' },
  { id: 'REUNIÃO', label: 'Reunião' },
  { id: 'PROPOSTA', label: 'Proposta' },
  { id: 'FECHADO', label: 'Fechado' },
  { id: 'PERDIDO', label: 'Perdido' },
];

export const PipelineKanbanView: React.FC<PipelineKanbanViewProps> = ({
  onSelectLead,
}) => {
  const [board, setBoard] = useState<Record<PipelineStatus, Lead[]>>({
    'NOVO': [],
    'PRÉVIA CRIADA': [],
    'CONTATADO': [],
    'RESPONDEU': [],
    'INTERESSADO': [],
    'REUNIÃO': [],
    'PROPOSTA': [],
    'FECHADO': [],
    'PERDIDO': [],
  });

  const [loading, setLoading] = useState<boolean>(true);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);

  useEffect(() => {
    loadPipeline();
  }, []);

  const loadPipeline = async () => {
    setLoading(true);
    try {
      const data = await api.getPipeline();
      setBoard(data);
    } catch (err) {
      console.error('Erro ao carregar pipeline:', err);
    } finally {
      setLoading(false);
    }
  };

  const moveLeadTo = async (leadId: string, toStatus: PipelineStatus) => {
    try {
      // Otimistic update
      setBoard((prev) => {
        let movedLead: Lead | undefined;
        const newBoard = { ...prev };

        for (const st of Object.keys(newBoard) as PipelineStatus[]) {
          const idx = newBoard[st].findIndex((l) => l.id === leadId);
          if (idx !== -1) {
            movedLead = { ...newBoard[st][idx], pipeline_status: toStatus };
            newBoard[st] = newBoard[st].filter((l) => l.id !== leadId);
            break;
          }
        }

        if (movedLead) {
          newBoard[toStatus] = [movedLead, ...(newBoard[toStatus] || [])];
        }
        return newBoard;
      });

      await api.movePipelineLead(leadId, toStatus);
    } catch (err) {
      console.error('Falha ao mover lead:', err);
      loadPipeline();
    }
  };

  const handleDragStart = (leadId: string) => {
    setDraggedLeadId(leadId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (toStatus: PipelineStatus) => {
    if (draggedLeadId) {
      moveLeadTo(draggedLeadId, toStatus);
      setDraggedLeadId(null);
    }
  };

  const getStageIndex = (stage: PipelineStatus) => STAGES.findIndex((s) => s.id === stage);

  return (
    <div className="space-y-4">
      {/* Top Banner do Funil */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-2xs">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 tracking-tight flex items-center gap-2">
            <KanbanSquare className="h-4 w-4 text-neutral-800" />
            <span>Pipeline de Prospecção & Conversão Comercial</span>
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Arraste os cards entre as etapas do funil de vendas. Alterações são sincronizadas automaticamente.
          </p>
        </div>

        <button
          onClick={loadPipeline}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 rounded-lg transition-colors w-fit"
        >
          <RotateCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Atualizar Funil</span>
        </button>
      </div>

      {/* Board Kanban Horizontal Scroll */}
      <div className="flex gap-3 overflow-x-auto pb-6 pt-1">
        {STAGES.map((stage) => {
          const cards = board[stage.id] || [];
          const stageIdx = getStageIndex(stage.id);

          return (
            <div
              key={stage.id}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(stage.id)}
              className="flex flex-col w-72 shrink-0 rounded-xl border border-neutral-200 bg-neutral-100/60 p-3"
            >
              {/* Header da Coluna */}
              <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-neutral-200/80">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                    {stage.label}
                  </span>
                  <span className="px-1.5 py-0.2 rounded-full text-[11px] font-mono font-semibold bg-neutral-200 text-neutral-700">
                    {cards.length}
                  </span>
                </div>
              </div>

              {/* Lista de Cards */}
              <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[70vh] pr-0.5">
                {cards.length === 0 ? (
                  <div className="py-8 text-center text-[11px] text-neutral-400 border border-dashed border-neutral-200 rounded-lg">
                    Nenhum lead nesta etapa
                  </div>
                ) : (
                  cards.map((lead) => {
                    const { badgeBg } = getScoreColorClass(lead.lead_score);
                    const waUrl = getWhatsAppUrl(lead.phone, lead.name);

                    return (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={() => handleDragStart(lead.id)}
                        onClick={() => onSelectLead(lead)}
                        className="group rounded-lg border border-neutral-200 bg-white p-3 shadow-2xs hover:border-neutral-300 hover:shadow-xs transition-all cursor-grab active:cursor-grabbing space-y-2"
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <h4 className="text-xs font-semibold text-neutral-900 leading-snug line-clamp-1 group-hover:text-black">
                            {lead.name}
                          </h4>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${badgeBg} shrink-0`}
                          >
                            {lead.lead_score}
                          </span>
                        </div>

                        {/* Metadados do Lead */}
                        <div className="text-[11px] text-neutral-500 space-y-0.5">
                          <div className="truncate">
                            {lead.city} - {lead.state} · {lead.niche}
                          </div>
                          <div className="font-mono text-neutral-700 text-[10px] flex items-center gap-1">
                            <Phone className="h-3 w-3 text-neutral-400" />
                            <span>{formatBrazilianPhone(lead.phone)}</span>
                          </div>
                        </div>

                        {/* Ações do Card */}
                        <div
                          className="flex items-center justify-between pt-2 border-t border-neutral-100 text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1">
                            {waUrl && (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Abrir WhatsApp"
                                className="p-1 text-emerald-700 hover:bg-emerald-50 rounded"
                              >
                                <MessageCircle className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>

                          {/* Quick stage switch buttons */}
                          <div className="flex items-center gap-0.5">
                            {stageIdx > 0 && (
                              <button
                                onClick={() => moveLeadTo(lead.id, STAGES[stageIdx - 1].id)}
                                title={`Mover para ${STAGES[stageIdx - 1].label}`}
                                className="p-1 text-neutral-400 hover:text-neutral-800 rounded hover:bg-neutral-100"
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {stageIdx < STAGES.length - 1 && (
                              <button
                                onClick={() => moveLeadTo(lead.id, STAGES[stageIdx + 1].id)}
                                title={`Avançar para ${STAGES[stageIdx + 1].label}`}
                                className="p-1 text-neutral-400 hover:text-neutral-800 rounded hover:bg-neutral-100"
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
