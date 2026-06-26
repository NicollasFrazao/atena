ENV ?= local
COMPOSE = docker compose --profile $(ENV)

.PHONY: help env install api web up dev datadog down restart build migrate seed smoke test test-e2e lint logs deploy

DB_URL_HOST = mysql://root:atena@127.0.0.1:3306/atena

help: ## Lista os alvos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

env: ## Gera o apps/api/.env (local) a partir do .env.example, se não existir
	@test -f apps/api/.env || cp .env.example apps/api/.env
	@echo "Gerado apps/api/.env — preencha os valores (NUNCA commite)."

install: ## Instala as dependências do monorepo
	npm install

api: ## Sobe a API em watch, sem Docker (host; iteração rápida)
	npm run start:dev --workspace apps/api

up: ## Sobe o stack (build + espera a API ficar saudável) — ENV=local|production
	$(COMPOSE) up -d --build --wait

dev: ## Sobe o stack local com AUTH_DEV_BYPASS=true (login dispensado; APENAS dev — nunca em produção)
	AUTH_DEV_BYPASS=true $(COMPOSE) up -d --build --wait

down: ## Derruba o stack (ENV=local|production)
	$(COMPOSE) down

build: ## Builda a imagem da API
	docker build -f apps/api/Dockerfile -t atena-api:latest .

migrate: ## Roda as migrações do Prisma (host)
	npm run prisma:migrate

seed: ## Popula o banco com dados de dev (dentro do container da API)
	$(COMPOSE) exec -T api npm run seed --workspace @atena/api

smoke: ## Smoke test: bate nos endpoints principais (API em :3000)
	@echo "GET /health:";              curl -s localhost:3000/health; echo
	@echo "GET /api/providers:";       curl -s localhost:3000/api/providers; echo
	@echo "GET /api/messages/search:"; curl -s "localhost:3000/api/messages/search?limit=3"; echo
	@echo "POST /api/messages/analyze:"; curl -s -X POST localhost:3000/api/messages/analyze -H 'Content-Type: application/json' -d '{"text":"Sua fatura vence amanha, acesse cb.app/f/8H2 e regularize agora"}'; echo
	@echo "POST /api/reports/delivery:"; curl -s -X POST localhost:3000/api/reports/delivery -H 'Content-Type: application/json' -d '{"date_range":"all"}'; echo
	@echo "POST /api/messages/m-1001/reveal-phone (PII, audita reveal_phone):"; curl -s -X POST localhost:3000/api/messages/m-1001/reveal-phone; echo
	@echo "POST /api/chat/sessions:"; curl -s -X POST localhost:3000/api/chat/sessions -H 'Content-Type: application/json' -d '{"title":"Smoke"}'; echo
	@echo "GET /api/chat/sessions:"; curl -s localhost:3000/api/chat/sessions; echo
	@sid=$$(curl -s -X POST localhost:3000/api/chat/sessions -H 'Content-Type: application/json' -d '{}' | sed -E 's/.*"session_id":"([^"]+)".*/\1/'); \
	echo "POST /api/chat/sessions/$$sid/messages (SSE: tool_call->tool_result->text_delta->done):"; \
	curl -sN -X POST "localhost:3000/api/chat/sessions/$$sid/messages" -H 'Content-Type: application/json' -d '{"text":"status do telefone +5511987651234"}'; echo

test: ## Roda os testes (unitários + e2e com mocks; sem banco)
	npm test

test-e2e: ## E2e de integração contra MySQL real (sobe o banco, migra, semeia e roda)
	$(COMPOSE) up -d --wait mysql
	DATABASE_URL="$(DB_URL_HOST)" npm run prisma:generate --workspace @atena/api
	DATABASE_URL="$(DB_URL_HOST)" npm run prisma:deploy --workspace @atena/api
	DATABASE_URL="$(DB_URL_HOST)" npm run seed --workspace @atena/api
	DATABASE_URL="$(DB_URL_HOST)" AUTH_DEV_BYPASS=true npm run test:e2e --workspace @atena/api

lint: ## Roda o lint
	npm run lint

logs: ## Acompanha os logs do stack
	$(COMPOSE) logs -f

deploy: ## (TODO) Build + push da imagem + deploy no EC2 (perfil production, .env via SSM)
	@echo "TODO: build + push + deploy no EC2 (perfil production; .env materializado de SSM/Secrets Manager)"

web: ## Sobe o frontend (apps/web) em dev (Vite), sem Docker
	npm run dev --workspace @atena/web

datadog: ## Sobe o Datadog Agent (opt-in; exige DD_API_KEY no apps/api/.env)
	docker compose --profile observability up -d datadog

restart: ## Reinicia os containers do stack, sem rebuild — ENV=local|production
	$(COMPOSE) restart
