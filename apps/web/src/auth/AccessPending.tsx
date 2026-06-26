import { Clock, Prohibit, SignOut } from '@phosphor-icons/react';
import { useAuth } from './auth-context';
import logoUrl from '../styles/design-system/assets/atena-logo.svg';

/**
 * Tela de **acesso pendente / desabilitado**, exibida quando o usuário está autenticado mas ainda
 * não tem papel atribuído (pendente) ou foi desabilitado. Orienta a falar com o administrador e
 * permite sair. (O acesso só é liberado quando um admin atribuir um papel.)
 *
 * @returns {JSX.Element} A tela de acesso pendente/desabilitado.
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
      background: 'var(--at-bg-soft)',
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
        background: 'var(--at-white)',
        border: '1px solid var(--at-border)',
        borderRadius: 12,
        padding: 32,
        boxShadow: 'var(--at-shadow-lg)',
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
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 56,
          height: 56,
          borderRadius: 999,
          background: 'var(--at-bg-soft)',
          border: '1px solid var(--at-border)',
          marginBottom: 16,
        }}
        >
          {disabled
            ? (
              <Prohibit
                size={26}
                color="var(--at-danger-300)"
              />
            )
            : (
              <Clock
                size={26}
                color="var(--at-primary)"
              />
            )}
        </div>

        <h1 style={{
          margin: 0,
          fontFamily: 'var(--at-font-heading)',
          fontSize: 22,
          fontWeight: 600,
          color: 'var(--at-fg)',
        }}
        >
          {disabled
            ? 'Acesso desabilitado'
            : 'Acesso pendente de liberação'}
        </h1>

        <p style={{
          margin: '10px 0 0',
          fontFamily: 'var(--at-font-body)',
          fontSize: 14,
          color: 'var(--at-fg-muted)',
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
              background: 'var(--at-bg-soft)',
              border: '1px solid var(--at-border)',
              borderRadius: 6,
              fontSize: 13,
              color: 'var(--at-fg)',
            }}
            >
              {user.name || user.email}
              <span style={{
                display: 'block',
                fontSize: 12,
                color: 'var(--at-fg-muted)',
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
            background: 'var(--at-white)',
            color: 'var(--at-fg)',
            border: '1px solid var(--at-border)',
            borderRadius: 8,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontFamily: 'var(--at-font-body)',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <SignOut
            size={16}
            color="var(--at-fg-muted)"
          />
          Sair
        </button>
      </div>
    </div>
  );
}
