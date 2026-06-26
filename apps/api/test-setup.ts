/**
 * Setup global do Jest (roda antes de cada arquivo de teste, antes de importar o app).
 *
 * Neutraliza variáveis de ambiente que são SÓ de deploy e mudariam o comportamento dos testes.
 * `ATENA_AUDIT_MIN_QUERY_DATE` liga a guarda de data mínima em produção; o `ConfigModule.forRoot`
 * carrega o `.env` por padrão, então sem isto a guarda barraria as consultas sem janela dos testes.
 * Definir aqui (antes do load do `.env`, que é override:false) mantém a guarda DESLIGADA nos testes.
 */
process.env.ATENA_AUDIT_MIN_QUERY_DATE = '';
