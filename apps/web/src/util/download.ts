/**
 * Dispara o download de um Blob no navegador: cria um object URL temporário, clica num `<a download>`
 * e revoga a URL. Usado pelos exports de mensagens (CSV gerado no servidor e baixado como blob).
 *
 * @param {Blob} blob - Conteúdo a baixar.
 * @param {string} filename - Nome do arquivo no download.
 * @returns {void}
 */
export function triggerBlobDownload(
  blob: Blob,
  filename: string,
): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  // O anchor precisa estar no DOM para o `click()` disparar o download em alguns navegadores (Firefox).
  document.body.appendChild(anchor);
  anchor.click();

  // Revoga a object URL e remove o anchor SÓ no próximo tick: revogar na mesma stack do `click()`
  // cancela o download antes de começar no Chromium (era a causa do "não baixa / sem mudança visual").
  setTimeout(
    () => {
      anchor.remove();
      URL.revokeObjectURL(url);
    },
    0,
  );
}

/**
 * Baixa um arquivo de uma URL (GET) como blob e dispara o download — base dos exports CSV gerados no
 * servidor (mensagens/incidente/relatório), que respondem com `Content-Disposition: attachment`.
 *
 * @param {string} url - URL completa do arquivo (GET).
 * @param {string} filename - Nome do arquivo no download.
 * @returns {Promise<void>} Resolve quando o download é disparado.
 * @throws {Error} Se a resposta não for 2xx.
 */
export async function downloadFile(
  url: string,
  filename: string,
): Promise<void> {
  // `credentials: 'include'` → envia o cookie de sessão (os exports são gerados no servidor com
  // auth; sem isso o GET cross-origin web↔api iria sem cookie e falharia com 401).
  const response = await fetch(
    url,
    { credentials: 'include' },
  );

  if (!response.ok) {
    throw new Error('download_failed');
  }

  triggerBlobDownload(
    await response.blob(),
    filename,
  );
}
