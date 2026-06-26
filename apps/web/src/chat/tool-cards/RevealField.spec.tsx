import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RevealField } from './RevealField';

describe('RevealField (estado inicial)', () => {
  it('telefone: mostra o mascarado + o gatilho-olho rotulado (PII não vaza)', () => {
    const markup = renderToStaticMarkup(
      <RevealField
        shippingId="m1"
        kind="phone"
        masked="+55 11 9****-1234"
      />,
    );

    expect(markup).toContain('+55 11 9****-1234');
    expect(markup).toContain('aria-label="Revelar telefone"');
    // PII real nunca aparece antes do reveal confirmado.
    expect(markup).not.toContain('Revelar e registrar');
  });

  it('conteúdo: mostra o gatilho-olho de conteúdo (sem valor antes do reveal)', () => {
    const markup = renderToStaticMarkup(
      <RevealField
        shippingId="m1"
        kind="content"
      />,
    );

    expect(markup).toContain('aria-label="Revelar conteúdo"');
  });
});
