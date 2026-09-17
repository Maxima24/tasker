#!/usr/bin/env bash
# Pings the deployed services so Render does not put them to sleep, and fails
# loudly when one is unhealthy so GitHub emails the repository owner.
#
# Each URL is optional; set the ones that exist as repository variables:
#   TASKER_WEB_URL  e.g. https://tasker-web.onrender.com
#   TASKER_API_URL  e.g. https://tasker-api.onrender.com
#   TASKER_BOT_URL  only if the bot runs as a web service with a /health route
#
# Hitting the web app's /api/health travels web -> API -> Postgres and Redis,
# so that single request wakes and checks the whole chain.
set -uo pipefail

# Pasted URLs often end in "/"; strip it so paths do not become "//health".
WEB_URL="${TASKER_WEB_URL:-}"; WEB_URL="${WEB_URL%/}"
API_URL="${TASKER_API_URL:-}"; API_URL="${API_URL%/}"
BOT_URL="${TASKER_BOT_URL:-}"; BOT_URL="${BOT_URL%/}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [[ -z "$WEB_URL$API_URL$BOT_URL" ]]; then
  # Not deployed yet: nothing to ping, and failing here would email the owner
  # every ten minutes about a site that does not exist.
  echo "::notice::No service URLs set yet. Add TASKER_WEB_URL (and TASKER_API_URL) under Settings > Secrets and variables > Actions > Variables."
  exit 0
fi

failed=0
{
  echo "| Service | Result | Time |"
  echo "|---|---|---|"
} >>"$SUMMARY"

ping() {
  local name="$1" url="$2"
  [[ -z "$url" ]] && return 0
  local out code time body
  # A sleeping free service takes about a minute to wake, so give each attempt
  # 90 seconds and retry a few times before calling it down.
  out=$(curl -sS --max-time 90 --retry 4 --retry-delay 10 --retry-all-errors \
    -H "User-Agent: tasker-keep-alive" -o /tmp/keepalive-body -w "%{http_code} %{time_total}" \
    "$url" 2>/tmp/keepalive-err) || true
  code="${out%% *}"
  time="${out##* }"
  # Health answers are short JSON. Anything else (an HTML error page) is noise.
  body=$(head -c 200 /tmp/keepalive-body 2>/dev/null | tr -s '\r\n\t ' ' ' || true)
  [[ "$body" == "{"* ]] || body=""

  if [[ "$code" == "200" ]]; then
    echo "ok    $name  ${time}s  $body"
    echo "| $name | up | ${time}s |" >>"$SUMMARY"
  else
    failed=1
    local reason="${code:-no response}"
    [[ -s /tmp/keepalive-err ]] && reason="$reason $(head -c 200 /tmp/keepalive-err)"
    echo "::error title=$name is down::$url answered $reason $body"
    echo "| $name | **down** ($reason) | ${time:-} |" >>"$SUMMARY"
  fi
}

ping "API (database + Redis)" "${API_URL:+$API_URL/health}"
ping "Web app (through to API)" "${WEB_URL:+$WEB_URL/api/health}"
ping "Telegram bot" "${BOT_URL:+$BOT_URL/health}"

exit "$failed"
