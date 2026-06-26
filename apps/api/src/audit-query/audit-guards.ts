import { BadRequestException } from '@nestjs/common';
import type { AuditWindowInterface } from './audit-query.types';

/**
 * Barra consultas cuja janela começa antes da data mínima confiável (`minQueryDate`). Antes dessa
 * data os dados são pré-contrato (sem `provider_name`/`provider_code`/`error` e com modelo antigo),
 * então responder sobre eles enganaria. Lança um erro acionável que o orquestrador repassa ao LLM
 * (que pede ao usuário uma janela a partir da data mínima). `null`/vazio desliga a guarda.
 *
 * @param {AuditWindowInterface | undefined} window - Janela resolvida da consulta.
 * @param {string | null} minQueryDate - Data mínima (ISO) de dados confiáveis; `null` = sem guarda.
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
    throw new BadRequestException({
      error: {
        code: 'min_query_date',
        message: `Os dados de auditoria são confiáveis a partir de ${minQueryDate}. `
          + 'Informe uma janela (date_from) igual ou posterior a essa data — consultas anteriores '
          + 'cairiam em dados pré-contrato (sem provedor/erro e com modelo antigo).',
      },
    });
  }
}

/**
 * Para janelas ROLANTES (presets `24h`/`7d`/`30d` ou default), recorta o início para a data mínima
 * confiável em vez de rejeitar — devolve a porção confiável (≥ `minQueryDate`). Para janelas
 * EXPLÍCITAS (o usuário pediu uma data) use {@link assertQueryWithinMinDate} (rejeita).
 *
 * @param {AuditWindowInterface | undefined} window - Janela rolante resolvida.
 * @param {string | null} minQueryDate - Data mínima (ISO); `null` = sem guarda (não recorta).
 * @returns {{ window: AuditWindowInterface | undefined; clamped: boolean }} Janela (recortada se preciso) + flag.
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

  return {
    window: {
      from: min,
      to: window?.to ?? null,
    },
    clamped: true,
  };
}
