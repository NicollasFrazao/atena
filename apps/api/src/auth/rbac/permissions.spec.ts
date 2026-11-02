import {
  ALL_PERMISSIONS,
  permissionsFor,
  roleCatalog,
} from './permissions';

describe('permissionsFor', () => {
  it('admin recebe todas as permissões (wildcard)', () => {
    expect(permissionsFor(['admin'])).toEqual(ALL_PERMISSIONS);
  });

  it('support_lead tem pii:reveal, rules:edit e ops:run; users:manage não', () => {
    const perms = permissionsFor(['support_lead']);

    expect(perms).toContain('pii:reveal');
    expect(perms).toContain('rules:edit');
    expect(perms).toContain('ops:run');
    expect(perms).not.toContain('users:manage');
  });

  it('support_analyst opera incidentes mas não revela PII nem edita regras', () => {
    const perms = permissionsFor(['support_analyst']);

    expect(perms).toContain('incidents:resolve');
    expect(perms).toContain('messages:search');
    expect(perms).not.toContain('pii:reveal');
    expect(perms).not.toContain('rules:edit');
  });

  it('viewer é só leitura (sem comentar/resolver/revelar)', () => {
    const perms = permissionsFor(['viewer']);

    expect(perms).toContain('reports:view');
    expect(perms).toContain('messages:search');
    expect(perms).not.toContain('incidents:resolve');
    expect(perms).not.toContain('pii:reveal');
  });

  it('sem papéis → sem permissões (acesso pendente)', () => {
    expect(permissionsFor([])).toEqual([]);
  });

  it('combina papéis deduplicando permissões', () => {
    const perms = permissionsFor([
      'viewer',
      'support_analyst',
    ]);

    const unique = new Set(perms);

    expect(perms).toHaveLength(unique.size);
    expect(perms).toContain('incidents:resolve');
  });

  it('ignores a role this build does not know instead of throwing', () => {
    // A role stored in the database by another version of the app.
    const roles = ['viewer', 'retired_role'] as unknown as Parameters<typeof permissionsFor>[0];

    expect(permissionsFor(roles)).toEqual(permissionsFor(['viewer']));
  });
});

describe('roleCatalog', () => {
  it('lista os 4 papéis com rótulo e permissões', () => {
    const catalog = roleCatalog();
    const roles = catalog.map((item) => item.role);

    expect(roles).toEqual([
      'admin',
      'support_lead',
      'support_analyst',
      'viewer',
    ]);

    expect(catalog.every((item) => item.label.length > 0)).toBe(true);
    expect(catalog.every((item) => Array.isArray(item.permissions))).toBe(true);
  });
});
