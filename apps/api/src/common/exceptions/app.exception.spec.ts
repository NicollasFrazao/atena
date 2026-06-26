import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';

describe('AppException', () => {
  it('carrega o shape { error: { code, message } } e o status', () => {
    const error = new AppException(
      'insufficient_balance',
      'Saldo insuficiente',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );

    expect(error.getStatus()).toBe(422);

    expect(error.getResponse()).toEqual({
      error: {
        code: 'insufficient_balance',
        message: 'Saldo insuficiente',
      },
    });
  });
});
