# The whole of Tasker in one container: the web app, the API behind it, and the
# Telegram bot.
#
# One service, because Render's free tier gives a workspace 750 instance hours
# a month - enough for exactly one service kept awake all month. Built from the
# repository root:
#   docker build -f infrastructure/render/Dockerfile .

# --- build the API and the web app ------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Manifests first, so dependency layers are reused when only code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY apps/web apps/web

# The web app reaches the API inside this container. Next.js reads this while
# building, so it is fixed here rather than set on Render.
ENV API_BASE=http://127.0.0.1:3001 \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @tasker/api exec prisma generate \
 && pnpm --filter @tasker/api exec nest build \
 && pnpm --filter @tasker/web build \
 && rm -rf apps/web/.next/cache

# --- run all three ------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 python3-venv tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

COPY apps/bot/requirements.txt apps/bot/requirements.txt
RUN python3 -m venv /opt/bot \
 && /opt/bot/bin/pip install --no-cache-dir -r apps/bot/requirements.txt

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/web/node_modules apps/web/node_modules
COPY --from=build /app/apps/web/.next apps/web/.next
COPY --from=build /app/apps/web/public apps/web/public
COPY --from=build /app/apps/web/package.json apps/web/package.json
COPY --from=build /app/apps/web/next.config.ts apps/web/next.config.ts
COPY apps/bot apps/bot
COPY infrastructure/render/start.sh /app/start.sh

# A checkout on Windows can give the script CRLF line endings, which sh rejects.
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

USER node
EXPOSE 10000
# tini forwards Render's stop signal to every process.
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["/app/start.sh"]
