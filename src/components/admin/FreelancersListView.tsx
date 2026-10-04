import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Copy,
  Check,
  RefreshCw,
  Lock,
  Unlock,
  ExternalLink,
  ChevronRight,
  MoreVertical,
  ShieldAlert,
  Search,
  CheckCircle2,
  Trash2,
  Edit2,
  AlertCircle,
  KeyRound,
  X,
  Sparkles,
} from 'lucide-react';
import { Freelancer, FreelancerPerformance, FreelancerStatus } from '../../types';
import { api } from '../../lib/api';

interface FreelancersListViewProps {
  onSelectFreelancer: (freelancerId: string) => void;
}

export const FreelancersListView: React.FC<FreelancersListViewProps> = ({
  onSelectFreelancer,
}) => {
  const [freelancers, setFreelancers] = useState<(Freelancer & { performance?: FreelancerPerformance })[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Estados do Modal de Criação / Edição
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [editingFreelancer, setEditingFreelancer] = useState<Freelancer | null>(null);

  const [formName, setFormName] = useState<string>('');
  const [formEmail, setFormEmail] = useState<string>('');
  const [formNotes, setFormNotes] = useState<string>('');
  const [formPin, setFormPin] = useState<string>('');
  const [formStatus, setFormStatus] = useState<FreelancerStatus>('active');
  const [submittingForm, setSubmittingForm] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Link recém criado com banner de destaque
  const [newlyCreatedLink, setNewlyCreatedLink] = useState<{ name: string; url: string; code: string } | null>(null);
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});

  const loadFreelancers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.adminGetFreelancers();
      setFreelancers(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao listar freelancers.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFreelancers();
  }, []);

  const handleCopyLink = (code: string, id: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ghprospeccao.com';
    const fullUrl = `${origin}/f/${code}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedMap((prev) => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setCopiedMap((prev) => ({ ...prev, [id]: false }));
    }, 2000);
  };

  const handleBlockToggle = async (f: Freelancer) => {
    try {
      if (f.status === 'blocked') {
        await api.adminUnblockFreelancer(f.id);
      } else {
        await api.adminBlockFreelancer(f.id);
      }
      await loadFreelancers();
    } catch (err) {
      console.error('Erro ao alternar status do freelancer:', err);
    }
  };

  const handleRegenerateLink = async (f: Freelancer) => {
    if (!confirm(`Tem certeza de que deseja regenerar o link de ${f.name}? O link antigo deixará de funcionar imediatamente.`)) {
      return;
    }
    try {
      const res = await api.adminRegenerateLink(f.id);
      await loadFreelancers();
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ghprospeccao.com';
      setNewlyCreatedLink({
        name: f.name,
        code: res.accessCode,
        url: `${origin}/f/${res.accessCode}`,
      });
    } catch (err) {
      console.error('Erro ao regenerar link:', err);
    }
  };

  const handleDeleteFreelancer = async (f: Freelancer) => {
    if (!confirm(`Deseja realmente desativar e remover o cadastro de ${f.name}? Todos os leads associados serão preservados no banco de dados.`)) {
      return;
    }
    try {
      await api.adminDeleteFreelancer(f.id);
      await loadFreelancers();
    } catch (err) {
      console.error('Erro ao excluir freelancer:', err);
    }
  };

  const handleOpenCreateModal = () => {
    setEditingFreelancer(null);
    setFormName('');
    setFormEmail('');
    setFormNotes('');
    setFormPin('');
    setFormStatus('active');
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  const handleOpenEditModal = (f: Freelancer) => {
    setEditingFreelancer(f);
    setFormName(f.name);
    setFormEmail(f.email);
    setFormNotes(f.notes || '');
    setFormPin(f.pin || '');
    setFormStatus(f.status);
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formEmail.trim()) {
      setFormError('Nome e E-mail são obrigatórios.');
      return;
    }

    setSubmittingForm(true);
    setFormError(null);
    try {
      if (editingFreelancer) {
        await api.adminUpdateFreelancer(editingFreelancer.id, {
          name: formName.trim(),
          email: formEmail.trim().toLowerCase(),
          notes: formNotes.trim(),
          pin: formPin.trim(),
          status: formStatus,
        });
      } else {
        const res = await api.adminCreateFreelancer({
          name: formName.trim(),
          email: formEmail.trim().toLowerCase(),
          notes: formNotes.trim(),
          pin: formPin.trim(),
          status: formStatus,
        });

        const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ghprospeccao.com';
        setNewlyCreatedLink({
          name: res.freelancer.name,
          code: res.freelancer.access_code,
          url: `${origin}/f/${res.freelancer.access_code}`,
        });
      }

      setIsCreateModalOpen(false);
      await loadFreelancers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao salvar dados do freelancer.';
      setFormError(msg);
    } finally {
      setSubmittingForm(false);
    }
  };

  const filtered = freelancers.filter((f) => {
    const q = searchTerm.toLowerCase();
    return (
      f.name.toLowerCase().includes(q) ||
      f.email.toLowerCase().includes(q) ||
      f.access_code.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Banner de Link Recém-Criado com 1-Click Copy */}
      {newlyCreatedLink && (
        <div className="bg-emerald-900 border border-emerald-700 text-white p-4 rounded-xl shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-300" />
              <span className="font-bold text-sm">Link de Acesso Único Gerado para {newlyCreatedLink.name}</span>
            </div>
            <p className="text-xs text-emerald-200">
              Envie este link exclusivo para o freelancer iniciar seu trabalho com workspace isolado:
            </p>
            <div className="font-mono text-xs bg-black/30 px-3 py-1.5 rounded text-emerald-300 select-all flex items-center gap-2">
              <span>{newlyCreatedLink.url}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                navigator.clipboard.writeText(newlyCreatedLink.url);
                alert('Link copiado com sucesso!');
              }}
              className="px-3.5 py-2 bg-emerald-400 hover:bg-emerald-300 text-neutral-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Copy className="h-3.5 w-3.5" />
              Copiar Link
            </button>
            <button
              onClick={() => setNewlyCreatedLink(null)}
              className="p-2 text-emerald-300 hover:text-white rounded-lg"
              title="Fechar aviso"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Header & Botão + Novo Freelancer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-neutral-200 shadow-2xs">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5 text-neutral-700" />
            Gestão de Freelancers & Operação
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Cadastre novos membros da equipe, gere links de acesso seguros e monitore a produtividade
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadFreelancers}
            title="Atualizar lista"
            className="p-2.5 border border-neutral-200 hover:bg-neutral-100 rounded-lg text-neutral-600 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 px-4 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white font-bold text-xs rounded-lg shadow-sm transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            + Novo Freelancer
          </button>
        </div>
      </div>

      {/* Barra de Busca de Freelancers */}
      <div className="flex items-center gap-2 bg-white px-3.5 py-2.5 rounded-xl border border-neutral-200 shadow-2xs">
        <Search className="h-4 w-4 text-neutral-400 shrink-0" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Buscar por nome, e-mail ou código de acesso..."
          className="w-full text-xs text-neutral-800 placeholder-neutral-400 focus:outline-hidden"
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className="text-neutral-400 hover:text-neutral-600 text-xs"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Tabela de Freelancers */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-2xs overflow-hidden">
        {loading && freelancers.length === 0 ? (
          <div className="p-12 text-center text-xs text-neutral-400">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-neutral-700" />
            Carregando freelancers cadastrados...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-neutral-500 space-y-3">
            <AlertCircle className="h-8 w-8 text-neutral-400 mx-auto" />
            <div className="text-sm font-semibold">Nenhum freelancer encontrado</div>
            <p className="text-xs text-neutral-400 max-w-sm mx-auto">
              {searchTerm
                ? 'Nenhum resultado corresponde à sua pesquisa.'
                : 'Cadastre o primeiro freelancer para começar a delegar prospecções independentes.'}
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 text-white text-xs font-bold rounded-lg"
            >
              <Plus className="h-3.5 w-3.5" />
              Cadastrar Freelancer
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Freelancer</th>
                  <th className="py-3 px-4">Status & Acesso</th>
                  <th className="py-3 px-4">Link de Acesso Único</th>
                  <th className="py-3 px-4 text-center">Leads Mapeados</th>
                  <th className="py-3 px-4 text-center">Contatados</th>
                  <th className="py-3 px-4 text-center">Respostas</th>
                  <th className="py-3 px-4 text-center">Vendas</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtered.map((f) => {
                  const perf = f.performance;
                  const isBlocked = f.status === 'blocked';
                  const isCopied = copiedMap[f.id] || false;
                  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ghprospecção.com';
                  const fullLink = `${origin}/f/${f.access_code}`;

                  return (
                    <tr
                      key={f.id}
                      className={`hover:bg-neutral-50/80 transition-colors ${
                        isBlocked ? 'bg-rose-50/20' : ''
                      }`}
                    >
                      {/* Nome & Email */}
                      <td className="py-3.5 px-4">
                        <div
                          onClick={() => onSelectFreelancer(f.id)}
                          className="font-bold text-neutral-900 hover:text-amber-800 cursor-pointer transition-colors"
                        >
                          {f.name}
                        </div>
                        <div className="text-[11px] text-neutral-400">{f.email}</div>
                        {f.pin && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-neutral-400 font-mono mt-0.5">
                            <KeyRound className="h-2.5 w-2.5" /> PIN ativado
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        {isBlocked ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            <Lock className="h-3 w-3" />
                            Bloqueado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Ativo
                          </span>
                        )}
                        <div className="text-[10px] text-neutral-400 mt-1">
                          {f.last_access_at
                            ? `Acesso: ${new Date(f.last_access_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
                            : 'Sem acessos'}
                        </div>
                      </td>

                      {/* Link de Acesso com botão Copiar */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <code className="text-[11px] font-mono font-bold bg-neutral-100 px-2 py-1 rounded text-neutral-800 border border-neutral-200 select-all">
                            /f/{f.access_code}
                          </code>
                          <button
                            type="button"
                            onClick={() => handleCopyLink(f.access_code, f.id)}
                            className={`p-1.5 rounded border transition-colors cursor-pointer ${
                              isCopied
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-100'
                            }`}
                            title="Copiar link completo de acesso"
                          >
                            {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                      </td>

                      {/* Métricas: Leads Mapeados */}
                      <td className="py-3.5 px-4 text-center">
                        <span className="font-semibold text-neutral-800">{perf?.leadsFound || 0}</span>
                      </td>

                      {/* Métricas: Contatados */}
                      <td className="py-3.5 px-4 text-center">
                        <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          {perf?.leadsContacted || 0}
                        </span>
                      </td>

                      {/* Métricas: Respostas */}
                      <td className="py-3.5 px-4 text-center">
                        <span className="font-semibold text-sky-700">
                          {perf?.responses || 0}
                        </span>
                        {perf?.responseRate ? (
                          <div className="text-[10px] text-neutral-400">{perf.responseRate}%</div>
                        ) : null}
                      </td>

                      {/* Métricas: Vendas */}
                      <td className="py-3.5 px-4 text-center">
                        <span className="font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full">
                          {perf?.sales || 0}
                        </span>
                      </td>

                      {/* Ações Administrativas */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Ver Perfil Individual */}
                          <button
                            onClick={() => onSelectFreelancer(f.id)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded transition-colors"
                            title="Ver dashboard e leads deste freelancer"
                          >
                            Ver Painel
                          </button>

                          {/* Bloquear / Desbloquear */}
                          <button
                            onClick={() => handleBlockToggle(f)}
                            className={`p-1.5 rounded transition-colors ${
                              isBlocked
                                ? 'text-emerald-700 hover:bg-emerald-100 bg-emerald-50'
                                : 'text-rose-700 hover:bg-rose-100 bg-rose-50'
                            }`}
                            title={isBlocked ? 'Desbloquear Acesso' : 'Bloquear Acesso'}
                          >
                            {isBlocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                          </button>

                          {/* Regenerar Link */}
                          <button
                            onClick={() => handleRegenerateLink(f)}
                            className="p-1.5 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 rounded transition-colors"
                            title="Regenerar Link de Acesso Único"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>

                          {/* Editar */}
                          <button
                            onClick={() => handleOpenEditModal(f)}
                            className="p-1.5 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 rounded transition-colors"
                            title="Editar Dados do Freelancer"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>

                          {/* Excluir */}
                          <button
                            onClick={() => handleDeleteFreelancer(f)}
                            className="p-1.5 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                            title="Remover Freelancer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL DE CRIAÇÃO / EDIÇÃO DE FREELANCER */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-white rounded-2xl border border-neutral-200 shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                <Users className="h-4 w-4 text-neutral-700" />
                {editingFreelancer ? 'Editar Freelancer' : 'Cadastrar Novo Freelancer'}
              </h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-neutral-700 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-3 p-2.5 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmitForm} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block font-semibold text-neutral-700 mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Natalia Ferreira"
                  className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-xs focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-neutral-700 mb-1">
                  E-mail de Contato *
                </label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="Ex: natalia@gmail.com"
                  className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-xs focus:border-neutral-900 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-neutral-700 mb-1">
                  Status Inicial
                </label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as FreelancerStatus)}
                  className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-xs bg-white focus:border-neutral-900 focus:outline-hidden font-medium"
                >
                  <option value="active">Ativo (Acesso Imediato ao Workspace)</option>
                  <option value="blocked">Bloqueado (Acesso Interrompido)</option>
                  <option value="inactive">Inativo</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-neutral-700 mb-1">
                  PIN de Segurança Opcional (4 a 6 dígitos)
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={formPin}
                  onChange={(e) => setFormPin(e.target.value)}
                  placeholder="Deixe em branco para acesso direto sem PIN"
                  className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-xs focus:border-neutral-900 focus:outline-hidden font-mono"
                />
                <span className="text-[10px] text-neutral-400 mt-1 block">
                  Se informado, o freelancer precisará digitar este PIN ao abrir seu link.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-neutral-700 mb-1">
                  Observações Internas (Opcional)
                </label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Ex: Responsável pelo nicho de clínicas odontológicas em SP..."
                  className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-xs focus:border-neutral-900 focus:outline-hidden resize-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-3 py-2 text-neutral-600 hover:text-neutral-900 font-medium rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingForm}
                  className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white font-bold rounded-lg disabled:opacity-50"
                >
                  {submittingForm
                    ? 'Salvando...'
                    : editingFreelancer
                    ? 'Salvar Alterações'
                    : 'Cadastrar & Gerar Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
