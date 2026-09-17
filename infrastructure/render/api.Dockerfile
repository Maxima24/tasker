# The API and the Telegram bot, in one container.
#
# The API has to run on an instance that never sleeps (ticket reminders, push
# alerts, the bot's calls), and the bot is small, so it shares that instance
# rather than costing a second service. Built from the repository root:
#   docker build -f infrastructure/render/api.Dockerfile .

# --- build the API ----------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Manifests first, so dependency layers are reused when only code changes.
# The web manifest is needed for pnpm to accept the shared lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @tasker/api...

COPY apps/api apps/api
RUN pnpm --filter @tasker/api exec prisma generate \
 && pnpm --filter @tasker/api exec nest build

# --- run the API and the bot -------------------------------------------------
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 python3-venv tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

COPY apps/bot/requirements.txt apps/bot/requirements.txt
RUN python3 -m venv /opt/bot \
 && /opt/bot/bin/pip install --no-cache-dir -r apps/bot/requirements.txt

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY apps/bot apps/bot
COPY infrastructure/render/start.sh /app/start.sh

# A checkout on Windows can give the script CRLF line endings, which sh rejects.
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

USER node
EXPOSE 10000
# tini forwards Render's stop signal to both processes.
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["/app/start.sh"]
