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
# Observator reports its own Node version and packages at startup (OBSERVATOR_SELF).
COPY --from=deps --chown=node:node /app/package.json /app/package-lock.json ./self/
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
