import type { JSX } from 'react';
import { ShieldCheckIcon as ShieldCheck } from '@phosphor-icons/react';
import { type RiskAnalysisInterface, type RiskVerdictType } from '@atena/types';
import { ToolResultFrame } from './ToolResultFrame';
import { cssValue, cssVar } from '../../styles/tokens';
import { PERCENT_SCALE } from '../../util/units';

/** Rótulo (pt-BR) e cores de um veredito de risco. */
interface VerdictVisualInterface {
  label: string;
  color: string;
  background: string;
}

/** Rótulo (pt-BR) e cores por veredito de risco. */
const VERDICT_VISUALS: Record<RiskVerdictType, VerdictVisualInterface> = {
  low: {
    label: 'Baixo',
    color: cssVar.success300,
    background: cssVar.success50,
  },
  medium: {
    label: 'Médio',
    color: cssVar.warning300,
    background: cssVar.warning50,
  },
  high: {
    label: 'Alto',
    color: cssVar.danger300,
    background: cssVar.danger50,
  },
};

/**
 * The same map, indexed by any string: the verdict arrives in a tool result over SSE and can fall
 * outside {@link RiskVerdictType} at run time.
 */
const VISUALS_BY_RECEIVED_VERDICT: Partial<Record<string, VerdictVisualInterface>> = VERDICT_VISUALS;

/** Comprimento aproximado do arco do gauge (semicírculo de raio 50). */
const ARC_LENGTH = 157;

/**
 * Card da tool `analyze_shipping_content`: gauge SVG do score, veredito colorido,
 * barras por categoria (`strength` em %) e a explicação.
 *
 * @param props - Análise de risco.
 *
 * @returns O card de análise de risco.
 */
export function RiskCard({ result }: Readonly<{ result: RiskAnalysisInterface }>): JSX.Element {
  const visual = VISUALS_BY_RECEIVED_VERDICT[result.verdict] ?? VERDICT_VISUALS.medium;

  const clampedScore = Math.max(
    0,
    Math.min(
      1,
      result.score,
    ),
  );

  // Score exibido em escala 0–100% (1 casa decimal); o `score` cru continua sendo 0–1 no contrato.
  const scorePercent = `${(clampedScore * PERCENT_SCALE).toFixed(1)}%`;

  return (
    <ToolResultFrame
      icon={<ShieldCheck size={13} />}
      toolName="analyze_shipping_content"
      title={`Análise de risco · ${visual.label}`}
      subtitle={`score ${scorePercent} · ${result.categories.length} categorias`}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        gap: cssVar.space20,
        padding: 18,
      }}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: 14,
          borderRadius: cssVar.radius8,
          background: visual.background,
        }}
        >
          <div style={{
            position: 'relative',
            width: 120,
            height: 64,
          }}
          >
            <svg
              width="120"
              height="64"
              viewBox="0 0 120 64"
              aria-hidden="true"
            >
              <path
                d="M 10 60 A 50 50 0 0 1 110 60"
                stroke={cssVar.white}
                strokeWidth="10"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M 10 60 A 50 50 0 0 1 110 60"
                stroke={visual.color}
                strokeWidth="10"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${clampedScore * ARC_LENGTH} ${ARC_LENGTH}`}
              />
            </svg>
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              paddingBottom: 2,
            }}
            >
              <div style={{
                fontSize: 22,
                fontWeight: 700,
                color: visual.color,
                fontVariantNumeric: cssValue.tabularNums,
              }}
              >
                {scorePercent}
              </div>
            </div>
          </div>
          <div style={{
            marginTop: cssVar.space4,
            fontSize: cssVar.fs12,
            fontWeight: 600,
            color: visual.color,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
          >
            Risco {visual.label}
          </div>
        </div>

        <div>
          <div style={{
            marginBottom: cssVar.space8,
            fontSize: 11,
            fontWeight: 600,
            color: cssVar.fgSubtle,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
          >
            Categorias detectadas
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: cssVar.space8,
            marginBottom: cssVar.space16,
          }}
          >
            {result.categories.map((category) => {
              const percent = Math.round(category.strength * PERCENT_SCALE);

              return (
                <div key={category.name}>
                  <div style={{
                    display: 'flex',
                    justifyContent: cssValue.spaceBetween,
                    fontSize: cssVar.fs14,
                    color: cssVar.fg,
                  }}
                  >
                    <span>{category.name}</span>
                    <span style={{
                      color: cssVar.fgMuted,
                      fontVariantNumeric: cssValue.tabularNums,
                    }}
                    >
                      {percent}%
                    </span>
                  </div>
                  <div style={{
                    height: 4,
                    marginTop: cssVar.space4,
                    background: cssVar.bgSoft,
                    borderRadius: cssVar.radiusFull,
                    overflow: 'hidden',
                  }}
                  >
                    <div style={{
                      width: `${percent}%`,
                      height: '100%',
                      background: visual.color,
                      borderRadius: cssVar.radiusFull,
                    }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{
            fontSize: cssVar.fs14,
            color: cssVar.fgMuted,
            lineHeight: cssVar.lh22,
          }}
          >
            {result.explanation}
          </div>
        </div>
      </div>
    </ToolResultFrame>
  );
}
