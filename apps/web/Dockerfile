# Atena Web — imagem multi-stage. Build com contexto na raiz do monorepo:
#   docker build -f apps/web/Dockerfile -t atena-web:latest .
# O browser (no host) fala com a API publicada no host → VITE_API_URL/WS apontam p/ localhost.

# ---- build ----
FROM node:20-slim AS build
WORKDIR /app
# manifests primeiro (cache de camadas do npm)
COPY package.json ./
COPY packages/types/package.json packages/types/
COPY apps/web/package.json apps/web/
RUN npm install
# fontes
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY apps/web apps/web
# Vite inlina import.meta.env NO BUILD → API/WS via build args (default: host local).
ARG VITE_API_URL=http://localhost:3000
ARG VITE_WS_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build --workspace @atena/types \
  && npm run build --workspace @atena/web

# ---- runtime (nginx serve o estático; SPA fallback) ----
FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
