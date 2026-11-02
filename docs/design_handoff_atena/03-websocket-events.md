# 03 — Eventos de WebSocket (Fase 2)

Canal de tempo real para push de incidentes (RF-2.2). Em produção, atrás de um API Gateway WebSocket gerenciado.

```
WS  /ws/support     # um canal por usuário autenticado (token no handshake)
```

## Autenticação
Token SSO no handshake (query param `?token=` ou header `Authorization` no upgrade). Rejeitar conexão sem token válido. Associar a conexão ao `user_id` + papel (RBAC) para futuras dimensões de filtro.

## Eventos servidor → cliente

### `incident.created`
Disparado quando o detector cria um incidente. Enviado a **todos os usuários conectados** (no MVP; depois pode respeitar filtro de severidade por preferência do usuário — ver `ProfilePopover` no protótipo: toggle de som + filtro `all | critical_warn | critical`).
```json
{
  "type": "incident.created",
  "incident": {
    "id": "INC-2401",
    "rule": "Queda de taxa de entrega — Provider D",
    "severity": "critical",
    "status": "detected",
    "dimensionType": "provider",
    "dimensionValue": "Provider D",
    "detectedAt": "2026-05-28T14:02:00Z",
    "window": "14:02 → agora (4 min)",
    "summary": "Taxa de entrega caiu de 97% para 87%…",
    "metrics": { "baseline": "97.0%", "current": "87.1%", "threshold": "< 95%", "sample": "2.4k tentativas" },
    "relatedMessages": 184
  }
}
```
No frontend isto vira: um banner persistente no topo do chat (decisão de design batida — ver `decisions.md`) + uma mensagem da IA no chat + badge na navegação. Som opcional conforme preferência do usuário.

### `incident.updated`
Quando outro usuário faz ack/resolve — sincroniza o estado entre clientes conectados (badge, lista, banner).
```json
{
  "type": "incident.updated",
  "incidentId": "INC-2401",
  "status": "acknowledged",          // ou resolved | auto_resolved
  "acknowledgedBy": "Rafael S.",
  "at": "2026-05-28T14:06:00Z"
}
```

### `incident.auto_resolved`
Quando a anomalia volta à baseline sem ação (detector). UI mostra prompt de fechamento simplificado.
```json
{
  "type": "incident.auto_resolved",
  "incidentId": "INC-2396",
  "resolvedAt": "2026-05-28T13:56:00Z",
  "note": "Métrica voltou à baseline sem intervenção."
}
```

### `connection.status` (opcional, heartbeat)
Ping/pong ou heartbeat para a UI mostrar o status do WebSocket. O protótipo tem um estado de **WS desconectado** (faixa de aviso persistente) — o cliente deve detectar queda de conexão e tentar reconectar com backoff, exibindo essa faixa enquanto desconectado.

## Eventos cliente → servidor
Nenhum obrigatório no MVP além do handshake. Ack/resolve vão por **REST** (`POST /api/incidents/{id}/acknowledge|resolve`), não pelo WS — para passar pela validação server-side e pelo formulário de ação. O servidor então emite `incident.updated` para os demais clientes.

## Reconexão
- Backoff exponencial (ex.: 1s, 2s, 4s, … cap 30s).
- Ao reconectar, o cliente faz `GET /api/incidents?status=detected,acknowledged` para repreencher o estado (não confiar só no stream — eventos perdidos durante a queda).
