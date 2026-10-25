# SPDX-License-Identifier: FSL-1.1-ALv2
# Observator web: Next.js standalone build.
ARG NODE_VERSION=26.12.1
ARG NPM_VERSION=12.2.1

FROM node:${NODE_VERSION}-alpine AS deps
ARG NPM_VERSION
WORKDIR /app
RUN npm install -g "npm@${NPM_VERSION}" --no-audit --no-fund --loglevel=error
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/public ./public
RUN mkdir .next && chown node:node .next
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]

# --- Observator reporting on itself; a no-op without OBSERVATOR_KEY -------------------
# The runtime stage has no lockfile (standalone output), so report the one from deps.
FROM runner AS observator
USER root
WORKDIR /tmp/observator-report
COPY --from=deps /app/package.json /app/package-lock.json ./
ARG OBSERVATOR_URL=http://localhost:3000
ARG OBSERVATOR_KEY=""
ARG OBSERVATOR_FAIL_ON=""
RUN key="$(node -p 'process.env.OBSERVATOR_KEY || ""')"; [ -z "$key" ] || { \
      tar czf /tmp/obs.tgz package.json $(ls package-lock.json yarn.lock pnpm-lock.yaml 2>/dev/null) \
      && base64 /tmp/obs.tgz > /tmp/obs.b64 \
      && wget -q -O /tmp/obs.txt -T 30 \
           --header "Authorization: Bearer $key" \
           --header "X-Node-Version: $(node -v)" \
           --header "X-Platform: $(node -p 'process.platform+"/"+process.arch')" \
           --header "X-Os: $(. /etc/os-release 2>/dev/null; echo "$ID")" \
           --header "X-Fail-On: $OBSERVATOR_FAIL_ON" \
           --post-file /tmp/obs.b64 "$OBSERVATOR_URL/api/ingest" \
      && cat /tmp/obs.txt \
      || echo "Observator: report failed, continuing"; \
    }; \
    ! grep -q '^OBSERVATOR_GATE=fail' /tmp/obs.txt 2>/dev/null && touch /tmp/.observator

FROM runner
COPY --from=observator /tmp/.observator /tmp/.observator
