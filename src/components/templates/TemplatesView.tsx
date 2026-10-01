import React, { useState, useEffect, useMemo } from 'react';
import {
  MessageSquareQuote,
  Sparkles,
  Plus,
  Edit3,
  Trash2,
  Copy,
  Check,
  RotateCcw,
  Zap,
  MessageCircle,
  Instagram,
  Volume2,
  Layers,
  Search,
  CheckCircle2,
  ExternalLink,
  Tag,
  ShieldCheck,
  Flame,
  X,
  Eye,
  SlidersHorizontal,
} from 'lucide-react';
import { OutreachTemplate, TemplateCategory, TEMPLATE_VARIABLES } from '../../types/templates';
import {
  getStoredTemplates,
  saveSingleTemplate,
  deleteTemplateById,
  resetTemplatesToDefault,
  renderTemplateText,
} from '../../lib/templates/templateStorage';
import { Lead } from '../../types';
import { api } from '../../lib/api';
import { getInstagramSearchUrl, getWhatsAppDirectUrl } from '../../lib/pitch/pitchGenerator';

interface TemplatesViewProps {
  onNavigateToOutreach?: () => void;
  onSelectLead?: (lead: Lead) => void;
}

const CATEGORIES: { id: 'ALL' | TemplateCategory; label: string; icon: any; countKey?: string }[] = [
  { id: 'ALL', label: 'Todos os Modelos', icon: Layers },
  { id: 'whatsapp', label: 'WhatsApp (1º Contato)', icon: MessageCircle },
  { id: 'instagram', label: 'Instagram Direct', icon: Instagram },
  { id: 'audio', label: 'Roteiros de Áudio (20s)', icon: Volume2 },
  { id: 'followup', label: 'Recuperação de Vácuo', icon: RotateCcw },
  { id: 'closing', label: 'Fechamento & Propostas', icon: Flame },
];

export const TemplatesView: React.FC<TemplatesViewProps> = ({ onNavigateToOutreach }) => {
  const [templates, setTemplates] = useState<OutreachTemplate[]>([]);
  const [activeCategory, setActiveCategory] = useState<'ALL' | TemplateCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Simulação / Pré-visualização com dados de Leads Reais
  const [sampleLeads, setSampleLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string>('SAMPLE');
  const [previewWithRealData, setPreviewWithRealData] = useState<boolean>(true);

  // Estados de Edição / Criação
  const [editingTemplate, setEditingTemplate] = useState<OutreachTemplate | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Carrega templates
  useEffect(() => {
    setTemplates(getStoredTemplates());
  }, []);

  // Carrega alguns leads reais para o simulador
  useEffect(() => {
    api.getLeads({ limit: 20 })
      .then((res) => {
        if (res?.leads && res.leads.length > 0) {
          setSampleLeads(res.leads);
        }
      })
      .catch((err) => console.warn('Erro ao carregar leads para simulador:', err));
  }, []);

  // Lead selecionado no simulador
  const activeSampleLead: Partial<Lead> = useMemo(() => {
    if (selectedLeadId === 'SAMPLE' || !selectedLeadId) {
      return {
        id: 'exemplo-demo',
        name: 'Barbearia Don Corleone',
        niche: 'Barbearia & Estilo',
        city: 'Campinas',
        state: 'SP',
        phone: '19987654321',
        rating: 4.9,
        reviews_count: 42,
      };
    }
    const found = sampleLeads.find((l) => l.id === selectedLeadId);
    return (
      found || {
        id: 'exemplo-demo',
        name: 'Barbearia Don Corleone',
        niche: 'Barbearia',
        city: 'Campinas',
        state: 'SP',
        rating: 4.9,
        reviews_count: 42,
      }
    );
  }, [selectedLeadId, sampleLeads]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Filtragem dos templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((tpl) => {
      if (activeCategory !== 'ALL' && tpl.category !== activeCategory) {
        return false;
      }
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchTitle = tpl.title.toLowerCase().includes(q);
        const matchDesc = tpl.description.toLowerCase().includes(q);
        const matchText = tpl.text.toLowerCase().includes(q);
        const matchBadge = tpl.badge.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchText && !matchBadge) {
          return false;
        }
      }
      return true;
    });
  }, [templates, activeCategory, searchQuery]);

  // Copia o texto do modelo
  const handleCopyTemplate = async (tpl: OutreachTemplate) => {
    const finalContent = previewWithRealData
      ? renderTemplateText(tpl.text, activeSampleLead)
      : tpl.text;

    try {
      await navigator.clipboard.writeText(finalContent);
      setCopiedId(tpl.id);
      showToast('Texto copiado com sucesso para a área de transferência!');
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  // Disparo de teste no WhatsApp
  const handleTestWhatsApp = (tpl: OutreachTemplate) => {
    const text = renderTemplateText(tpl.text, activeSampleLead);
    const waUrl = getWhatsAppDirectUrl(activeSampleLead.phone || '19987654321', text);
    if (waUrl) {
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // Disparo de teste no Instagram
  const handleTestInstagram = (tpl: OutreachTemplate) => {
    handleCopyTemplate(tpl);
    const igUrl = getInstagramSearchUrl(
      activeSampleLead.name || 'Empresa',
      activeSampleLead.city || 'Cidade'
    );
    window.open(igUrl, '_blank', 'noopener,noreferrer');
  };

  // Abrir editor para novo modelo
  const handleStartCreate = () => {
    setEditingTemplate({
      id: `tpl_custom_${Date.now()}`,
      title: '',
      category: activeCategory === 'ALL' ? 'whatsapp' : activeCategory,
      targetChannel: 'whatsapp',
      badge: '✨ Modelo Personalizado',
      description: '',
      text: '',
      isCustom: true,
    });
    setIsCreatingNew(true);
  };

  // Abrir editor para editar existente
  const handleStartEdit = (tpl: OutreachTemplate) => {
    setEditingTemplate({ ...tpl });
    setIsCreatingNew(false);
  };

  // Salvar modelo editado ou novo
  const handleSaveEditing = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate || !editingTemplate.title.trim() || !editingTemplate.text.trim()) {
      alert('Por favor, preencha pelo menos o título e o texto da mensagem.');
      return;
    }

    const updated = saveSingleTemplate(editingTemplate);
    setTemplates(updated);
    setEditingTemplate(null);
    showToast(isCreatingNew ? 'Novo modelo criado com sucesso!' : 'Modelo atualizado com sucesso!');
  };

  // Excluir modelo
  const handleDelete = (id: string, title: string) => {
    if (confirm(`Tem certeza que deseja remover o modelo "${title}"?`)) {
      const updated = deleteTemplateById(id);
      setTemplates(updated);
      showToast('Modelo removido.');
    }
  };

  // Restaurar padrões
  const handleResetDefaults = () => {
    if (
      confirm(
        'Deseja restaurar os modelos originais de fábrica? Quaisquer modelos customizados criados serão mantidos ou mesclados.'
      )
    ) {
      const defs = resetTemplatesToDefault();
      setTemplates(defs);
      showToast('Modelos padrão restaurados com sucesso!');
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. TOPO: HEADER DA SEÇÃO & CONTROLES */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 border border-amber-500/20">
            <MessageSquareQuote className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-neutral-900 tracking-tight">
                Modelos de Abordagem & Copywriting de Vendas
              </h2>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                100% Editáveis
              </span>
            </div>
            <p className="text-xs text-neutral-500 mt-1 max-w-2xl leading-relaxed">
              Scripts psicológicos validados no mercado para WhatsApp, Instagram Direct, Roteiros de Áudio e Fechamento com quebra de objeções. Personalize como quiser ou crie novos modelos.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200/80 rounded-xl transition-colors cursor-pointer"
            title="Restaurar os modelos originais"
          >
            <RotateCcw className="h-3.5 w-3.5 text-neutral-500" />
            <span>Restaurar Originais</span>
          </button>

          {onNavigateToOutreach && (
            <button
              onClick={onNavigateToOutreach}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-neutral-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition-all shadow-xs cursor-pointer"
            >
              <Zap className="h-3.5 w-3.5 fill-neutral-950" />
              <span>Usar na Esteira Relâmpago</span>
            </button>
          )}

          <button
            onClick={handleStartCreate}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-neutral-900 hover:bg-neutral-800 rounded-xl transition-all shadow-xs cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Novo Modelo</span>
          </button>
        </div>
      </div>

      {/* 2. BARRA DE SIMULAÇÃO DE DADOS (PREVIEW COM CLIENTE REAL) */}
      <div className="bg-amber-50/60 border border-amber-200/80 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold text-amber-900 shrink-0">
            <Eye className="h-4 w-4 text-amber-700" />
            <span>Simulador de Variáveis:</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-amber-800">Visualizar textos com os dados de:</span>
            <select
              value={selectedLeadId}
              onChange={(e) => setSelectedLeadId(e.target.value)}
              className="bg-white border border-amber-300 text-neutral-900 font-semibold px-2.5 py-1 rounded-lg text-xs focus:outline-hidden"
            >
              <option value="SAMPLE">🏢 Exemplo Padrão (Barbearia Don Corleone · Campinas SP)</option>
              {sampleLeads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.niche} · {l.city})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <label className="flex items-center gap-2 text-amber-900 font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={previewWithRealData}
              onChange={(e) => setPreviewWithRealData(e.target.checked)}
              className="rounded border-amber-400 bg-white text-amber-600 focus:ring-0 cursor-pointer"
            />
            <span>Substituir tags dinâmicas pelos dados reais</span>
          </label>
        </div>
      </div>

      {/* 3. ABAS DE CATEGORIAS E BUSCA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Abas */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isSelected = activeCategory === cat.id;
            const count =
              cat.id === 'ALL'
                ? templates.length
                : templates.filter((t) => t.category === cat.id).length;

            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-neutral-900 text-white shadow-xs'
                    : 'bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-50 hover:text-neutral-900'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-amber-400' : 'text-neutral-400'}`} />
                <span>{cat.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-600'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Campo de Busca */}
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="Pesquisar nos modelos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white text-xs text-neutral-800 placeholder-neutral-400 rounded-xl pl-8 pr-3 py-2 border border-neutral-200 focus:outline-hidden focus:border-neutral-900 shadow-2xs"
          />
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
        </div>
      </div>

      {/* 4. FEEDBACK FLUTUANTE (TOAST) */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border text-sm font-semibold bg-neutral-900 text-white border-neutral-800 animate-bounce">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 5. GRID DE MODELOS */}
      {filteredTemplates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-12 text-center space-y-3">
          <MessageSquareQuote className="h-10 w-10 text-neutral-400 mx-auto" />
          <h3 className="text-base font-bold text-neutral-900">Nenhum modelo encontrado</h3>
          <p className="text-xs text-neutral-500 max-w-md mx-auto">
            Não encontramos nenhum modelo para a categoria ou termo pesquisado. Você pode criar um novo modelo agora mesmo!
          </p>
          <button
            onClick={handleStartCreate}
            className="px-4 py-2 text-xs font-bold text-white bg-neutral-900 hover:bg-neutral-800 rounded-xl"
          >
            + Criar Primeiro Modelo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredTemplates.map((tpl) => {
            const renderedPreview = previewWithRealData
              ? renderTemplateText(tpl.text, activeSampleLead)
              : tpl.text;

            return (
              <div
                key={tpl.id}
                className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs flex flex-col justify-between hover:border-neutral-300 transition-all group"
              >
                <div className="space-y-3">
                  {/* Topo do Card */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                      {tpl.badge}
                    </span>

                    <div className="flex items-center gap-1 text-neutral-400">
                      {tpl.targetChannel === 'whatsapp' && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </span>
                      )}
                      {tpl.targetChannel === 'instagram' && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-pink-700 bg-pink-50 px-2 py-0.5 rounded-md border border-pink-200">
                          <Instagram className="h-3 w-3" /> Direct
                        </span>
                      )}
                      {tpl.targetChannel === 'audio' && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                          <Volume2 className="h-3 w-3" /> Áudio
                        </span>
                      )}
                      {tpl.targetChannel === 'both' && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                          Todos os Canais
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Título & Descrição Estratégica */}
                  <div>
                    <h3 className="font-bold text-sm text-neutral-900 group-hover:text-amber-600 transition-colors">
                      {tpl.title}
                    </h3>
                    <p className="text-xs text-neutral-500 mt-1 line-clamp-2 leading-relaxed">
                      {tpl.description}
                    </p>
                  </div>

                  {/* Caixa de Texto do Script */}
                  <div className="relative bg-neutral-50/70 border border-neutral-200 rounded-xl p-3.5 text-xs font-mono text-neutral-800 leading-relaxed max-h-56 overflow-y-auto whitespace-pre-wrap selection:bg-amber-100">
                    {renderedPreview}
                  </div>
                </div>

                {/* Rodapé de Ações do Card */}
                <div className="pt-4 mt-4 border-t border-neutral-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleStartEdit(tpl)}
                      className="p-1.5 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors cursor-pointer"
                      title="Editar este modelo"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>

                    {tpl.isCustom && (
                      <button
                        onClick={() => handleDelete(tpl.id, tpl.title)}
                        className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Excluir este modelo"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {tpl.targetChannel === 'whatsapp' || tpl.targetChannel === 'both' ? (
                      <button
                        onClick={() => handleTestWhatsApp(tpl)}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors border border-emerald-200 cursor-pointer"
                        title="Testar envio no WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </button>
                    ) : null}

                    {tpl.targetChannel === 'instagram' && (
                      <button
                        onClick={() => handleTestInstagram(tpl)}
                        className="p-1.5 text-pink-600 hover:bg-pink-50 rounded-lg transition-colors border border-pink-200 cursor-pointer"
                        title="Testar envio no Instagram Direct"
                      >
                        <Instagram className="h-4 w-4" />
                      </button>
                    )}

                    <button
                      onClick={() => handleCopyTemplate(tpl)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        copiedId === tpl.id
                          ? 'bg-emerald-600 text-white'
                          : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-2xs'
                      }`}
                    >
                      {copiedId === tpl.id ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          <span>Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 6. MODAL DE CRIAÇÃO / EDIÇÃO DE MODELO */}
      {editingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/70 backdrop-blur-xs overflow-y-auto">
          <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 bg-neutral-900 text-white border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-amber-400" />
                <h3 className="font-bold text-base text-white">
                  {isCreatingNew ? 'Criar Novo Modelo de Abordagem' : 'Editar Modelo de Abordagem'}
                </h3>
              </div>
              <button
                onClick={() => setEditingTemplate(null)}
                className="p-1 text-neutral-400 hover:text-white rounded-md cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditing} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Título do Modelo *</label>
                  <input
                    type="text"
                    required
                    value={editingTemplate.title}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, title: e.target.value })}
                    placeholder="Ex: Quebra de Gelo Curiosa"
                    className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-neutral-900 font-medium focus:border-neutral-900 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Badge de Conversão / Benefício</label>
                  <input
                    type="text"
                    value={editingTemplate.badge}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, badge: e.target.value })}
                    placeholder="Ex: 🔥 Alta Conversão 40%"
                    className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-neutral-900 font-medium focus:border-neutral-900 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Categoria</label>
                  <select
                    value={editingTemplate.category}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, category: e.target.value as TemplateCategory })
                    }
                    className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-neutral-900 font-medium focus:border-neutral-900 focus:outline-hidden"
                  >
                    <option value="whatsapp">WhatsApp (Primeiro Contato)</option>
                    <option value="instagram">Instagram Direct</option>
                    <option value="audio">Roteiro de Áudio (20s)</option>
                    <option value="followup">Recuperação de Vácuo (Follow-up)</option>
                    <option value="closing">Fechamento & Proposta</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-neutral-700 mb-1">Canal de Destino</label>
                  <select
                    value={editingTemplate.targetChannel}
                    onChange={(e) =>
                      setEditingTemplate({
                        ...editingTemplate,
                        targetChannel: e.target.value as any,
                      })
                    }
                    className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-neutral-900 font-medium focus:border-neutral-900 focus:outline-hidden"
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram Direct</option>
                    <option value="audio">Áudio Gravado</option>
                    <option value="both">Todos os Canais</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-neutral-700 mb-1">Descrição Estratégica (Quando usar)</label>
                <input
                  type="text"
                  value={editingTemplate.description}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
                  placeholder="Ex: Use quando o cliente perguntar quanto custa..."
                  className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-neutral-900 font-medium focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              {/* Botões de Inserção de Tags Dinâmicas */}
              <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-200 space-y-2">
                <span className="font-bold text-neutral-700 flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-amber-500" />
                  Clique para inserir variáveis automáticas no texto:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v.tag}
                      type="button"
                      onClick={() => {
                        setEditingTemplate({
                          ...editingTemplate,
                          text: `${editingTemplate.text} ${v.tag}`,
                        });
                      }}
                      className="px-2 py-1 bg-white hover:bg-amber-100 hover:border-amber-300 text-neutral-700 border border-neutral-200 rounded-md text-[11px] font-mono transition-colors cursor-pointer"
                      title={`Exemplo: ${v.example}`}
                    >
                      + {v.tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Textarea do Script */}
              <div>
                <label className="block font-semibold text-neutral-700 mb-1">Texto da Mensagem *</label>
                <textarea
                  required
                  rows={8}
                  value={editingTemplate.text}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, text: e.target.value })}
                  className="w-full bg-white border border-neutral-300 rounded-xl p-3.5 font-mono text-xs text-neutral-900 leading-relaxed focus:border-neutral-900 focus:outline-hidden"
                  placeholder="Digite ou cole aqui o seu script de vendas..."
                />
              </div>

              {/* Ações do Modal */}
              <div className="pt-3 border-t border-neutral-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingTemplate(null)}
                  className="px-4 py-2 font-semibold text-neutral-600 hover:text-neutral-900 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-bold text-white bg-neutral-900 hover:bg-neutral-800 rounded-xl shadow-xs cursor-pointer"
                >
                  Salvar Modelo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
