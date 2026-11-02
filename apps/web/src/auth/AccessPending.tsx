import type { JSX } from 'react';
import { ClockIcon as Clock, ProhibitIcon as Prohibit, SignOutIcon as SignOut } from '@phosphor-icons/react';
import { useAuth } from './auth-context';
import logoUrl from '../styles/design-system/assets/atena-logo.svg';
import { cssValue, cssVar } from '../styles/tokens';

/**
 * Tela de **acesso pendente / desabilitado**, exibida quando o usuário está autenticado mas ainda
 * não tem papel atribuído (pendente) ou foi desabilitado. Orienta a falar com o administrador e
 * permite sair. (O acesso só é liberado quando um admin atribuir um papel.)
 *
 * @returns A tela de acesso pendente/desabilitado.
 */
export function AccessPending(): JSX.Element {
  const {
    user,
    signOut,
  } = useAuth();

  const disabled = user?.status === 'disabled';

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
        width: '100%',
        maxWidth: 460,
        background: cssVar.white,
        border: cssVar.borderLine,
        borderRadius: 12,
        padding: 32,
        boxShadow: cssVar.shadowLg,
        textAlign: 'center',
      }}
      >
        <img
          src={logoUrl}
          alt="Atena"
          style={{
            height: 24,
            display: 'block',
            margin: '0 auto 24px',
          }}
        />

        <div style={{
          display: cssValue.inlineFlex,
          alignItems: 'center',
          justifyContent: 'center',
          width: 56,
          height: 56,
          borderRadius: 999,
          background: cssVar.bgSoft,
          border: cssVar.borderLine,
          marginBottom: 16,
        }}
        >
          {disabled
            ? (
              <Prohibit
                size={26}
                color={cssVar.danger300}
              />
            )
            : (
              <Clock
                size={26}
                color={cssVar.primary}
              />
            )}
        </div>

        <h1 style={{
          margin: 0,
          fontFamily: cssVar.fontHeading,
          fontSize: 22,
          fontWeight: 600,
          color: cssVar.fg,
        }}
        >
          {disabled
            ? 'Acesso desabilitado'
            : 'Acesso pendente de liberação'}
        </h1>

        <p style={{
          margin: '10px 0 0',
          fontFamily: cssVar.fontBody,
          fontSize: 14,
          color: cssVar.fgMuted,
          lineHeight: 1.55,
        }}
        >
          {disabled
            ? 'Sua conta foi desabilitada. Fale com o administrador do sistema para reativá-la.'
            : 'Sua conta foi reconhecida, mas ainda não tem um perfil de acesso. Fale com o administrador do sistema para liberar seu acesso.'}
        </p>

        {user
          ? (
            <div style={{
              margin: '20px 0',
              padding: 12,
              background: cssVar.bgSoft,
              border: cssVar.borderLine,
              borderRadius: 6,
              fontSize: 13,
              color: cssVar.fg,
            }}
            >
              {user.name || user.email}
              <span style={{
                display: 'block',
                fontSize: 12,
                color: cssVar.fgMuted,
              }}
              >
                {user.email}
              </span>
            </div>
          )
          : null}

        <button
          type="button"
          onClick={signOut}
          style={{
            width: '100%',
            height: 44,
            background: cssVar.white,
            color: cssVar.fg,
            border: cssVar.borderLine,
            borderRadius: 8,
            cursor: 'pointer',
            display: cssValue.inlineFlex,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontFamily: cssVar.fontBody,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <SignOut
            size={16}
            color={cssVar.fgMuted}
          />
          Sair
        </button>
      </div>
    </div>
  );
}
