/**
 * Metadata key the legacy {@link RolesGuard} reads through `Reflector`.
 *
 * @remarks
 * Access control moved to permissions (`@Requires` and `PermissionsGuard`); no handler sets this
 * key any more, so the roles guard always lets the request through. The unused `@Roles`
 * decorator that wrote it was removed.
 */
export const ROLES_KEY = 'roles';
