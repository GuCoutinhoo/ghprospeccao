type Owned = { workspace_id?: string | null; freelancer_id?: string | null; user_id?: string | null };
export function canonicalWorkspace(id?: string | null): string {
  const value = (id || '').trim().toLowerCase();
  if (!value || ['admin', 'administrador', 'default'].includes(value) || value.startsWith('admin_') || value.startsWith('default_user')) return 'admin';
  return value.startsWith('freelancer:') ? value : `freelancer:${value.replace(/^free_/, '')}`;
}
// Explicit ownership fields must agree. Ambiguous historical records fail closed.
export function ownerOf(value: Owned): string {
  const owners = [value.workspace_id, value.freelancer_id].filter(Boolean).map(canonicalWorkspace);
  if (!owners.length) return canonicalWorkspace(value.user_id);
  if (new Set(owners).size !== 1) return '!conflicting-owner';
  return owners[0];
}
export function matchesFreelancerId(a?: string | null, b?: string | null): boolean {
  return b === 'ALL' || canonicalWorkspace(a) === canonicalWorkspace(b);
}
export function isLeadInWorkspace(value: Owned, target?: string | null): boolean {
  return target === 'ALL' || ownerOf(value) === canonicalWorkspace(target);
}
