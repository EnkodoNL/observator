#!/bin/sh
# SPDX-License-Identifier: FSL-1.1-ALv2
#
# Builds examples/express-app with every snippet variant against a running Observator and
# checks that: the report arrives, the key never ends up in the final image, and a missing
# key, a wrong key or an unreachable server never breaks the build.
#
# Usage:
#   OBSERVATOR_URL=http://host.docker.internal:3000 OBSERVATOR_KEY=obs_... examples/test-snippet.sh
#
# OBSERVATOR_URL is the URL as seen from inside a build container.
set -eu

: "${OBSERVATOR_URL:?set OBSERVATOR_URL}"
: "${OBSERVATOR_KEY:?set OBSERVATOR_KEY}"
IMAGES_ALPINE=${IMAGES_ALPINE:-"node:22-alpine node:24-alpine node:26-alpine"}

cd "$(dirname "$0")/express-app"
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT
FAILED=0

# Lines printed by RUN steps ("#12 0.42 Observator: ..."), not the echoed RUN command itself.
output() {
  sed -n -E 's/^#[0-9]+ [0-9.]+ ((Observator: |OBSERVATOR_GATE=).*)$/\1/p' "$LOG"
}

fail() {
  echo "  FAIL: $*"
  FAILED=1
}

# build <tag> <dockerfile> <base image> <url> <key>
build() {
  echo "==> $1 ($3, $2)"
  if ! docker build --progress=plain --no-cache-filter observator \
    --add-host=host.docker.internal:host-gateway \
    -f "$2" -t "observator-example:$1" \
    --build-arg "NODE_IMAGE=$3" \
    --build-arg "OBSERVATOR_URL=$4" \
    --build-arg "OBSERVATOR_KEY=$5" \
    . >"$LOG" 2>&1; then
    tail -30 "$LOG"
    fail "docker build failed"
    return 1
  fi
  output | sed 's/^/    /' || true
}

expect_report() {
  output | grep -q 'Observator: recorded build' || fail "no report in build log"
  if grep -q "$OBSERVATOR_KEY" "$LOG"; then
    fail "API key visible in the build log"
  fi
  if docker history --no-trunc "observator-example:$1" | grep -q "$OBSERVATOR_KEY"; then
    fail "API key visible in docker history"
  fi
  if docker image inspect "observator-example:$1" | grep -q "$OBSERVATOR_KEY"; then
    fail "API key visible in image config"
  fi
}

for image in $IMAGES_ALPINE; do
  tag="alpine-$(echo "$image" | tr -cd '0-9')"
  build "$tag" Dockerfile "$image" "$OBSERVATOR_URL" "$OBSERVATOR_KEY" && expect_report "$tag"
done

build slim Dockerfile.slim node:22-slim "$OBSERVATOR_URL" "$OBSERVATOR_KEY" && expect_report slim
build curl Dockerfile.curl node:22 "$OBSERVATOR_URL" "$OBSERVATOR_KEY" && expect_report curl

build no-key Dockerfile node:22-alpine "$OBSERVATOR_URL" "" &&
  { ! output | grep -q 'Observator:' || fail "reported without a key"; }

build bad-key Dockerfile node:22-alpine "$OBSERVATOR_URL" "obs_invalid" &&
  { output | grep -q 'report failed, continuing' || fail "bad key did not fall back"; }

build unreachable Dockerfile node:22-alpine "http://127.0.0.1:9" "$OBSERVATOR_KEY" &&
  { output | grep -q 'report failed, continuing' || fail "unreachable server did not fall back"; }

build unreachable-slim Dockerfile.slim node:22-slim "http://127.0.0.1:9" "$OBSERVATOR_KEY" &&
  { output | grep -q 'report failed, continuing' || fail "unreachable server did not fall back (slim)"; }

if [ "$FAILED" -ne 0 ]; then
  echo "Some checks failed."
  exit 1
fi
echo "All snippet checks passed."
