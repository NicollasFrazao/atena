import { useEffect, useRef, useState, type JSX } from 'react';
import { WrenchIcon as Wrench } from '@phosphor-icons/react';
import { TOOLS_CATALOG } from './tools-catalog';
import { cssValue, cssVar } from '../styles/tokens';

/**
 * Disclaimer das ferramentas disponíveis ao assistente: um chip "N ferramentas disponíveis" no rodapé
 * do composer que, ao clicar, abre um popover (acima) listando nome e descrição de cada tool. Deixa
 * explícito o que o assistente consegue fazer (transparência).
 *
 * @returns O chip + popover.
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

      return () => {
        document.removeEventListener(
          'mousedown',
          onDown,
        );
      };
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
        onClick={() => { setOpen((value) => !value); }}
        aria-expanded={open}
        style={{
          display: cssValue.inlineFlex,
          alignItems: 'center',
          gap: cssVar.space4,
          padding: '2px 8px',
          borderRadius: 999,
          border: cssVar.borderLine,
          background: open
            ? cssVar.bgSoft
            : cssVar.white,
          color: cssVar.fgMuted,
          fontSize: cssVar.fs12,
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
            background: cssVar.white,
            border: cssVar.borderLine,
            borderRadius: 8,
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.16)',
            zIndex: 60,
          }}
          >
            <div style={{
              padding: '10px 14px',
              borderBottom: cssVar.borderLine,
              fontSize: cssVar.fs10,
              fontWeight: 600,
              color: cssVar.fgSubtle,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
            >
              O que o assistente pode fazer
            </div>
            <ul style={{
              margin: 0,
              padding: cssVar.space4,
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
                    gap: cssVar.space8,
                  }}
                  >
                    <span style={{
                      fontSize: cssVar.fs12,
                      fontWeight: 600,
                      color: cssVar.fg,
                    }}
                    >
                      {tool.label}
                    </span>
                    <code style={{
                      fontFamily: cssValue.fontMono,
                      fontSize: cssVar.fs10,
                      color: cssVar.fgSubtle,
                    }}
                    >
                      {tool.name}
                    </code>
                  </div>
                  <div style={{
                    fontSize: cssVar.fs12,
                    color: cssVar.fgMuted,
                    lineHeight: cssVar.lh22,
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
