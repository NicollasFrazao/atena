import type { Request } from 'express';
import { routePath } from './route-path';

describe('routePath', () => {
  it('returns the matched route template', () => {
    const request = {
      route: { path: '/shippings/:id' },
      path: '/shippings/42',
    } as unknown as Request;

    expect(routePath(request)).toBe('/shippings/:id');
  });

  it('falls back to the request path when no route matched', () => {
    const request = { path: '/unknown' } as unknown as Request;

    expect(routePath(request)).toBe('/unknown');
  });
});
