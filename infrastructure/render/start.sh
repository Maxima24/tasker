#!/bin/sh
# Starts Tasker on one free Render service:
#   - database migrations, first; a failed migration stops the deploy and
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
