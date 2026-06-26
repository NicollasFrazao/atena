import { useEffect, useRef, useState } from 'react';
import { Wrench } from '@phosphor-icons/react';
import { TOOLS_CATALOG } from './tools-catalog';

/**
 * Disclaimer das ferramentas disponíveis ao assistente: um chip "N ferramentas disponíveis" no rodapé
 * do composer que, ao clicar, abre um popover (acima) listando nome e descrição de cada tool. Deixa
 * explícito o que o assistente consegue fazer (transparência).
 *
 * @returns {JSX.Element} O chip + popover.
 */
export function ToolsDisclaimer(): JSX.Element {
  const [
    open,
    setOpen,
  ] = useState(false);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(
    () => {
      if (!open) {
        return undefined;
      }

      const onDown = (event: MouseEvent): void => {
        if (
          ref.current
          && !ref.current.contains(event.target as Node)
        ) {
          setOpen(false);
        }
      };

      document.addEventListener(
        'mousedown',
        onDown,
      );

      return () => document.removeEventListener(
        'mousedown',
        onDown,
      );
    },
    [open],
  );

  return (
    <span
      ref={ref}
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--at-space-4)',
          padding: '2px 8px',
          borderRadius: 999,
          border: '1px solid var(--at-border)',
          background: open
            ? 'var(--at-bg-soft)'
            : 'var(--at-white)',
          color: 'var(--at-fg-muted)',
          fontSize: 'var(--at-fs-11)',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <Wrench size={12} />
        {TOOLS_CATALOG.length} ferramentas disponíveis
      </button>

      {open
        ? (
          <div style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            width: 360,
            maxHeight: 360,
            overflowY: 'auto',
            background: 'var(--at-white)',
            border: '1px solid var(--at-border)',
            borderRadius: 8,
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.16)',
            zIndex: 60,
          }}
          >
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--at-border)',
              fontSize: 'var(--at-fs-10)',
              fontWeight: 600,
              color: 'var(--at-fg-subtle)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
            >
              O que o assistente pode fazer
            </div>
            <ul style={{
              margin: 0,
              padding: 'var(--at-space-4)',
              listStyle: 'none',
            }}
            >
              {TOOLS_CATALOG.map((tool) => (
                <li
                  key={tool.name}
                  style={{ padding: '8px 10px' }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 'var(--at-space-8)',
                  }}
                  >
                    <span style={{
                      fontSize: 'var(--at-fs-12)',
                      fontWeight: 600,
                      color: 'var(--at-fg)',
                    }}
                    >
                      {tool.label}
                    </span>
                    <code style={{
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: 'var(--at-fs-10)',
                      color: 'var(--at-fg-subtle)',
                    }}
                    >
                      {tool.name}
                    </code>
                  </div>
                  <div style={{
                    fontSize: 'var(--at-fs-11)',
                    color: 'var(--at-fg-muted)',
                    lineHeight: 'var(--at-lh-22)',
                    marginTop: 2,
                  }}
                  >
                    {tool.description}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
        : null}
    </span>
  );
}
