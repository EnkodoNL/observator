#!/bin/sh
# SPDX-License-Identifier: FSL-1.1-ALv2
#
# Builds the example apps against a running Observator, one image per way the snippet sends
# (wget, node, curl, python3), and checks that: the report arrives with the right runtimes, the
# key never ends up in the build log or the image, and a missing key, a wrong key or an
# unreachable server never breaks the build.
#
# Usage:
#   OBSERVATOR_URL=http://host.docker.internal:3000 OBSERVATOR_KEY=obs_... examples/test-snippet.sh
#
# With OBSERVATOR_SHARED_KEY=obss_... it also checks that a shared key creates its project on
# the first report, reuses it after that, and falls back to the package.json name.
#
# OBSERVATOR_URL is the URL as seen from inside a build container.
set -eu

: "${OBSERVATOR_URL:?set OBSERVATOR_URL}"
: "${OBSERVATOR_KEY:?set OBSERVATOR_KEY}"
IMAGES_ALPINE=${IMAGES_ALPINE:-"node:22-alpine node:24-alpine node:26-alpine"}

cd "$(dirname "$0")"
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

# build <tag> <dockerfile> <ARG=image> <url> <key> [project]
build() {
  echo "==> $1 ($3, $2)"
  if ! docker build --progress=plain --no-cache-filter observator \
    --add-host=host.docker.internal:host-gateway \
    -f "$2" -t "observator-example:$1" \
    --build-arg "$3" \
    --build-arg "OBSERVATOR_URL=$4" \
    --build-arg "OBSERVATOR_KEY=$5" \
    --build-arg "OBSERVATOR_PROJECT=${6:-}" \
    "$(dirname "$2")" >"$LOG" 2>&1; then
    tail -30 "$LOG"
    fail "docker build failed"
    return 1
  fi
  output | sed 's/^/    /' || true
}

# expect_report <tag> <extended regex for what is inside the parentheses of the report line>
expect_report() {
  output | grep -Eq "Observator: recorded build for .* \($2" || fail "no report matching ($2"
  output | grep -Eq 'Observator: recorded build .*, linux/(amd64|arm64)' || fail "platform not normalized"
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

EXPRESS=express-app/Dockerfile
PYTHON=python-app/Dockerfile

# wget (BusyBox)
for image in $IMAGES_ALPINE; do
  tag="alpine-$(echo "$image" | tr -cd '0-9')"
  build "$tag" "$EXPRESS" "NODE_IMAGE=$image" "$OBSERVATOR_URL" "$OBSERVATOR_KEY" &&
    expect_report "$tag" "node ${tag#alpine-}\.[0-9.]+, linux/[a-z0-9]+, npm, [0-9]+ packages"
done
# node's fetch: no curl or wget in slim images
build slim "$EXPRESS.slim" NODE_IMAGE=node:22-slim "$OBSERVATOR_URL" "$OBSERVATOR_KEY" &&
  expect_report slim 'node 22\.[0-9.]+, linux/[a-z0-9]+, npm, [0-9]+ packages'
# curl; the full Debian image also has python3, which is reported next to node
build curl "$EXPRESS.curl" NODE_IMAGE=node:22 "$OBSERVATOR_URL" "$OBSERVATOR_KEY" &&
  expect_report curl 'node 22\.[0-9.]+, python 3\.[0-9.]+, '
# python3 only: no package.json, so only the runtime
build python "$PYTHON" PYTHON_IMAGE=python:3.12-slim "$OBSERVATOR_URL" "$OBSERVATOR_KEY" &&
  expect_report python 'python 3\.12\.[0-9]+, linux/[a-z0-9]+, no lockfile\)'

build no-key "$EXPRESS" NODE_IMAGE=node:22-alpine "$OBSERVATOR_URL" "" &&
  { ! output | grep -q 'Observator:' || fail "reported without a key"; }

build bad-key "$EXPRESS" NODE_IMAGE=node:22-alpine "$OBSERVATOR_URL" "obs_invalid" &&
  { output | grep -q 'not recorded: unknown key obs_inval' || fail "bad key was not explained"; }

for client in "alpine $EXPRESS NODE_IMAGE=node:22-alpine" "slim $EXPRESS.slim NODE_IMAGE=node:22-slim" \
  "curl $EXPRESS.curl NODE_IMAGE=node:22" "python $PYTHON PYTHON_IMAGE=python:3.12-slim"; do
  set -- $client
  build "unreachable-$1" "$2" "$3" "http://127.0.0.1:9" "$OBSERVATOR_KEY" &&
    { output | grep -q 'report failed, continuing' || fail "unreachable server did not fall back ($1)"; }
done

# A snippet from before X-Runtime gets told to update, instead of being recorded without a runtime.
echo "==> outdated snippet"
outdated=$(docker run --rm --add-host=host.docker.internal:host-gateway \
  -e URL="$OBSERVATOR_URL" -e KEY="$OBSERVATOR_KEY" node:22-alpine node -e '
fetch(process.env.URL + "/api/ingest", { method: "POST", body: "",
  headers: { Authorization: "Bearer " + process.env.KEY, "X-Node-Version": "v22.11.0" } })
  .then((r) => r.text()).then((t) => console.log(t.trim()), (e) => console.log(String(e)))')
echo "    $outdated"
echo "$outdated" | grep -q 'not recorded: this Observator snippet is outdated' || fail "old snippet was not told to update"

if [ -n "${OBSERVATOR_SHARED_KEY:-}" ]; then
  name="snippet-shared-$$"
  build shared-new "$EXPRESS" NODE_IMAGE=node:22-alpine "$OBSERVATOR_URL" "$OBSERVATOR_SHARED_KEY" "$name" &&
    { output | grep -q "created project $name" || fail "shared key did not create $name"; }
  build shared-again "$EXPRESS" NODE_IMAGE=node:22-alpine "$OBSERVATOR_URL" "$OBSERVATOR_SHARED_KEY" "$name" &&
    { output | grep -q "recorded build for $name" || fail "shared key did not reuse $name"; } &&
    { ! output | grep -q "created project" || fail "shared key created $name twice"; }
  build shared-fallback "$EXPRESS" NODE_IMAGE=node:22-alpine "$OBSERVATOR_URL" "$OBSERVATOR_SHARED_KEY" "" &&
    { output | grep -q "observator-example" || fail "shared key did not fall back to the package.json name"; }
  # Without package.json there is no name to fall back to.
  build shared-noname "$PYTHON" PYTHON_IMAGE=python:3.12-slim "$OBSERVATOR_URL" "$OBSERVATOR_SHARED_KEY" "" &&
    { output | grep -q "not recorded: no project name" || fail "shared key without a name was not explained"; }
fi

if [ "$FAILED" -ne 0 ]; then
  echo "Some checks failed."
  exit 1
fi
echo "All snippet checks passed."
