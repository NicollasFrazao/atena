import { type ReactNode, type JSX } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { API_URL } from '../api/config';

/**
 * Resolve hrefs relativos a `/api/...` para a origem real da API (ex.: o link de CSV do relatório,
 * que o backend devolve como `/api/reports/{id}/export.csv`). Demais hrefs passam inalterados.
 *
 * @param [href] - Href do link no Markdown.
 *
 * @returns Href resolvido (absoluto p/ a API quando começa com `/api/`).
 */
function resolveHref(href?: string): string | undefined {
  return href?.startsWith('/api/')
    ? `${API_URL}${href}`
    : href;
}

/** Overrides de elementos: links abrem em nova aba e resolvem `/api/...` para a API. */
const COMPONENTS: Components = {
  a: ({
    href,
    children,
  }: {
    href?: string;
    children?: ReactNode
  }) => (
    <a
      href={resolveHref(href)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
};

/**
 * Renderiza o texto (Markdown) do assistente: negrito, listas, links e código. Usa react-markdown,
 * que NÃO interpreta HTML cru (sem XSS). Tipografia vem da classe `.at-md` (alinhada ao chat); links
 * abrem em nova aba e os relativos a `/api` apontam para a API.
 *
 * @param props - O texto em Markdown.
 *
 * @returns O Markdown renderizado.
 */
export function Markdown({ children }: Readonly<{ children: string }>): JSX.Element {
  return (
    <div className="at-md">
      <ReactMarkdown components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
