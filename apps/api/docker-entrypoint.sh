#!/bin/sh
set -e

# No Docker, as variáveis vêm do compose (env_file + environment). Em EC2 standalone,
# materializar o ambiente a partir de AWS SSM / Secrets Manager antes de iniciar.
if [ -z "$DATABASE_URL" ]; then
  echo "[atena] DATABASE_URL não definido (compose injeta; em EC2, materializar de SSM)."
fi

# Espera o banco ficar disponível e aplica as migrações (retry até conectar).
i=0
until npm run prisma:deploy --workspace @atena/api > /tmp/atena-migrate.log 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[atena] banco indisponível após 30 tentativas; abortando." >&2
    cat /tmp/atena-migrate.log >&2
    exit 1
  fi
  echo "[atena] aguardando o banco… ($i)"
  sleep 2
done
echo "[atena] migrações aplicadas."

exec "$@"
