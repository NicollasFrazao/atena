import type { Request } from 'express';

/** The part of Express's matched route that names it (Express types the whole route as `any`). */
interface MatchedRouteInterface {
  /** Route template, e.g. `/shippings/:id`. */
  path?: string;
}

/**
 * Path of a request without its query string: the matched route template (e.g. `/shippings/:id`)
 * when Express matched one, else `request.path`. Never `originalUrl`/`url`, which would carry query
 * parameters (and PII such as `phone=...`) into logs and the audit log.
 *
 * @param request - The request in progress.
 *
 * @returns The route template, or the request path.
 */
export function routePath(request: Request): string {
  // `request.route` is `any` in @types/express and is absent until a route matches.
  const route = request.route as MatchedRouteInterface | undefined;

  return route?.path ?? request.path;
}
