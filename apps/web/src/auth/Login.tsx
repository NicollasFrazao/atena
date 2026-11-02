import { useState, type JSX } from 'react';
import {
  BellIcon as Bell,
  InfoIcon as Info,
  MagnifyingGlassIcon as MagnifyingGlass,
  ShieldCheckIcon as ShieldCheck,
  TrendUpIcon as TrendUp,
  type Icon,
} from '@phosphor-icons/react';
import { loginUrl } from '../api/auth';
import logoUrl from '../styles/design-system/assets/atena-logo.svg';
import { cssValue, cssVar } from '../styles/tokens';

/** Pílulas de recurso (coluna de marketing). */
const FEATURE_PILLS: {
  icon: Icon;
  label: string
}[] = [
  {
    icon: MagnifyingGlass,
    label: 'Busca e trilha',
  },
  {
    icon: ShieldCheck,
    label: 'Análise de risco',
  },
  {
    icon: TrendUp,
    label: 'Relatórios',
  },
  {
    icon: Bell,
    label: 'Anomalias em tempo real',
  },
];

/**
 * Tela de login (pré-shell), exibida quando não há sessão. Reproduz o protótipo: coluna de
 * apresentação + card de SSO. O botão dispara uma navegação top-level para `GET /api/auth/login`
 * (início do fluxo OIDC) — não é `fetch`, pois o navegador é redirecionado ao IdP e volta.
 *
 * @returns A tela de login.
 */
export function Login(): JSX.Element {
  const [
    loading,
    setLoading,
  ] = useState(false);

  const handleSignIn = (): void => {
    setLoading(true);
    window.location.href = loginUrl();
  };

  return (
    <div style={{
      height: '100vh',
      background: cssVar.bgSoft,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      position: 'relative',
      overflow: 'hidden',
    }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: `
            radial-gradient(800px 500px at 12% 18%, rgba(168, 224, 211, 0.35) 0%, transparent 60%),
            radial-gradient(700px 500px at 88% 88%, rgba(168, 224, 211, 0.25) 0%, transparent 60%)
          `,
          pointerEvents: 'none',
        }}
      />

      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'grid',
        gridTemplateColumns: '1.05fr 1fr',
        gap: 64,
        alignItems: 'center',
        maxWidth: 1040,
        width: '100%',
      }}
      >
        <div>
          <img
            src={logoUrl}
            alt="Atena"
            style={{ height: 28 }}
          />
          <div style={{
            marginTop: 36,
            fontFamily: cssVar.fontBody,
            fontSize: 13,
            fontWeight: 600,
            color: cssVar.primary,
            textTransform: 'uppercase',
            letterSpacing: 1.5,
          }}
          >
            Assistente conversacional de envios
          </div>
          <h1 style={{
            margin: 0,
            marginTop: 8,
            fontFamily: cssVar.fontHeading,
            fontSize: 64,
            fontWeight: 700,
            color: cssVar.fg,
            lineHeight: 1,
            letterSpacing: -1,
          }}
          >
            Atena
          </h1>
          <p style={{
            margin: '20px 0 0',
            fontFamily: cssVar.fontBody,
            fontSize: 16,
            color: cssVar.fgMuted,
            lineHeight: 1.55,
            maxWidth: 460,
          }}
          >
            Busque mensagens, abra trilhas, analise risco e gere relatórios direto no chat.
            E receba alertas de anomalia em tempo real, com registro estruturado de cada ação tomada.
          </p>

          <div style={{
            display: 'flex',
            gap: 8,
            marginTop: 28,
            flexWrap: 'wrap',
          }}
          >
            {FEATURE_PILLS.map((pill) => {
              const PillIcon = pill.icon;

              return (
                <div
                  key={pill.label}
                  style={{
                    display: cssValue.inlineFlex,
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 12px',
                    background: cssVar.white,
                    border: cssVar.borderLine,
                    borderRadius: 999,
                    fontFamily: cssVar.fontBody,
                    fontSize: 12,
                    fontWeight: 500,
                    color: cssVar.fg,
                  }}
                >
                  <PillIcon
                    size={13}
                    color={cssVar.primary}
                  />
                  {pill.label}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{
          background: cssVar.white,
          border: cssVar.borderLine,
          borderRadius: 12,
          padding: 32,
          boxShadow: cssVar.shadowLg,
        }}
        >
          <h2 style={{
            margin: 0,
            fontFamily: cssVar.fontHeading,
            fontSize: 22,
            fontWeight: 600,
            color: cssVar.fg,
          }}
          >
            Olá, bem-vindo à Atena
          </h2>
          <p style={{
            margin: '6px 0 24px',
            fontFamily: cssVar.fontBody,
            fontSize: 13,
            color: cssVar.fgMuted,
            lineHeight: 1.5,
          }}
          >
            Entre com sua conta corporativa para acessar o assistente.
          </p>

          <button
            type="button"
            onClick={handleSignIn}
            disabled={loading}
            style={{
              width: '100%',
              height: 48,
              padding: '0 16px',
              background: cssVar.primary,
              color: cssVar.white,
              border: 'none',
              borderRadius: 8,
              cursor: loading
                ? 'wait'
                : 'pointer',
              display: cssValue.inlineFlex,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              fontFamily: cssVar.fontBody,
              fontSize: 15,
              fontWeight: 600,
              boxShadow: '0 2px 8px rgba(7, 126, 112, 0.25)',
            }}
          >
            {loading
              ? (
                <>
                  <span
                    className="at-spin"
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      border: '2px solid rgba(255, 255, 255, 0.4)',
                      borderTopColor: cssVar.white,
                    }}
                  />
                  Entrando…
                </>
              )
              : (
                <>
                  <ShieldCheck
                    size={16}
                    color={cssVar.white}
                  />
                  Entrar com SSO corporativo
                </>
              )}
          </button>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            margin: '20px 0',
            color: cssVar.fgSubtle,
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: 0.3,
          }}
          >
            <div style={{
              flex: 1,
              height: 1,
              background: cssVar.border,
            }}
            />
            ACESSO RESTRITO
            <div style={{
              flex: 1,
              height: 1,
              background: cssVar.border,
            }}
            />
          </div>

          <div style={{
            padding: 12,
            background: cssVar.bgSoft,
            border: cssVar.borderLine,
            borderRadius: 6,
            display: 'flex',
            gap: 10,
          }}
          >
            <Info
              size={14}
              color={cssVar.fgMuted}
              style={{
                flexShrink: 0,
                marginTop: 2,
              }}
            />
            <div style={{
              fontSize: 12,
              color: cssVar.fgMuted,
              lineHeight: 1.5,
            }}
            >
              Apenas usuários autorizados têm acesso.
              Toda interação é registrada em audit log imutável por 1 ano (RNF-1.5).
            </div>
          </div>
        </div>
      </div>

      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 20,
        textAlign: 'center',
        fontFamily: cssVar.fontBody,
        fontSize: 11,
        color: cssVar.fgSubtle,
      }}
      >
        Atena · Assistente Conversacional de Envios © 2026
      </div>
    </div>
  );
}
