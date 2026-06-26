import type { PermissionType, RoleType, UserStatusType } from '@atena/types';

/**
 * Identidade autenticada pelo IdP, normalizada para o domínio da Atena. É o que o provider OIDC
 * produz e o que o **cookie de sessão (JWT)** carrega — apenas identidade, **sem papéis** (os
 * papéis são gerenciados no app e resolvidos do banco a cada requisição).
 *
 * @property {string} sub - Identificador estável e único do usuário no IdP (claim `sub`).
 * @property {string} email - E-mail institucional (dentro do domínio permitido).
 * @property {string} name - Nome de exibição (claim `name`).
 */
export interface AuthenticatedIdentityInterface {
  sub: string;
  email: string;
  name: string;
}

/**
 * Usuário resolvido para `request.user`: identidade + autorização (papéis/permissões/status),
 * montado pelo {@link AuthGuard} a partir do cookie (identidade) + do banco (papéis/status).
 *
 * @property {RoleType[]} roles - Papéis atribuídos no app (vazio = acesso pendente).
 * @property {PermissionType[]} permissions - Permissões derivadas dos papéis.
 * @property {UserStatusType} status - `active` | `disabled`.
 * @property {boolean} is_super_admin - Super admin (derivado do env `auth.adminEmails`).
 */
export interface AuthenticatedUserInterface extends AuthenticatedIdentityInterface {
  roles: RoleType[];
  permissions: PermissionType[];
  status: UserStatusType;
  is_super_admin: boolean;
}

/**
 * Desafio anti-CSRF/replay enviado na URL de autorização (OIDC authorization code + PKCE).
 *
 * @property {string} state - Valor opaco anti-CSRF, ecoado de volta no callback.
 * @property {string} nonce - Liga o `id_token` a esta requisição (anti-replay).
 * @property {string} codeChallenge - Hash S256 do `code_verifier` (PKCE).
 */
export interface AuthorizationChallengeInterface {
  state: string;
  nonce: string;
  codeChallenge: string;
}

/**
 * Desafio recuperado no callback (do cookie curto) para validar a troca do `code`.
 *
 * @property {string} state - `state` original, comparado com o ecoado pelo IdP.
 * @property {string} nonce - `nonce` original, validado contra o `id_token`.
 * @property {string} codeVerifier - Segredo PKCE original (prova de posse do `code`).
 */
export interface CallbackChallengeInterface {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * Contrato de um provedor de identidade (IdP) plugável para login social
 * institucional via OIDC.
 *
 * A aplicação fala SEMPRE com esta interface — nunca com um IdP concreto —
 * para que trocar de provider (Entra ID, Google Workspace, Keycloak, …)
 * seja só uma questão de mudar o binding no {@link AuthModule}.
 *
 * Invariante: toda implementação deve validar o domínio institucional e
 * devolver uma {@link AuthenticatedIdentityInterface} (apenas identidade) já normalizada;
 * o RBAC é resolvido depois pela aplicação (banco), não pelo IdP.
 */
export interface IdentityProviderInterface {
  /**
   * Monta a URL de autorização do IdP para a qual o navegador será redirecionado,
   * iniciando o fluxo de login social (OIDC authorization code + PKCE).
   *
   * @param {AuthorizationChallengeInterface} challenge - `state`/`nonce`/`codeChallenge`
   *   gerados pela aplicação para esta tentativa de login.
   * @returns {Promise<string>} URL de autorização absoluta do IdP.
   */
  getAuthorizationUrl(challenge: AuthorizationChallengeInterface): Promise<string>;

  /**
   * Processa o callback do IdP: troca o `code` por tokens (validando `state`/`nonce`/PKCE),
   * extrai as claims e normaliza o resultado para o domínio da Atena.
   *
   * @param {Record<string, string>} params - Query params recebidos no redirect
   *   (`code`, `state`, …).
   * @param {CallbackChallengeInterface} challenge - Desafio original recuperado do cookie.
   * @returns {Promise<AuthenticatedIdentityInterface>} Identidade autenticada e normalizada.
   * @throws {UnauthorizedException} Se o e-mail estiver fora do domínio institucional
   *   permitido, o `state`/`nonce` não baterem ou as claims forem inválidas.
   */
  handleCallback(
    params: Record<string, string>,
    challenge: CallbackChallengeInterface,
  ): Promise<AuthenticatedIdentityInterface>;
}

/**
 * Token de injeção de dependência (DI) usado para resolver a implementação
 * concreta do {@link IdentityProviderInterface}.
 *
 * É o ponto único de troca de IdP: o {@link AuthModule} amarra este token a um
 * provider específico, e todo o app injeta por ele em vez de uma classe concreta.
 */
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');
