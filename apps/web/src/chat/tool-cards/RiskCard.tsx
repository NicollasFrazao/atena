import { ShieldCheck } from '@phosphor-icons/react';
import { type RiskAnalysisInterface, type RiskVerdictType } from '@atena/types';
import { ToolResultFrame } from './ToolResultFrame';

/** Rótulo (pt-BR) e cores por veredito de risco. */
const VERDICT_VISUALS: Record<RiskVerdictType, {
  label: string;
  color: string;
  background: string
}> = {
  low: {
    label: 'Baixo',
    color: 'var(--at-success-300)',
    background: 'var(--at-success-50)',
  },
  medium: {
    label: 'Médio',
    color: 'var(--at-warning-300)',
    background: 'var(--at-warning-50)',
  },
  high: {
    label: 'Alto',
    color: 'var(--at-danger-300)',
    background: 'var(--at-danger-50)',
  },
};

/** Comprimento aproximado do arco do gauge (semicírculo de raio 50). */
const ARC_LENGTH = 157;

/**
 * Card da tool `analyze_shipping_content`: gauge SVG do score, veredito colorido,
 * barras por categoria (`strength` em %) e a explicação.
 *
 * @param {{ result: RiskAnalysisInterface }} props - Análise de risco.
 * @returns {JSX.Element} O card de análise de risco.
 */
export function RiskCard({ result }: { result: RiskAnalysisInterface }): JSX.Element {
  const visual = VERDICT_VISUALS[result.verdict] ?? VERDICT_VISUALS.medium;

  const clampedScore = Math.max(
    0,
    Math.min(
      1,
      result.score,
    ),
  );

  // Score exibido em escala 0–100% (1 casa decimal); o `score` cru continua sendo 0–1 no contrato.
  const scorePercent = `${(clampedScore * 100).toFixed(1)}%`;

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
        gap: 'var(--at-space-20)',
        padding: 18,
      }}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: 14,
          borderRadius: 'var(--at-radius-8)',
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
                stroke="var(--at-white)"
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
                fontVariantNumeric: 'tabular-nums',
              }}
              >
                {scorePercent}
              </div>
            </div>
          </div>
          <div style={{
            marginTop: 'var(--at-space-4)',
            fontSize: 'var(--at-fs-12)',
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
            marginBottom: 'var(--at-space-8)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--at-fg-subtle)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
          >
            Categorias detectadas
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--at-space-8)',
            marginBottom: 'var(--at-space-16)',
          }}
          >
            {result.categories.map((category) => {
              const percent = Math.round(category.strength * 100);

              return (
                <div key={category.name}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 'var(--at-fs-14)',
                    color: 'var(--at-fg)',
                  }}
                  >
                    <span>{category.name}</span>
                    <span style={{
                      color: 'var(--at-fg-muted)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                    >
                      {percent}%
                    </span>
                  </div>
                  <div style={{
                    height: 4,
                    marginTop: 'var(--at-space-4)',
                    background: 'var(--at-bg-soft)',
                    borderRadius: 'var(--at-radius-full)',
                    overflow: 'hidden',
                  }}
                  >
                    <div style={{
                      width: `${percent}%`,
                      height: '100%',
                      background: visual.color,
                      borderRadius: 'var(--at-radius-full)',
                    }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{
            fontSize: 'var(--at-fs-14)',
            color: 'var(--at-fg-muted)',
            lineHeight: 'var(--at-lh-22)',
          }}
          >
            {result.explanation}
          </div>
        </div>
      </div>
    </ToolResultFrame>
  );
}
