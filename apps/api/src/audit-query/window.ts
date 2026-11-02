import type { AuditWindowInterface } from './audit-query.types';
import { MS_PER_DAY } from '../common/units';
import { appTimeZone, resolveBoundInTz, startOfRecentDays } from './tz';

/** Presets de "últimos N dias-calendário" (alinhados ao fuso). `24h` é rolante; `all` é sem limite. */
const PRESET_DAYS: Partial<Record<string, number>> = {
  '7d': 7,
  '30d': 30,
};

/** Entrada de janela na borda da API: datas explícitas (ISO 8601) ou um atalho `date_range`. */
export interface WindowInputInterface {
  date_from?: string;
  date_to?: string;
  date_range?: string;
}

/**
 * Resolve a janela temporal a partir da borda, **no fuso de exibição** (default `APP_TIMEZONE`):
 * `date_from`/`date_to` (têm precedência) → atalho `date_range` → `undefined` (default do motor).
 * Fonte única reusada por search, catálogo e relatórios (evita divergência de presets).
 *
 * Semântica de fuso (edge de ENTRADA; o motor segue UTC):
 * - **Dia nomeado** (`date_from`/`date_to` como `YYYY-MM-DD`) é interpretado no fuso (00:00 local →
 *   instante UTC); `date_to` só-dia cobre o dia inteiro (fim exclusivo = início do dia seguinte).
 *   Datas com hora (ISO completo) são instantes absolutos e passam direto.
 * - **`24h`** é rolante (`agora − 24h`): duração, independe de fuso.
 * - **`7d`/`30d`** são N dias-calendário **no fuso** (do início do dia mais antigo até agora).
 * - **`all`** = sem limite inferior.
 *
 * @param input - Datas/atalho vindos da requisição.
 * @param [timeZone] - Fuso IANA de interpretação (default {@link appTimeZone}).
 * @param [now] - Instante de referência (default: agora).
 *
 * @returns Janela resolvida (em UTC), ou `undefined` (default do motor).
 */
export function resolveWindow(
  input: WindowInputInterface,
  timeZone: string = appTimeZone(),
  now: Date = new Date(),
): AuditWindowInterface | undefined {
  if (
    input.date_from
    || input.date_to
  ) {
    return {
      from: input.date_from
        ? resolveBoundInTz(
          input.date_from,
          timeZone,
          false,
        )
        : null,
      to: input.date_to
        ? resolveBoundInTz(
          input.date_to,
          timeZone,
          true,
        )
        : null,
    };
  }

  if (input.date_range) {
    return presetWindow(
      input.date_range,
      timeZone,
      now,
    );
  }

  return undefined;
}

/**
 * Resolve a janela de um atalho `date_range` no fuso.
 *
 * @param range - Atalho (`24h`/`7d`/`30d`/`all`).
 * @param timeZone - Fuso IANA.
 * @param now - Instante de referência.
 *
 * @returns Janela (UTC), ou `undefined` p/ atalho desconhecido.
 */
function presetWindow(
  range: string,
  timeZone: string,
  now: Date,
): AuditWindowInterface | undefined {
  if (range === '24h') {
    return {
      from: new Date(now.getTime() - MS_PER_DAY),
      to: null,
    };
  }

  if (range === 'all') {
    return {
      from: null,
      to: null,
    };
  }

  const days = PRESET_DAYS[range];

  if (days !== undefined) {
    return {
      from: startOfRecentDays(
        days - 1,
        timeZone,
        now,
      ),
      to: null,
    };
  }

  return undefined;
}
