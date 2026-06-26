# Atena — Web (`apps/web`)

Frontend da Atena: chat com o assistente (streaming SSE), cards de resultado das tools,
reveal auditado de PII e banner de incidentes em tempo real. Vite + React + TS, consumindo
o contrato tipado de `@atena/types`.

## Como rodar

```bash
# Dev (Vite, hot reload) — http://localhost:5173
make web                 # = npm run dev --workspace @atena/web

# Stack completo via Docker (nginx servindo o build) — http://localhost:8080
make up                  # sobe api + web + mysql

# Qualidade
npm run lint  --workspace @atena/web   # eslint estrito (--max-warnings=0)
npm run test  --workspace @atena/web   # vitest
npm run build --workspace @atena/web   # tsc --noEmit + vite build
```

**Env (build-time, Vite):** `VITE_API_URL` e `VITE_WS_URL` (default `http://localhost:3000`).
A API fica sob `/api` e o WebSocket no namespace `/ws/support`.

## Estrutura
- `api/` — client HTTP tipado (`apiFetch`, erro do contrato, handler de 401), config.
- `chat/` — `useChat` (reducer SSE → partes: thinking/text/tool), `sse.ts` (parser de linhas),
  `ChatPage`, `reveal.ts` (reveal de PII) e `tool-cards/` (frame + cards search/trail/risk/report
  + dispatcher + `RevealField`).
- `realtime/` — `useSupportEvents` (socket.io `/ws/support`, reconexão) + `IncidentBanner`
  (notificações por severidade) + `incident-notice` (mapeamento/cap).
- `components/` — `Shell`, `SessionExpiredOverlay`. `styles/` — design-system (tokens `--at-*`).

## Status — Fase 2 (Chat) CONCLUÍDA
- **2.1** scaffold (Vite+React+TS, workspace, lint) · **2.2** design portado (tokens/Shell) ·
  **2.3** API client (+401→overlay) + WS client (reconexão) · **2.4** chat: sessão + stream SSE
  token-a-token · **2.5** tool-result cards + **reveal auditado** (telefone/conteúdo) ·
  **2.6** banner de incidente via WS + estados de erro (tool/WS/401) · **2.7** testes
  (parser SSE, reducer, cards, formatadores) + lint/build verdes.

## Próximas fatias (OUT desta fase)
- Telas: **Incidentes** (lista/ack/resolve), **Regras**, **Observabilidade**, **Audit log**,
  **Histórico** de sessões.
- **Auth OIDC real**: hoje o login está stubbed (`AUTH_DEV_BYPASS`); ligar o fluxo Entra
  ponta-a-ponta (state + sessão/cookie + trocar o stub pelo `sub`).
