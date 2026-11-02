import { Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type {
  Namespace,
  Socket,
} from 'socket.io';
import type {
  RoleType,
  WsServerEvent,
} from '@atena/types';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { MetricsService } from '../observability/metrics.service';

/** Papéis do usuário stub de dev (quando `auth.devBypass` está ligado). */
const DEV_ROLES: RoleType[] = [
  'support_analyst',
  'support_lead',
];

/**
 * Origins do frontend permitidas no CORS do handshake WS (cookie cross-origin exige allowlist +
 * credenciais; `*` não vale). Lido do env no load (mesma fonte de `auth.corsOrigins`).
 */
const WS_CORS_ORIGINS = (
  process.env.CORS_ORIGINS
  ?? process.env.WEB_ORIGIN
  ?? 'http://localhost:5173,http://localhost:8080'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Identidade mínima associada a uma conexão WS. */
interface WsUserInterface {
  sub: string;
  roles: RoleType[];
}

/** What this gateway keeps in `socket.data` (socket.io types it as `any`). */
interface SupportSocketDataInterface {
  /** The user authenticated in the handshake. */
  user?: WsUserInterface;
}

/**
 * Gateway de tempo real do suporte (`/ws/support`, socket.io).
 *
 * Empurra eventos de incidente ({@link WsServerEvent}) aos operadores conectados:
 * `incident.created`/`auto_resolved` (detector) e `incident.updated` (lifecycle).
 * Ack/resolve continuam por REST (validação §D) — aqui é só push.
 *
 * Auth no handshake: **cookie de sessão** (`atena_session`, JWT verificado pelo {@link AuthService}).
 * Fallback de dev: com `auth.devBypass` ligado, aceita sem cookie (igual ao REST).
 *
 * @see WsServerEvent - união discriminada dos eventos servidor→cliente.
 */
@WebSocketGateway({
  namespace: '/ws/support',
  cors: {
    origin: WS_CORS_ORIGINS,
    credentials: true,
  },
})
export class SupportGateway implements OnGatewayConnection, OnGatewayDisconnect {
  /** Set by Nest when the gateway starts; `undefined` until then. */
  @WebSocketServer()
  private readonly server?: Namespace;

  /** Pico de conexões simultâneas observado nesta instância (high-water; reseta no restart). */
  private peakConnectionCount = 0;

  /**
   * @param config - Fonte de `auth.devBypass` e nome do cookie de sessão.
   * @param authService - Verifica o JWT do cookie de sessão no handshake.
   * @param users - Resolve papéis/status do banco (recusa `disabled`).
   * @param [metrics] - Métricas custom (opcional).
   */
  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    private readonly users: UsersService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Autentica o handshake e confirma a conexão (`connection.status`); recusa sem identidade.
   *
   * @param client - Socket recém-conectado.
   */
  async handleConnection(client: Socket): Promise<void> {
    const user = await this.resolveUser(client);

    if (!user) {
      client.disconnect(true);

      return;
    }

    (client.data as SupportSocketDataInterface).user = user;

    this.peakConnectionCount = Math.max(
      this.peakConnectionCount,
      this.connectionCount(),
    );

    this.metrics?.gauge(
      'ws.connections',
      this.connectionCount(),
    );

    client.emit(
      'connection.status',
      {
        type: 'connection.status',
        ok: true,
      },
    );
  }

  /**
   * Atualiza a gauge de conexões quando um socket desconecta. Sem isso o valor só era escrito no
   * connect e ficava stale até a próxima conexão (atrapalha a observabilidade em baixa rotatividade).
   * O socket que sai já foi removido do namespace → `connectionCount()` é acurado aqui.
   */
  handleDisconnect(): void {
    this.metrics?.gauge(
      'ws.connections',
      this.connectionCount(),
    );
  }

  /**
   * Empurra um evento a todos os operadores conectados (MVP: sem filtro por papel).
   *
   * @param event - Evento servidor→cliente a emitir.
   */
  broadcast(event: WsServerEvent): void {
    this.server?.emit(
      event.type,
      event,
    );
  }

  /**
   * Número de conexões ativas no namespace (observabilidade).
   *
   * @returns Sockets conectados; `0` se o servidor ainda não subiu.
   */
  connectionCount(): number {
    return this.server?.sockets.size ?? 0;
  }

  /**
   * Pico de conexões simultâneas observado desde o boot (high-water).
   *
   * @returns Maior nº de conexões simultâneas já visto; `0` se nunca conectou.
   */
  peakConnections(): number {
    return this.peakConnectionCount;
  }

  /**
   * Lê o cookie de sessão (`atena_session`) do header `Cookie` do handshake, quando presente.
   *
   * @param [header] - Valor do header `Cookie` do handshake.
   *
   * @returns O JWT do cookie de sessão, ou `undefined`.
   */
  private sessionCookie(header?: string): string | undefined {
    if (!header) {
      return undefined;
    }

    const cookieName = this.config.get<string>('auth.session.cookieName') ?? 'atena_session';

    const match = header
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`));

    return match
      ? decodeURIComponent(match.slice(cookieName.length + 1))
      : undefined;
  }

  /**
   * Resolve a identidade do handshake: cookie de sessão (JWT verificado) + papéis/status do banco,
   * ou dev-bypass. Recusa (`null`) cookie inválido ou usuário `disabled`.
   *
   * @param client - Socket com os dados do handshake.
   *
   * @returns Usuário associado, ou `null` se não autenticado.
   */
  private async resolveUser(client: Socket): Promise<WsUserInterface | null> {
    const token = this.sessionCookie(client.handshake.headers.cookie);

    if (token) {
      try {
        const identity = this.authService.verifySession(token);
        const access = await this.users.resolveAccess(identity.sub);

        if (access.status === 'disabled') {
          return null;
        }

        return {
          sub: identity.sub,
          roles: access.roles,
        };
      } catch {
        return null;
      }
    }

    if (this.config.get<boolean>('auth.devBypass')) {
      return {
        sub: 'dev-user',
        roles: DEV_ROLES,
      };
    }

    return null;
  }
}
