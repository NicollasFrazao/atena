import {
  evDdlFromSources,
  partitionDescriptors,
  sourcesSubquery,
} from './audit-query.sql';

const NOW = new Date('2026-06-20T12:00:00Z');

describe('audit-query.sql', () => {
  it('partitionDescriptors strips trailing slashes from the source root', () => {
    const [first] = partitionDescriptors(
      's3://bucket//',
      {
        from: new Date('2026-06-17T15:00:00Z'),
        to: new Date('2026-06-17T15:30:00Z'),
      },
      NOW,
    );

    expect(first.glob).toBe('s3://bucket/year=2026/month=06/day=17/hour=15/*');
  });

  it('partitionDescriptors without a lower bound returns one broad, never-settled partition', () => {
    expect(partitionDescriptors(
      '/data',
      {
        from: null,
        to: null,
      },
      NOW,
    )).toEqual([{
      glob: '/data/year=*/month=*/day=*/hour=*/*',
      cacheKey: 'all',
      endsAt: null,
    }]);
  });

  it('partitionDescriptors switches to one partition per day above 72 hours and runs up to now when `to` is open', () => {
    const descriptors = partitionDescriptors(
      '/data',
      {
        from: new Date('2026-06-15T10:00:00Z'),
        to: null,
      },
      NOW,
    );

    expect(descriptors.map((descriptor) => descriptor.cacheKey)).toEqual([
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
      '2026-06-18',
      '2026-06-19',
      '2026-06-20',
    ]);

    expect(descriptors[0].glob).toBe('/data/year=2026/month=06/day=15/hour=*/*');
    expect(descriptors[0].endsAt?.toISOString()).toBe('2026-06-16T00:00:00.000Z');
  });

  it('sourcesSubquery is empty when there is no source at all', () => {
    expect(sourcesSubquery(
      [],
      [],
    )).toBe('');
  });

  it('evDdlFromSources filters by recipient only for a valid md5 id (lower-cased)', () => {
    const filtered = evDdlFromSources(
      ['/cache/a.parquet'],
      [],
      'ABCDEF0123456789ABCDEF0123456789',
    );

    const unfiltered = evDdlFromSources(
      ['/cache/a.parquet'],
      [],
      "x' OR 1=1 --",
    );

    expect(filtered).toContain("= 'abcdef0123456789abcdef0123456789'");
    expect(unfiltered).not.toContain('md5(');
    expect(unfiltered).not.toContain('OR 1=1');
  });
});
