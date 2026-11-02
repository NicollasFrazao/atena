import { createReadStream, unlink } from 'node:fs';
import type { Response } from 'express';

/**
 * Faz stream de um arquivo CSV temporário para a resposta HTTP como download, removendo o arquivo ao
 * fim (sucesso ou erro). Prefixa o BOM UTF-8 (U+FEFF) para o Excel pt-BR reconhecer UTF-8 e seta os
 * headers de attachment. Compartilhado pelos exports de mensagens (telefone em claro, auditados): o
 * CSV é gerado pelo DuckDB (`COPY`) e enviado sem materializar em memória.
 *
 * @param res - Resposta Express.
 * @param file - Caminho do CSV temporário (será removido ao fim do stream).
 * @param filename - Nome do arquivo no download (ex.: `atena-envios.csv`).
 */
export function streamCsvDownload(
  res: Response,
  file: string,
  filename: string,
): void {
  res.setHeader(
    'Content-Type',
    'text/csv; charset=utf-8',
  );

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`,
  );

  // BOM UTF-8 (U+FEFF) antes do conteúdo → Excel pt-BR reconhece UTF-8 (acentos corretos).
  res.write('\uFEFF');

  const stream = createReadStream(file);

  // Remove o CSV temporário ao terminar — não acumula no volume. Dispara em: fim/erro do stream
  // E fechamento da resposta (`res` 'close'), pois um abort do cliente fecha a conexão sem que o
  // stream chegue em 'end' → sem isso o CSV vazaria. Guarda `done` evita unlink duplicado.
  let done = false;

  const cleanup = (): void => {
    if (done) {
      return;
    }

    done = true;

    unlink(
      file,
      () => undefined,
    );
  };

  stream.once(
    'error',
    cleanup,
  );

  stream.once(
    'end',
    cleanup,
  );

  res.once(
    'close',
    cleanup,
  );

  stream.pipe(res);
}
