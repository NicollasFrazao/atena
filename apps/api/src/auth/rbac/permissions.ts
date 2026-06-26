import type {
  PermissionType,
  RoleCatalogItemInterface,
  RoleType,
} from '@atena/types';

/**
 * Catálogo completo de permissões (ordem estável). É o conjunto concedido ao `admin` (wildcard).
 */
export const ALL_PERMISSIONS: PermissionType[] = [
  'app:use',
  'messages:search',
  'messages:trail',
  'pii:reveal',
  'reports:view',
  'incidents:view',
  'incidents:comment',
  'incidents:ack',
  'incidents:resolve',
  'rules:view',
  'rules:edit',
  'audit:view',
  'observability:view',
  'ops:run',
  'users:manage',
];

/** Permissões de leitura/base do `viewer` (herdadas pelos papéis acima). */
const VIEWER_PERMISSIONS: PermissionType[] = [
  'app:use',
  'messages:search',
  'messages:trail',
  'reports:view',
  'incidents:view',
  'rules:view',
  'audit:view',
  'observability:view',
];

/** `support_analyst` = viewer + ações operacionais em incidentes. */
const ANALYST_PERMISSIONS: PermissionType[] = [
  ...VIEWER_PERMISSIONS,
  'incidents:comment',
  'incidents:ack',
  'incidents:resolve',
];

/** `support_lead` = analista + ações sensíveis + gatilhos de ops. */
const LEAD_PERMISSIONS: PermissionType[] = [
  ...ANALYST_PERMISSIONS,
  'pii:reveal',
  'rules:edit',
  'ops:run',
];

/** Mapa papel→permissões (fonte da verdade da autorização). `admin` recebe o catálogo completo. */
export const ROLE_PERMISSIONS: Record<RoleType, PermissionType[]> = {
  admin: ALL_PERMISSIONS,
  support_lead: LEAD_PERMISSIONS,
  support_analyst: ANALYST_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
};

/** Rótulos legíveis dos papéis (tela de admin). */
export const ROLE_LABELS: Record<RoleType, string> = {
  admin: 'Administrador',
  support_lead: 'Líder de suporte',
  support_analyst: 'Analista de suporte',
  viewer: 'Visualizador',
};

/** Descrição do que cada papel permite (explica os papéis na tela de admin). */
export const ROLE_DESCRIPTIONS: Record<RoleType, string> = {
  admin: 'Acesso total: gerencia usuários e papéis, além de tudo que os demais fazem.',
  support_lead: 'Operação completa + ações sensíveis: revelar PII, editar regras e disparar rotinas de operação.',
  support_analyst: 'Operação do dia a dia: busca, trilha, relatórios e incidentes (ack/comentar/resolver) — sem revelar PII.',
  viewer: 'Somente leitura: vê dados, relatórios e incidentes, sem agir.',
};

/**
 * Deriva o conjunto (deduplicado) de permissões a partir dos papéis do usuário.
 *
 * @param {RoleType[]} roles - Papéis atribuídos ao usuário.
 * @returns {PermissionType[]} Permissões efetivas.
 */
export function permissionsFor(roles: RoleType[]): PermissionType[] {
  const granted = new Set<PermissionType>();

  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      granted.add(permission);
    }
  }

  return [...granted];
}

/**
 * Verifica se um e-mail está numa allowlist (ex.: super admins do `AUTH_ADMIN_EMAILS`),
 * normalizando **ambos os lados** (trim + lowercase). Sem isso, maiúsculas/espaços na env
 * (ex.: `Admin@Empresa.com `) fariam o super admin não ser reconhecido.
 *
 * @param {string} email - E-mail a verificar.
 * @param {string[]} allowlist - Lista permitida (crua, possivelmente com caixa/espaços).
 * @returns {boolean} `true` se o e-mail (normalizado) está na allowlist (normalizada).
 */
export function emailInAllowlist(
  email: string,
  allowlist: string[],
): boolean {
  const normalized = email.trim().toLowerCase();

  return allowlist.some((entry) => entry.trim().toLowerCase() === normalized);
}

/**
 * Catálogo de papéis (chave + rótulo + permissões) para alimentar a tela de admin.
 *
 * @returns {RoleCatalogItemInterface[]} Papéis disponíveis e o que cada um concede.
 */
export function roleCatalog(): RoleCatalogItemInterface[] {
  return (Object.keys(ROLE_PERMISSIONS) as RoleType[]).map((role) => ({
    role,
    label: ROLE_LABELS[role],
    description: ROLE_DESCRIPTIONS[role],
    permissions: ROLE_PERMISSIONS[role],
  }));
}
