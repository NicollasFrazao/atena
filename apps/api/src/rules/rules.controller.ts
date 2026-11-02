import {
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import type { AnomalyRuleInterface } from '@atena/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUserInterface } from '../auth/identity-provider.interface';
import { Requires } from '../auth/rbac/requires.decorator';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { RulesService } from './rules.service';

/**
 * Endpoints da tela de Regras (`/rules`): leitura e edição de `anomaly_rules`.
 * Configuração via UI (não é tool do LLM); a edição é auditada (`rule_update`).
 *
 * @see RulesService - leitura/edição + audit.
 */
@Controller('rules')
export class RulesController {
  /**
   * @param rules - Serviço de regras de anomalia.
   */
  constructor(private readonly rules: RulesService) {}

  /**
   * `GET /rules` — lista todas as regras de anomalia.
   *
   * @returns Regras (snake_case).
   */
  @Get()
  @Requires('rules:view')
  list(): Promise<AnomalyRuleInterface[]> {
    return this.rules.list();
  }

  /**
   * `PUT /rules/:id` — edita campos permitidos da regra (`rule_type` imutável).
   *
   * @param id - Id da regra.
   * @param body - Campos a atualizar (parcial).
   * @param [user] - Operador autenticado.
   *
   * @returns Regra atualizada.
   */
  @Put(':id')
  @Requires('rules:edit')
  update(
    @Param('id') id: string,
    @Body() body: UpdateRuleDto,
    @CurrentUser() user?: AuthenticatedUserInterface,
  ): Promise<AnomalyRuleInterface> {
    return this.rules.update(
      id,
      body,
      user?.sub,
    );
  }
}
