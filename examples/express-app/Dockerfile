# SPDX-License-Identifier: FSL-1.1-ALv2
# Example app for testing the Observator snippet. Alpine: BusyBox wget.
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY index.js ./
ENV NODE_ENV=production
CMD ["node", "index.js"]

# --- Observator: reports Node version + lockfile; does not end up in the final image ---
FROM app AS observator
ARG OBSERVATOR_URL=https://observator.example.com
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

FROM app
COPY --from=observator /tmp/.observator /tmp/.observator
