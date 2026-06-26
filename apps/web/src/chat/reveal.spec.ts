import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../api/client';
import { revealContent, revealPhone } from './reveal';

vi.mock(
  '../api/client',
  () => ({ apiFetch: vi.fn() }),
);

const mockFetch = vi.mocked(apiFetch);

describe('reveal', () => {
  beforeEach(() => mockFetch.mockReset());

  it('revealPhone faz POST em /shippings/:id/reveal-phone', async () => {
    mockFetch.mockResolvedValue({
      shipping_id: 'm1',
      phone_full: '+5511987651234',
    });

    const out = await revealPhone('m1');

    expect(mockFetch).toHaveBeenCalledWith(
      '/shippings/m1/reveal-phone',
      { method: 'POST' },
    );

    expect(out.phone_full).toBe('+5511987651234');
  });

  it('revealContent faz POST em /shippings/:id/reveal-content', async () => {
    mockFetch.mockResolvedValue({
      shipping_id: 'm1',
      content_preview: 'Olá, seu código é 1234',
    });

    const out = await revealContent('m1');

    expect(mockFetch).toHaveBeenCalledWith(
      '/shippings/m1/reveal-content',
      { method: 'POST' },
    );

    expect(out.content_preview).toContain('1234');
  });
});
