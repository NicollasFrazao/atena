import { maskPhone } from './pii.util';

describe('maskPhone', () => {
  it('mascara BR móvel com DDD entre parênteses', () => {
    expect(maskPhone('+5511987651234')).toBe('+55 (11) 9****-1234');
    expect(maskPhone('+5592991942002')).toBe('+55 (92) 9****-2002');
  });

  it('mascara BR SEM o DDI 55 (ex.: SMS Flash) — móvel e fixo', () => {
    // 11 dígitos sem 55 = DDD + 9 + 8 (móvel); 10 = DDD + 8 (fixo). Mantém o DDD em vez de "****-1234".
    expect(maskPhone('47991508939')).toBe('+55 (47) 9****-8939');
    expect(maskPhone('1938989938')).toBe('+55 (19) ****-9938');
  });

  it('esconde o miolo e mantém os 4 últimos', () => {
    const masked = maskPhone('+5511987651234');
    expect(masked).not.toContain('98765');
    expect(masked.endsWith('1234')).toBe(true);
  });

  it('número curto → ****', () => {
    expect(maskPhone('12')).toBe('****');
  });
});
