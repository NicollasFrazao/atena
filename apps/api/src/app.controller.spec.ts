import { AppController } from './app.controller';

describe('AppController', () => {
  it('GET /health retorna status ok', () => {
    const controller = new AppController();

    expect(controller.health()).toEqual({
      status: 'ok',
      service: 'atena-api',
    });
  });
});
