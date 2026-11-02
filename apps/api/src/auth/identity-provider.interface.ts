import type { PermissionType, RoleType, UserStatusType } from '@atena/types';

/**
 * Identidade autenticada pelo IdP, normalizada para o domínio da Atena. É o que o provider OIDC
 * produz e o que o **cookie de sessão (JWT)** carrega — apenas identidade, **sem papéis** (os
 * papéis são gerenciados no app e resolvidos do banco a cada requisição).
 */
export interface AuthenticatedIdentityInterface {
  /** Identificador estável e único do usuário no IdP (claim `sub`). */
  sub: string;
  /** E-mail institucional (dentro do domínio permitido). */
  email: string;
  /** Nome de exibição (claim `name`). */
  name: string;
}

/**
 * Usuário resolvido para `request.user`: identidade + autorização (papéis/permissões/status),
 * montado pelo {@link AuthGuard} a partir do cookie (identidade) + do banco (papéis/status).
 */
export interface AuthenticatedUserInterface extends AuthenticatedIdentityInterface {
  /** Papéis atribuídos no app (vazio = acesso pendente). */
  roles: RoleType[];
  /** Permissões derivadas dos papéis. */
  permissions: PermissionType[];
  /** `active` | `disabled`. */
  status: UserStatusType;
  /** Super admin (derivado do env `auth.adminEmails`). */
  is_super_admin: boolean;
}

/** Desafio anti-CSRF/replay enviado na URL de autorização (OIDC authorization code + PKCE). */
export interface AuthorizationChallengeInterface {
  /** Valor opaco anti-CSRF, ecoado de volta no callback. */
  state: string;
  /** Liga o `id_token` a esta requisição (anti-replay). */
  nonce: string;
  /** Hash S256 do `code_verifier` (PKCE). */
  codeChallenge: string;
}

/** Desafio recuperado no callback (do cookie curto) para validar a troca do `code`. */
export interface CallbackChallengeInterface {
  /** `state` original, comparado com o ecoado pelo IdP. */
  state: string;
  /** `nonce` original, validado contra o `id_token`. */
  nonce: string;
  /** Segredo PKCE original (prova de posse do `code`). */
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
   * @param challenge - `state`/`nonce`/`codeChallenge`
   *   gerados pela aplicação para esta tentativa de login.
   *
   * @returns URL de autorização absoluta do IdP.
   */
  getAuthorizationUrl(challenge: AuthorizationChallengeInterface): Promise<string>;

  /**
   * Processa o callback do IdP: troca o `code` por tokens (validando `state`/`nonce`/PKCE),
   * extrai as claims e normaliza o resultado para o domínio da Atena.
   *
   * @param params - Query params recebidos no redirect
   *   (`code`, `state`, …).
   * @param challenge - Desafio original recuperado do cookie.
   *
   * @returns Identidade autenticada e normalizada.
   *
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
