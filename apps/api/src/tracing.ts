import tracer from 'dd-trace';

/**
 * APM do Datadog (dd-trace). DEVE ser importado ANTES de qualquer módulo do app (1ª linha do
 * `main.ts`) para auto-instrumentar HTTP/Nest/Prisma → latência por rota + traces no Datadog,
 * reportados ao Datadog Agent (`DD_AGENT_HOST`/localhost:8126). Gate por `DD_TRACE_ENABLED`
 * (default ligado; desligado quando `=false` ou em testes). Tags carregam só rota/método/serviço
 * — nunca PII (telefone/conteúdo).
 */
if (
  process.env.DD_TRACE_ENABLED !== 'false'
  && process.env.NODE_ENV !== 'test'
) {
  tracer.init({
    service: process.env.DD_SERVICE ?? 'atena-api',
    env: process.env.DD_ENV,
    logInjection: true,
  });
}

export { tracer };
