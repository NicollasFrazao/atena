/**
 * Provider LLM DETERMINÍSTICO para dev/local e testes — sem credencial do Bedrock.
 *
 * Emite a MESMA sequência de chunks que o Bedrock emitiria (tool_use / text_delta / stop),
 * com base em heurísticas simples sobre a conversa:
 *  - já há resultado de tool na conversa → texto final + stop('end_turn')
 *  - a última mensagem casa com uma tool  → tool_use + stop('tool_use')
 *  - nenhuma tool aplicável               → stop('refusal') (princípio: o sistema não fabrica dados)
 *
 * Troque por LLM_PROVIDER=bedrock quando houver credencial — sem mudar o orquestrador/tools.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ToolNameType } from '@atena/types';
import type {
  LlmConverseParamsInterface,
  LlmDescriptorInterface,
  LlmProviderInterface,
  LlmStreamChunkType,
} from './llm-provider.interface';

/**
 * Provider LLM determinístico para dev/local e testes (sem credencial do Bedrock).
 *
 * INVARIANTE: a IA nunca toca o banco — só PEDE tool calls; a aplicação executa as tools.
 * Emite a mesma sequência de chunks que o Bedrock emitiria, por heurística sobre a conversa.
 * Implementação trocável atrás de {@link LlmProviderInterface} (ver `LLM_PROVIDER` no módulo).
 */
@Injectable()
export class FakeLlmProvider implements LlmProviderInterface {
  /**
   * Identifica o provider/modelo ativo: `fake` (sem credencial), rotulado como `Simulado`.
   *
   * @returns {LlmDescriptorInterface} `{ provider: 'fake', model: 'Simulado' }`.
   */
  describe(): LlmDescriptorInterface {
    return {
      provider: 'fake',
      model: 'Simulado',
    };
  }

  /**
   * Conduz um turno de conversa determinístico:
   *  - já há resultado de tool na conversa → texto final + `stop('end_turn')`;
   *  - a última mensagem casa com uma tool  → `tool_use` + `stop('tool_use')`;
   *  - nenhuma tool aplicável               → `stop('refusal')` (nunca inventa dado).
   *
   * @param {LlmConverseParamsInterface} params - Sistema, histórico e catálogo de tools da rodada.
   * @returns {AsyncIterable<LlmStreamChunkType>} Stream de eventos simulando o provider real.
   */
  async *converseStream(params: LlmConverseParamsInterface): AsyncIterable<LlmStreamChunkType> {
    // 2º turno: a aplicação acabou de executar a tool e devolveu o resultado → resposta final.
    // Checa a ÚLTIMA mensagem (não `some`): resultados de tool de turnos ANTERIORES, reconstruídos
    // no histórico, não devem disparar resposta final num turno novo que ainda pode chamar uma tool.
    if (params.messages.at(-1)?.role === 'tool') {
      for (const piece of [
        'Pronto — ',
        'aqui está o que ',
        'os dados retornaram.',
      ]) {
        yield {
          type: 'text_delta',
          delta: piece,
        };
      }

      yield {
        type: 'usage',
        inputTokens: this.inputTokens(params),
        outputTokens: 12,
      };

      yield {
        type: 'stop',
        reason: 'end_turn',
      };

      return;
    }

    const text = this.lastUserText(params).toLowerCase();

    const tool = this.pickTool(
      text,
      params,
    );

    if (!tool) {
      // Sem tool aplicável → recusa explícita (nunca inventar dado).
      yield {
        type: 'usage',
        inputTokens: this.inputTokens(params),
        outputTokens: 1,
      };

      yield {
        type: 'stop',
        reason: 'refusal',
      };

      return;
    }

    yield {
      type: 'tool_use',
      id: randomUUID(),
      name: tool.name,
      args: tool.args,
    };

    yield {
      type: 'usage',
      inputTokens: this.inputTokens(params),
      outputTokens: 4,
    };

    yield {
      type: 'stop',
      reason: 'tool_use',
    };
  }

  /** Estimativa simples de tokens de entrada (~4 chars/token sobre o histórico enviado). */
  private inputTokens(params: LlmConverseParamsInterface): number {
    return Math.max(
      1,
      Math.ceil(JSON.stringify(params.messages).length / 4),
    );
  }

  /**
   * Extrai o texto da última mensagem `user` da conversa.
   *
   * @param {LlmConverseParamsInterface} params - Parâmetros da rodada de conversa.
   * @returns {string} Texto da última mensagem do usuário (serializado se não for string); vazio se não houver.
   */
  private lastUserText(params: LlmConverseParamsInterface): string {
    const last = [...params.messages].reverse().find((message) => message.role === 'user');

    if (typeof last?.content === 'string') {
      return last.content;
    }

    return last
      ? JSON.stringify(last.content)
      : '';
  }

  /**
   * Heurística texto → tool, restrita ao catálogo disponível em `params.tools`.
   *
   * @param {string} text - Texto (em minúsculas) da última mensagem do usuário.
   * @param {LlmConverseParamsInterface} params - Parâmetros da rodada; `tools` limita o catálogo permitido.
   * @returns {{ name: ToolNameType; args: Record<string, unknown> } | null} Tool escolhida com seus argumentos, ou `null` se nenhuma se aplica.
   */
  private pickTool(
    text: string,
    params: LlmConverseParamsInterface,
  ): {
    name: ToolNameType;
    args: Record<string, unknown>
  } | null {
    const allowed = new Set((params.tools ?? []).map((tool) => tool.name));

    const phone = text.match(/\+?\d[\d\s().-]{7,}\d/)?.[0]?.replace(
      /[\s().-]/g,
      '',
    );

    const candidates: Array<{
      when: boolean;
      name: ToolNameType;
      args: Record<string, unknown>
    }> = [
      {
        when: /trilha|trail|eventos/.test(text),
        name: 'get_shipping_trail',
        args: {},
      },
      {
        when: /risco|an[áa]lise|conte[úu]do/.test(text),
        name: 'analyze_shipping_content',
        args: {},
      },
      {
        when: /relat[óo]rio|report|entrega/.test(text),
        name: 'generate_delivery_report',
        args: {},
      },
      {
        when: /fornecedor|provider/.test(text),
        name: 'list_providers',
        args: {},
      },
      {
        when: /cliente|customer/.test(text),
        name: 'list_customers',
        args: {},
      },
      {
        when: Boolean(phone) || /status|busca|buscar|mensage/.test(text),
        name: 'search_shippings',
        args: phone
          ? { phone }
          : {},
      },
    ];

    for (const candidate of candidates) {
      if (
        candidate.when
        && (allowed.size === 0
        || allowed.has(candidate.name))
      ) {
        return {
          name: candidate.name,
          args: candidate.args,
        };
      }
    }

    return null;
  }
}
