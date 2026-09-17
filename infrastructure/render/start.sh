#!/bin/sh
# Starts Tasker on one free Render service:
#   - Redis, in memory only, unless REDIS_URL points at one elsewhere
#   - database migrations; a failed migration stops the deploy and
#     Render keeps the previous version serving
#   - the API, on a port only this container can reach
#   - the Telegram bot, talking to that API
#   - the web app, on Render's public port, forwarding /api to the API
# The API and the bot are restarted if they ever exit.
set -e

PORT="${PORT:-10000}"
API_PORT=3001

# Render gives every web service its public address. Unless told otherwise,
# that is the console's address too - for cookies' origin and Telegram links.
WEB_ORIGIN="${WEB_ORIGIN:-${RENDER_EXTERNAL_URL:-}}"
export WEB_ORIGIN

if [ -z "${REDIS_URL:-}" ]; then
  # Nothing in it needs to survive a restart, so nothing is written to disk.
  redis-server --bind 127.0.0.1 --port 6379 --dir /tmp --save "" --appendonly no \
    --maxmemory 32mb --maxmemory-policy allkeys-lru --loglevel warning &
  REDIS_URL="redis://127.0.0.1:6379"
  export REDIS_URL
  for i in 1 2 3 4 5 6 7 8 9 10; do
    redis-cli -p 6379 ping >/dev/null 2>&1 && break
    sleep 1
  done
  echo "[start] redis ready inside the container"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[start] DATABASE_URL is not set. In Render, open the tasker service > Environment,"
  echo "[start] add DATABASE_URL with your Neon connection string, and deploy again."
  exit 1
fi

# Whatever Neon string was pasted, use a form that works for Prisma:
#   - the direct address, not the pooled one ("-pooler" in the host): Prisma
#     migrations cannot run through the pooler
#   - no channel_binding, which Prisma 5's TLS client can fail to negotiate;
#     the connection still requires TLS through sslmode
#   - a 15-second connect timeout, so a database waking from sleep has time
DATABASE_URL=$(printf '%s' "$DATABASE_URL" \
  | sed -e 's/-pooler\././' -e 's/channel_binding=[^&]*&\{0,1\}//' -e 's/[?&]$//')
case "$DATABASE_URL" in
  *connect_timeout=*) ;;
  *\?*) DATABASE_URL="${DATABASE_URL}&connect_timeout=15" ;;
  *) DATABASE_URL="${DATABASE_URL}?connect_timeout=15" ;;
esac
export DATABASE_URL

cd /app/apps/api
echo "[start] applying database migrations"
node_modules/.bin/prisma migrate deploy

(
  cd /app/apps/api
  while true; do
    PORT="$API_PORT" node dist/main.js || true
    echo "[start] API stopped; restarting in 3 seconds"
    sleep 3
  done
) &

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  (
    cd /app/apps/bot
    export API_BASE_URL="http://127.0.0.1:${API_PORT}"
    export CONSOLE_URL="${CONSOLE_URL:-${WEB_ORIGIN%%,*}}"
    sleep 8
    while true; do
      /opt/bot/bin/python main.py || true
      echo "[start] telegram bot stopped; restarting in 5 seconds"
      sleep 5
    done
  ) &
else
  echo "[start] TELEGRAM_BOT_TOKEN is not set, so the Telegram bot is off"
fi

cd /app/apps/web
exec node_modules/.bin/next start -p "$PORT" -H 0.0.0.0
