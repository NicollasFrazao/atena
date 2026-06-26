/**
 * Página-placeholder das telas ainda não implementadas (a navegação já existe; o conteúdo entra nas
 * próximas fatias). Mantém o Shell/nav funcionais sem links mortos.
 *
 * @param {{ title: string; description: string }} props - Título e descrição da tela futura.
 * @returns {JSX.Element} Estado "em construção" centralizado.
 */
export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string
}): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100%',
      padding: 'var(--at-space-40)',
      textAlign: 'center',
    }}
    >
      <h1 style={{
        fontSize: 'var(--at-fs-24)',
        fontWeight: 600,
        color: 'var(--at-fg)',
        marginBottom: 'var(--at-space-8)',
      }}
      >
        {title}
      </h1>
      <p style={{
        fontSize: 'var(--at-fs-14)',
        color: 'var(--at-fg-muted)',
        maxWidth: 420,
      }}
      >
        {description}
      </p>
      <span style={{
        marginTop: 'var(--at-space-16)',
        padding: '4px 10px',
        borderRadius: 999,
        background: 'var(--at-bg-soft)',
        border: '1px solid var(--at-border)',
        fontSize: 'var(--at-fs-11)',
        color: 'var(--at-fg-subtle)',
      }}
      >
        Em construção
      </span>
    </div>
  );
}
