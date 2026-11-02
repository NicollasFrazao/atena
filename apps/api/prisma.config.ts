import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (Prisma 7 moved it out of `schema.prisma` and `package.json`).
 *
 * The URL is read from the environment without `env()`, which throws when it is unset: `prisma
 * generate` (CI, image build) runs without a database, and only Migrate needs the URL.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
