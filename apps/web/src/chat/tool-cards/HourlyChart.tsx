import { useState, type JSX } from 'react';
import { APP_TZ_LABEL, formatDate, formatTime } from '../../util/time';
import { cssValue, cssVar } from '../../styles/tokens';

/** Ponto cronológico por hora (`at` = início do bucket, ISO 8601 UTC; `value` = métrica plotada). */
export interface HourlyPointInterface {
  at: string;
  value: number;
}

/** Altura do gráfico (px). */
const HEIGHT = 56;

/** Width of the SVG viewBox: 100, so an x in the viewBox is also a CSS percentage of the chart. */
const VIEWBOX_WIDTH = 100;

/** Headroom added above and below the plotted range, as a fraction of that range. */
const RANGE_PADDING_RATIO = 0.15;

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
 * @param props - Configuração do gráfico.
 * @param props.points - Buckets cronológicos (ISO UTC em `at`, número em `value`).
 * @param props.title - Título (caixa-alta) à esquerda do cabeçalho.
 * @param props.formatValue - Formata o valor (tooltip + máx/mín).
 * @param [props.clampMax] - Teto da escala padded (ex.: 100 para %); sem isso, usa o máx + folga.
 *
 * @returns O gráfico horário interativo.
 */
export function HourlyChart({
  points,
  title,
  formatValue,
  clampMax,
}: Readonly<{
  points: HourlyPointInterface[];
  title: string;
  formatValue: (value: number) => string;
  clampMax?: number
}>): JSX.Element {
  const [
    hover,
    setHover,
  ] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div style={{
        fontSize: 11,
        color: cssVar.fgSubtle,
      }}
      >
        Sem dados horários na janela.
      </div>
    );
  }

  const values = points.map((point) => point.value);
  const max = Math.max(...values);
  const min = Math.min(...values);

  const pad = (max - min) * RANGE_PADDING_RATIO;

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

  const pointX = (index: number): number => (index / lastIndex) * VIEWBOX_WIDTH;
  const pointY = (value: number): number => (1 - (value - lo) / span) * HEIGHT;

  const line = points
    .map((
      point,
      index,
    ) => `${index === 0
      ? 'M'
      : 'L'} ${pointX(index)} ${pointY(point.value)}`)
    .join(' ');

  const area = `${line} L ${VIEWBOX_WIDTH} ${HEIGHT} L 0 ${HEIGHT} Z`;

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
        justifyContent: cssValue.spaceBetween,
        alignItems: 'flex-end',
        marginBottom: cssVar.space4,
      }}
      >
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: cssVar.fgSubtle,
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
            color: cssVar.fgSubtle,
          }}
          >
            {` · ${APP_TZ_LABEL}`}
          </span>
        </div>
        <div style={{
          display: 'flex',
          gap: cssVar.space12,
          fontSize: 11,
          color: cssVar.fgMuted,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
        >
          <span>
            <b style={{ color: cssVar.fg }}>{formatValue(max)}</b> máx
          </span>
          <span>
            <b style={{ color: cssVar.fg }}>{formatValue(min)}</b> mín
          </span>
        </div>
      </div>

      <div style={{
        position: 'relative',
        height: HEIGHT,
        background: cssVar.bgSoft,
        border: cssVar.borderLine,
        borderRadius: cssVar.radius4,
      }}
      >
        <svg
          width="100%"
          height={HEIGHT}
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${HEIGHT}`}
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
                stopColor={cssVar.primary}
                stopOpacity="0.28"
              />
              <stop
                offset="100%"
                stopColor={cssVar.primary}
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
            stroke={cssVar.primary}
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
                background: cssVar.border,
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
                background: cssVar.primary,
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
              onMouseEnter={() => { setHover(index); }}
              onMouseLeave={() => { setHover(null); }}
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
              borderRadius: cssVar.radius4,
              background: cssVar.fg,
              color: cssVar.white,
              fontSize: 11,
              fontVariantNumeric: cssValue.tabularNums,
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
        marginTop: cssVar.space2,
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
              color: cssVar.fgSubtle,
              fontVariantNumeric: cssValue.tabularNums,
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
