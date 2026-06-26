import { describe, expect, it } from 'vitest';
import { loginUrl } from './auth';
import { API_URL } from './config';

describe('loginUrl', () => {
  it('aponta para o início do fluxo OIDC sob a origem da API', () => {
    expect(loginUrl()).toBe(`${API_URL}/api/auth/login`);
    expect(loginUrl()).toMatch(/\/api\/auth\/login$/);
  });
});
