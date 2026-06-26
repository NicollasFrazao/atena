import { ThinkingSplitter } from './thinking-splitter';

/** Empurra todos os deltas + flush, acumulando as porções. */
function runSplit(deltas: string[]): {
  thinking: string;
  text: string
} {
  const splitter = new ThinkingSplitter();
  let thinking = '';
  let text = '';

  for (const delta of deltas) {
    const result = splitter.push(delta);
    thinking += result.thinking;
    text += result.text;
  }

  const tail = splitter.flush();

  return {
    thinking: thinking + tail.thinking,
    text: text + tail.text,
  };
}

describe('ThinkingSplitter', () => {
  it('texto sem thinking sai inteiro como resposta', () => {
    expect(runSplit([
      'Olá ',
      'mundo',
    ])).toEqual({
      thinking: '',
      text: 'Olá mundo',
    });
  });

  it('separa um bloco <thinking> completo do texto da resposta', () => {
    expect(runSplit(['<thinking>raciocínio</thinking>resposta'])).toEqual({
      thinking: 'raciocínio',
      text: 'resposta',
    });
  });

  it('lida com a tag de ABERTURA partida entre deltas', () => {
    expect(runSplit([
      'antes<thin',
      'king>R</thinking>depois',
    ])).toEqual({
      thinking: 'R',
      text: 'antesdepois',
    });
  });

  it('lida com a tag de FECHAMENTO partida entre deltas', () => {
    expect(runSplit([
      '<thinking>R</think',
      'ing>resposta',
    ])).toEqual({
      thinking: 'R',
      text: 'resposta',
    });
  });

  it('flush emite raciocínio de um bloco nunca fechado (live-only)', () => {
    expect(runSplit(['texto<thinking>pensando sem fechar'])).toEqual({
      thinking: 'pensando sem fechar',
      text: 'texto',
    });
  });

  it('dois blocos de thinking + resposta (estilo Nova)', () => {
    expect(runSplit([
      '<thinking>passo 1</thinking>',
      '<thinking>passo 2</thinking>',
      'A resposta final.',
    ])).toEqual({
      thinking: 'passo 1passo 2',
      text: 'A resposta final.',
    });
  });
});
