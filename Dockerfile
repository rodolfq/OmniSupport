# SSX Desk — imagem de produção.
#
# Base Debian slim, NÃO Alpine: onnxruntime-node (transcrição Whisper e
# embeddings), sharp e ffmpeg-static distribuem binários nativos linkados
# contra glibc; em musl eles falham em runtime, não no build — o erro só
# apareceria quando alguém ligasse ENABLE_AUDIO_TRANSCRIPTION.

# ---------- deps ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci respeita o lockfile; --ignore-scripts NÃO pode ser usado aqui, os
# pacotes nativos acima dependem do postinstall pra baixar/linkar binário.
RUN npm ci

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Telemetria desligada: build offline não deve depender de rede externa.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# `npm run build` dispara o prebuild (check:encoding) — mantido de propósito,
# é a única checagem que roda sozinha no build (tipo/lint estão ignorados em
# next.config.ts, ver seção 14 do CLAUDE.md).
RUN npm run build

# ---------- runner ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Cache dos modelos do @huggingface/transformers (Whisper/embeddings). Aponta
# pra um volume no compose — sem isso cada restart do container rebaixa
# ~150MB por modelo.
ENV HF_HOME=/data/models
# Diretório dos anexos (ver docker-compose.yml). Fica em volume porque é o
# único estado da aplicação que não vive no Postgres.
ENV ATTACHMENTS_DIR=/data/attachments

# ffmpeg do sistema não é necessário (usamos ffmpeg-static), mas curl é o
# healthcheck e ca-certificates é exigido pelas chamadas HTTPS de saída
# (Meta Cloud API, Groq, Bitrix24).
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# O usuário 'node' já existe na imagem base; os volumes precisam pertencer a
# ele, senão o container sobe sem permissão de escrita nos anexos.
RUN mkdir -p /data/models /data/attachments && chown -R node:node /data

COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Migrations e o runner viajam na imagem pra permitir
# `docker compose run --rm app node scripts/run-migrations.js` no servidor.
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/scripts ./scripts

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
