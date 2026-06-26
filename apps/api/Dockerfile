# Atena API — imagem multi-stage. Build com contexto na raiz do monorepo:
#   docker build -f apps/api/Dockerfile -t atena-api:latest .

# ---- build ----
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# manifests primeiro (cache de camadas do npm)
COPY package.json ./
COPY packages/types/package.json packages/types/
COPY apps/api/package.json apps/api/
RUN npm install
# fontes
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY apps/api apps/api
RUN npm run build --workspace @atena/types \
  && npm run prisma:generate --workspace @atena/api \
  && npm run build --workspace @atena/api

# ---- runtime ----
FROM node:22-slim AS runtime
# ca-certificates: o DuckDB baixa as extensões httpfs/aws via HTTPS em runtime (precisa do CA bundle).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=build /app/packages/types/package.json ./packages/types/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/docker-entrypoint.sh /usr/local/bin/atena-entrypoint
RUN chmod +x /usr/local/bin/atena-entrypoint
EXPOSE 3000
# O entrypoint gera/checa o /app/.env (runtime) e aplica migrações antes de subir.
ENTRYPOINT ["atena-entrypoint"]
CMD ["node", "apps/api/dist/main.js"]
