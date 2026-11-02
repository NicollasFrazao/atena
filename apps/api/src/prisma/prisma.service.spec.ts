import { poolConfigFrom } from './prisma.service';

describe('poolConfigFrom', () => {
  it('reads host, port, credentials and database from a mysql:// URL', () => {
    expect(poolConfigFrom('mysql://atena:s3cr%40t@db.internal:3307/atena_prod')).toEqual({
      host: 'db.internal',
      port: 3307,
      user: 'atena',
      password: 's3cr@t',
      database: 'atena_prod',
    });
  });

  it('falls back to the default MySQL port', () => {
    expect(poolConfigFrom('mysql://root:root@localhost/atena').port).toBe(3306);
  });
});
