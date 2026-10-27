# SPDX-License-Identifier: FSL-1.1-ALv2
# Example app for testing the Observator snippet. Plain sh on Alpine: sent with BusyBox wget.
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY index.js ./
ENV NODE_ENV=production
CMD ["node", "index.js"]

# --- Observator: reports runtime versions + lockfile; does not end up in the final image ---
FROM app AS observator
ARG OBSERVATOR_URL=https://observator.example.com
ARG OBSERVATOR_KEY=""
ARG OBSERVATOR_FAIL_ON=""
ARG OBSERVATOR_PROJECT=""
ARG OBSERVATOR_LABELS=""
RUN key="$(env | sed -n 's/^OBSERVATOR_KEY=//p')"; [ -z "$key" ] || { \
      rt=""; \
      v="$(node -v 2>/dev/null)" && rt="$rt,node/${v#v}"; \
      v="$(bun --version 2>/dev/null)" && rt="$rt,bun/${v#v}"; \
      v="$(deno eval 'console.log(Deno.version.deno)' 2>/dev/null)" && rt="$rt,deno/${v#v}"; \
      v="$(python3 -c 'import platform;print(platform.python_version())' 2>/dev/null)" && rt="$rt,python/${v#v}"; \
      v="$(php -r 'echo PHP_VERSION;' 2>/dev/null)" && rt="$rt,php/${v#v}"; \
      v="$(ruby -e 'print RUBY_VERSION' 2>/dev/null)" && rt="$rt,ruby/${v#v}"; \
      export OBS_KEY="$key" OBS_RUNTIME="${rt#,}" OBS_PLATFORM="$(uname -s)/$(uname -m)" \
        OBS_OS="$(. /etc/os-release 2>/dev/null; echo "$ID")"; \
      files="$(ls package.json package-lock.json yarn.lock pnpm-lock.yaml 2>/dev/null)"; \
      if [ -n "$files" ]; then tar czf /tmp/obs.tgz $files; else : > /tmp/obs.tgz; fi; \
      if command -v curl >/dev/null; then \
        curl -fsS -m 30 -o /tmp/obs.txt \
          -H "Authorization: Bearer $key" \
          -H "X-Runtime: $OBS_RUNTIME" \
          -H "X-Platform: $OBS_PLATFORM" \
          -H "X-Os: $OBS_OS" \
          -H "X-Fail-On: $OBSERVATOR_FAIL_ON" \
          -H "X-Project: $OBSERVATOR_PROJECT" \
          -H "X-Labels: $OBSERVATOR_LABELS" \
          --data-binary @/tmp/obs.tgz "$OBSERVATOR_URL/api/ingest"; \
      elif command -v wget >/dev/null; then \
        base64 /tmp/obs.tgz > /tmp/obs.b64 && wget -q -O /tmp/obs.txt -T 30 \
          --header "Authorization: Bearer $key" \
          --header "X-Runtime: $OBS_RUNTIME" \
          --header "X-Platform: $OBS_PLATFORM" \
          --header "X-Os: $OBS_OS" \
          --header "X-Fail-On: $OBSERVATOR_FAIL_ON" \
          --header "X-Project: $OBSERVATOR_PROJECT" \
          --header "X-Labels: $OBSERVATOR_LABELS" \
          --post-file /tmp/obs.b64 "$OBSERVATOR_URL/api/ingest"; \
      elif command -v node >/dev/null; then \
        node -e 'const fs = require("fs"), e = process.env; \
          fetch(e.OBSERVATOR_URL + "/api/ingest", { method: "POST", body: fs.readFileSync("/tmp/obs.tgz"), \
          signal: AbortSignal.timeout(30000), headers: { \
            "Authorization": "Bearer " + e.OBS_KEY, \
            "X-Runtime": e.OBS_RUNTIME || "", \
            "X-Platform": e.OBS_PLATFORM || "", \
            "X-Os": e.OBS_OS || "", \
            "X-Fail-On": e.OBSERVATOR_FAIL_ON || "", \
            "X-Project": e.OBSERVATOR_PROJECT || "", \
            "X-Labels": e.OBSERVATOR_LABELS || "", \
          } }).then(async (r) => { const t = await r.text(); if (!r.ok) { console.log(t.trim()); process.exit(1); } \
          fs.writeFileSync("/tmp/obs.txt", t); }).catch((x) => { console.log(String(x)); process.exit(1); }) \
        '; \
      elif command -v python3 >/dev/null; then \
        python3 -c 'import os, urllib.request as u; e = os.environ; \
          h = {k: e.get(v, "") for k, v in [ \
            ("X-Runtime", "OBS_RUNTIME"), \
            ("X-Platform", "OBS_PLATFORM"), \
            ("X-Os", "OBS_OS"), \
            ("X-Fail-On", "OBSERVATOR_FAIL_ON"), \
            ("X-Project", "OBSERVATOR_PROJECT"), \
            ("X-Labels", "OBSERVATOR_LABELS"), \
          ]}; \
          h["Authorization"] = "Bearer " + e["OBS_KEY"]; \
          r = u.urlopen(u.Request(e["OBSERVATOR_URL"] + "/api/ingest", data=open("/tmp/obs.tgz", "rb").read(), headers=h), timeout=30); \
          open("/tmp/obs.txt", "wb").write(r.read()) \
        ' 2>/dev/null; \
      else echo "Observator: no curl, wget, node or python3 in this image"; false; fi \
      && cat /tmp/obs.txt \
      || echo "Observator: report failed, continuing"; \
    }; \
    ! grep -q '^OBSERVATOR_GATE=fail' /tmp/obs.txt 2>/dev/null && touch /tmp/.observator

FROM app
COPY --from=observator /tmp/.observator /tmp/.observator
