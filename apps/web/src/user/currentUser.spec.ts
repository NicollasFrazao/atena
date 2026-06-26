import { describe, expect, it } from 'vitest';
import type { SessionUserInterface } from '@atena/types';
import { deriveCurrentUser } from './currentUser';

function user(overrides: Partial<SessionUserInterface>): SessionUserInterface {
  return {
    sub: 'u-1',
    email: 'ana.souza@example.com',
    name: 'Ana Souza',
    roles: ['support_analyst'],
    permissions: [],
    status: 'active',
    is_super_admin: false,
    ...overrides,
  };
}

describe('deriveCurrentUser', () => {
  it('deriva primeiro nome e iniciais (2 letras) do nome completo', () => {
    const derived = deriveCurrentUser(user({ name: 'Ana Souza' }));

    expect(derived.name).toBe('Ana Souza');
    expect(derived.firstName).toBe('Ana');
    expect(derived.initials).toBe('AS');
  });

  it('usa a parte local do e-mail quando não há nome', () => {
    const derived = deriveCurrentUser(user({
      name: '',
      email: 'bruno@example.com',
    }));

    expect(derived.name).toBe('bruno');
    expect(derived.firstName).toBe('bruno');
    expect(derived.initials).toBe('B');
  });

  it('rotula support_lead como "Líder de suporte"', () => {
    const derived = deriveCurrentUser(user({
      roles: [
        'support_lead',
        'support_analyst',
      ],
    }));

    expect(derived.role).toBe('Líder de suporte');
  });

  it('rotula support_analyst como "Analista de suporte"', () => {
    const derived = deriveCurrentUser(user({ roles: ['support_analyst'] }));

    expect(derived.role).toBe('Analista de suporte');
  });
});
