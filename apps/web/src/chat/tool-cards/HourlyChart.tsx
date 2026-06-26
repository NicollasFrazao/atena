import { useState } from 'react';
import { APP_TZ_LABEL, formatDate, formatTime } from '../../util/time';

/** Ponto cronológico por hora (`at` = início do bucket, ISO 8601 UTC; `value` = métrica plotada). */
export interface HourlyPointInterface {
  at: string;
  value: number;
}

/** Altura do gráfico (px). */
const HEIGHT = 56;

/** Quantidade alvo de rótulos no eixo X. */
const LABEL_COUNT = 5;

/** Formata o `at` (ISO UTC) em data (DD/MM) e hora (HHh) **no fuso de exibição** do app. */
function formatBucket(at: string): {
  date: string;
  hour: string;
} {
  return {
    date: formatDate(at),
    // formatTime devolve "HH:mm" no fuso; o eixo mostra só a hora.
    hour: `${formatTime(at).slice(
      0,
      2,
    )}h`,
  };
}

/** Índices (de 0..n-1) onde colocar rótulos no eixo — sempre inclui o primeiro e o último. */
function labelIndices(count: number): number[] {
  if (count <= LABEL_COUNT) {
    return Array.from(
      { length: count },
      (
        _unused,
        index,
      ) => index,
    );
  }

  return Array.from(
    { length: LABEL_COUNT },
    (
      _unused,
      index,
    ) => Math.round((index * (count - 1)) / (LABEL_COUNT - 1)),
  );
}

/**
 * Gráfico cronológico POR HORA (não por hora-do-dia), com eixo de data+hora — quando a janela cruza
 * dias, o rótulo mostra o dia em que ele muda. Os extremos (máx/mín) vão no topo (sem eixo Y) e ao
 * passar o mouse uma coluna por bucket destaca o ponto e mostra `DD/MM HHh · <valor>`. Genérico:
 * usado pela taxa de entrega (%) e pelo consumo de tokens, via `formatValue` + `clampMax`.
 *
 * @param {object} props - Configuração do gráfico.
 * @param {HourlyPointInterface[]} props.points - Buckets cronológicos (ISO UTC em `at`, número em `value`).
 * @param {string} props.title - Título (caixa-alta) à esquerda do cabeçalho.
 * @param {(value: number) => string} props.formatValue - Formata o valor (tooltip + máx/mín).
 * @param {number} [props.clampMax] - Teto da escala padded (ex.: 100 para %); sem isso, usa o máx + folga.
 * @returns {JSX.Element} O gráfico horário interativo.
 */
export function HourlyChart({
  points,
  title,
  formatValue,
  clampMax,
}: {
  points: HourlyPointInterface[];
  title: string;
  formatValue: (value: number) => string;
  clampMax?: number
}): JSX.Element {
  const [
    hover,
    setHover,
  ] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div style={{
        fontSize: 11,
        color: 'var(--at-fg-subtle)',
      }}
      >
        Sem dados horários na janela.
      </div>
    );
  }

  const values = points.map((point) => point.value);
  const max = Math.max(...values);
  const min = Math.min(...values);

  const pad = (max - min) * 0.15;

  const lo = Math.max(
    0,
    min - pad,
  );

  const hi = Math.min(
    clampMax ?? Number.POSITIVE_INFINITY,
    max + pad,
  );

  const span = hi - lo || 1;

  const lastIndex = Math.max(
    1,
    points.length - 1,
  );

  const pointX = (index: number): number => (index / lastIndex) * 100;
  const pointY = (value: number): number => (1 - (value - lo) / span) * HEIGHT;

  const line = points
    .map((
      point,
      index,
    ) => `${index === 0
      ? 'M'
      : 'L'} ${pointX(index)} ${pointY(point.value)}`)
    .join(' ');

  const area = `${line} L 100 ${HEIGHT} L 0 ${HEIGHT} Z`;

  const hovered = hover !== null
    ? formatBucket(points[hover].at)
    : null;

  // Rótulos do eixo: mostra a DATA quando ela muda (1º rótulo sempre; depois, a cada virada de dia).
  let previousDate: string | null = null;

  const axis = labelIndices(points.length).map((index) => {
    const {
      date,
      hour,
    } = formatBucket(points[index].at);

    const showDate = date !== previousDate;
    previousDate = date;

    return {
      index,
      text: showDate
        ? `${date} ${hour}`
        : hour,
    };
  });

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 'var(--at-space-4)',
      }}
      >
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--at-fg-subtle)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        >
          {title}
          <span style={{
            textTransform: 'none',
            fontWeight: 400,
            color: 'var(--at-fg-subtle)',
          }}
          >
            {` · ${APP_TZ_LABEL}`}
          </span>
        </div>
        <div style={{
          display: 'flex',
          gap: 'var(--at-space-12)',
          fontSize: 11,
          color: 'var(--at-fg-muted)',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
        >
          <span>
            <b style={{ color: 'var(--at-fg)' }}>{formatValue(max)}</b> máx
          </span>
          <span>
            <b style={{ color: 'var(--at-fg)' }}>{formatValue(min)}</b> mín
          </span>
        </div>
      </div>

      <div style={{
        position: 'relative',
        height: HEIGHT,
        background: 'var(--at-bg-soft)',
        border: '1px solid var(--at-border)',
        borderRadius: 'var(--at-radius-4)',
      }}
      >
        <svg
          width="100%"
          height={HEIGHT}
          viewBox={`0 0 100 ${HEIGHT}`}
          preserveAspectRatio="none"
          style={{ display: 'block' }}
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="report-spark-grad"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor="var(--at-primary)"
                stopOpacity="0.28"
              />
              <stop
                offset="100%"
                stopColor="var(--at-primary)"
                stopOpacity="0"
              />
            </linearGradient>
          </defs>
          <path
            d={area}
            fill="url(#report-spark-grad)"
            stroke="none"
          />
          <path
            d={line}
            stroke="var(--at-primary)"
            strokeWidth="1.5"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Ponto + guia do bucket sob o cursor (HTML, para não distorcer com o preserveAspectRatio). */}
        {hover !== null
          ? (
            <>
              <div style={{
                position: 'absolute',
                left: `${pointX(hover)}%`,
                top: 0,
                bottom: 0,
                width: 1,
                background: 'var(--at-border)',
                transform: 'translateX(-0.5px)',
              }}
              />
              <div style={{
                position: 'absolute',
                left: `${pointX(hover)}%`,
                top: pointY(points[hover].value),
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--at-primary)',
                border: '1.5px solid var(--at-white)',
                transform: 'translate(-50%, -50%)',
              }}
              />
            </>
          )
          : null}

        {/* Colunas de hover (uma por bucket). */}
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
        }}
        >
          {points.map((
            point,
            index,
          ) => (
            <div
              key={point.at}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              style={{
                flex: 1,
                cursor: 'crosshair',
              }}
            />
          ))}
        </div>

        {/* Tooltip DD/MM HHh · <valor> */}
        {hover !== null && hovered !== null
          ? (
            <div style={{
              position: 'absolute',
              left: `${pointX(hover)}%`,
              top: -6,
              transform: 'translate(-50%, -100%)',
              padding: '3px 7px',
              borderRadius: 'var(--at-radius-4)',
              background: 'var(--at-fg)',
              color: 'var(--at-white)',
              fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
            >
              {`${hovered.date} ${hovered.hour} · ${formatValue(points[hover].value)}`}
            </div>
          )
          : null}
      </div>

      <div style={{
        position: 'relative',
        height: 14,
        marginTop: 'var(--at-space-2)',
      }}
      >
        {axis.map((label) => (
          <span
            key={label.index}
            style={{
              position: 'absolute',
              left: `${pointX(label.index)}%`,
              transform: alignLabel(
                label.index,
                lastIndex,
              ),
              fontSize: 10,
              color: 'var(--at-fg-subtle)',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {label.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Alinha o rótulo: o 1º à esquerda, o último à direita, os demais centrados. */
function alignLabel(
  index: number,
  lastIndex: number,
): string {
  if (index === 0) {
    return 'none';
  }

  if (index === lastIndex) {
    return 'translateX(-100%)';
  }

  return 'translateX(-50%)';
}
