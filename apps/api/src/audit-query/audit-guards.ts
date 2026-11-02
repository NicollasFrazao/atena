import { BadRequestException } from '@nestjs/common';
import type { AuditWindowInterface } from './audit-query.types';

/**
 * Erro acionável (código `min_query_date`) para janelas fora do período confiável. O orquestrador o
 * repassa ao LLM, que explica ao usuário e pede uma janela a partir de `minQueryDate`.
 *
 * @param minQueryDate - Data mínima (ISO) de dados confiáveis, ecoada na mensagem.
 *
 * @returns Exceção com `error.code = 'min_query_date'`.
 */
function minQueryDateError(minQueryDate: string): BadRequestException {
  return new BadRequestException({
    error: {
      code: 'min_query_date',
      message: `Os dados de auditoria são confiáveis a partir de ${minQueryDate}. `
        + 'Informe uma janela (date_from) igual ou posterior a essa data — consultas anteriores '
        + 'cairiam em dados pré-contrato (sem provedor/erro e com modelo antigo).',
    },
  });
}

/**
 * Barra consultas cuja janela começa antes da data mínima confiável (`minQueryDate`). Antes dessa
 * data os dados são pré-contrato (sem `provider_name`/`provider_code`/`error` e com modelo antigo),
 * então responder sobre eles enganaria. Lança um erro acionável que o orquestrador repassa ao LLM
 * (que pede ao usuário uma janela a partir da data mínima). `null`/vazio desliga a guarda.
 *
 * @param window - Janela resolvida da consulta.
 * @param minQueryDate - Data mínima (ISO) de dados confiáveis; `null` = sem guarda.
 *
 * @throws {BadRequestException} Se a janela for ausente/aberta ou começar antes de `minQueryDate`.
 */
export function assertQueryWithinMinDate(
  window: AuditWindowInterface | undefined,
  minQueryDate: string | null,
): void {
  if (!minQueryDate) {
    return;
  }

  const min = new Date(minQueryDate);
  const from = window?.from ?? null;

  if (
    !from
    || from.getTime() < min.getTime()
  ) {
    throw minQueryDateError(minQueryDate);
  }
}

/**
 * Recorta o início da janela para a data mínima confiável (`minQueryDate`) em vez de rejeitar quando
 * há SOBREPOSIÇÃO — devolve a porção confiável (≥ `minQueryDate`). Cobre presets rolantes
 * (`24h`/`7d`/`30d`, `to` aberto) e datas explícitas que começam antes mas terminam depois do piso.
 *
 * PORÉM: se a janela termina em/antes do piso (`to ≤ min` — ex.: "dia 03/05" com piso em 18/06), NÃO
 * há porção confiável alguma. Recortar só o início produziria uma janela INVERTIDA (`from > to`) que
 * retorna 0 silenciosamente e confunde ("18/06 → 04/05"). Nesse caso REJEITA com o erro acionável
 * `min_query_date` — o usuário entende que a data pedida é anterior ao período confiável.
 *
 * @param window - Janela resolvida (rolante ou explícita).
 * @param minQueryDate - Data mínima (ISO); `null` = sem guarda (não recorta).
 *
 * @returns Janela (recortada se preciso) + flag.
 *
 * @throws {BadRequestException} Se a janela inteira for anterior ao piso (`to ≤ minQueryDate`).
 */
export function clampWindowToMinDate(
  window: AuditWindowInterface | undefined,
  minQueryDate: string | null,
): {
  window: AuditWindowInterface | undefined;
  clamped: boolean;
} {
  if (!minQueryDate) {
    return {
      window,
      clamped: false,
    };
  }

  const min = new Date(minQueryDate);
  const from = window?.from ?? null;

  if (
    from
    && from.getTime() >= min.getTime()
  ) {
    return {
      window,
      clamped: false,
    };
  }

  // Janela inteira antes do piso (fim exclusivo ≤ piso): sem porção confiável — recortar inverteria a
  // janela. Rejeita com mensagem acionável em vez de devolver [min, to) invertida (0 resultados mudos).
  const to = window?.to ?? null;

  if (
    to
    && to.getTime() <= min.getTime()
  ) {
    throw minQueryDateError(minQueryDate);
  }

  return {
    window: {
      from: min,
      to,
    },
    clamped: true,
  };
}
