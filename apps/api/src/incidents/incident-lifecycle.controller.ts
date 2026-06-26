import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import type {
  IncidentActivityInterface,
  IncidentInterface,
} from '@atena/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUserInterface } from '../auth/identity-provider.interface';
import { Requires } from '../auth/rbac/requires.decorator';
import { AddCommentDto } from './dto/add-comment.dto';
import { ResolveIncidentDto } from './dto/resolve-incident.dto';
import { IncidentLifecycleService } from './incident-lifecycle.service';

/** Incidente com a trilha de atividades (shape de saída do lifecycle). */
type IncidentWithActivitiesType = IncidentInterface & { activities: IncidentActivityInterface[] };

/**
 * Endpoints de LIFECYCLE de incidentes (`/incidents`), **UI-only e não-LLM**:
 * `acknowledge`/`resolve`/`comment`, com validação server-side (§D). O LLM nunca
 * muda estado (princípio 3) — ele só LÊ via {@link IncidentsController}.
 *
 * @see IncidentLifecycleService - regras de transição, atividade e audit.
 */
@Controller('incidents')
export class IncidentLifecycleController {
  /**
   * @param {IncidentLifecycleService} lifecycle - Serviço de mudança de estado de incidentes.
   */
  constructor(private readonly lifecycle: IncidentLifecycleService) {}

  /**
   * `POST /incidents/:id/acknowledge` — reconhece (`detected` → `acknowledged`).
   *
   * @param {string} id - Id do incidente.
   * @param {AuthenticatedUserInterface} [user] - Operador autenticado.
   *
   * @returns {Promise<IncidentWithActivitiesType>} Incidente atualizado + atividades.
   */
  @Post(':id/acknowledge')
  @Requires('incidents:ack')
  @HttpCode(HttpStatus.OK)
  acknowledge(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUserInterface,
  ): Promise<IncidentWithActivitiesType> {
    return this.lifecycle.acknowledge(
      id,
      user?.sub,
    );
  }

  /**
   * `POST /incidents/:id/resolve` — resolve manualmente, com validação §D.
   *
   * @param {string} id - Id do incidente.
   * @param {ResolveIncidentDto} body - Categoria/descrição da ação (+ escalonamento/tags).
   * @param {AuthenticatedUserInterface} [user] - Operador autenticado.
   *
   * @returns {Promise<IncidentWithActivitiesType>} Incidente resolvido + atividades.
   */
  @Post(':id/resolve')
  @Requires('incidents:resolve')
  @HttpCode(HttpStatus.OK)
  resolve(
    @Param('id') id: string,
    @Body() body: ResolveIncidentDto,
    @CurrentUser() user?: AuthenticatedUserInterface,
  ): Promise<IncidentWithActivitiesType> {
    return this.lifecycle.resolve(
      id,
      body,
      user?.sub,
    );
  }

  /**
   * `POST /incidents/:id/comment` — adiciona um comentário (sem mudar estado).
   *
   * @param {string} id - Id do incidente.
   * @param {AddCommentDto} body - Texto do comentário.
   * @param {AuthenticatedUserInterface} [user] - Operador autenticado.
   *
   * @returns {Promise<IncidentActivityInterface>} Atividade de comentário criada.
   */
  @Post(':id/comment')
  @Requires('incidents:comment')
  comment(
    @Param('id') id: string,
    @Body() body: AddCommentDto,
    @CurrentUser() user?: AuthenticatedUserInterface,
  ): Promise<IncidentActivityInterface> {
    return this.lifecycle.addComment(
      id,
      body.text,
      user?.sub,
    );
  }
}
