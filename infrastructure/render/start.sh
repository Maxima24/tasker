#!/bin/sh
# Starts the API and, beside it, the Telegram bot.
#
# Migrations run first; a failed migration stops the deploy, and Render keeps
# the previous version serving. The bot is restarted if it ever exits, so a
# network blip on Telegram's side never leaves it silently dead.
set -e
cd /app/apps/api

echo "[start] applying database migrations"
node_modules/.bin/prisma migrate deploy

PORT="${PORT:-10000}"
export PORT

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  (
    cd /app/apps/bot
    # The bot talks to the API inside this container.
    export API_BASE_URL="http://127.0.0.1:${PORT}"
    # Links in Telegram messages open the console. WEB_ORIGIN may list several.
    export CONSOLE_URL="${CONSOLE_URL:-${WEB_ORIGIN%%,*}}"
    sleep 5
    while true; do
      /opt/bot/bin/python main.py || true
      echo "[start] telegram bot stopped; restarting in 5 seconds"
      sleep 5
    done
  ) &
else
  echo "[start] TELEGRAM_BOT_TOKEN is not set, so the Telegram bot is off"
fi

exec node dist/main
