# Observator

Self-hosted overview of the Node.js versions and npm packages inside your containers, with a
message on Slack, Telegram, e-mail or your own push service the moment one of them needs attention.

<!-- Screenshot: docs/screenshot.png (dashboard, dark mode) -->

`FROM node:22-alpine` tells you nothing about the Node version that actually ships. The image you
built three months ago still runs 22.11.0, and a rebuild often reuses the cached base image anyway.
Observator records what every build really contains, checks it against the Node.js release
schedule and OSV.dev, and stays quiet until there is something to do.

- **Node:** the exact version per app, its release line (current, LTS, maintenance, end-of-life), and
  "Security update available: 22.23.4" with the image tag to pin.
- **Packages:** every npm package from `package-lock.json`, `yarn.lock` (v1 and Berry) or
  `pnpm-lock.yaml`, checked against OSV.dev, with severity, the fixed version and whether it is a
  direct or transitive dependency.
- **Notifications:** Slack, Telegram, Discord, e-mail, ntfy, Gotify, Pushover, Apprise and webhooks.
  One message per problem, bundled per build, retried in the background.
- **In the build log:** every report prints a short status line, so Coolify's deploy log already
  tells you what is wrong. An opt-in gate can fail the build on critical advisories.
- **Small:** two containers (Next.js and PocketBase), no Redis, no queue, no extra worker.
- **Sign-in:** a passkey, or a password plus an authenticator code. Never a password alone.

And for the days you do open it:

- **Node overview:** all projects grouped by Node version. "These four apps need 22.23.4", with the
  `FROM` line to pin.
- **Fix advice:** per advisory, the command or override that fixes it in your package manager
  (`npm install`, `yarn add`, `pnpm add`, `overrides`, `resolutions`), and whether it is a major upgrade.
- **Redeploy:** with a deploy webhook (Coolify, Dokploy, Portainer, ...), a Redeploy button on the
  project and in notifications, always with a confirmation.
- **Ignore with a reason:** accept an advisory for one project or all of them, optionally until a
  date. It stays visible as *ignored* and comes back when the ignore expires.
- **Build history and diffs:** when the Node version changed, and which packages were added, removed,
  upgraded or downgraded.
- **Outdated direct dependencies:** the latest version from the npm registry, labelled major, minor or
  patch. Display only.
- **Package search:** "where is `lodash` used, and in which version?" across all projects.
- **Status badge** for a README, a **command palette** (Cmd/Ctrl+K), and **invite links** for other
  users.
- **It watches itself:** Observator reports the Node version it runs on and its own packages at every
  start and daily, as the *Observator* project. No key or snippet involved.

## Quickstart

```sh
git clone https://github.com/EnkodoNL/observator.git
cd observator
cp .env.example .env        # set APP_URL and the PocketBase superuser password
docker compose up -d --build
```

Open `APP_URL`, create the first account on the setup page (it only works once), and add a project
under **Settings → Projects**. You get an API key, shown once, and the Dockerfile snippet below.

## Reporting from a Dockerfile

Name the final stage of your Dockerfile `app` and add this to the end:

```dockerfile
FROM node:22-alpine AS app
# ... your existing Dockerfile ...

# --- Observator: reports Node version + lockfile; does not end up in the final image ---
FROM app AS observator
ARG OBSERVATOR_URL=https://observator.example.com
ARG OBSERVATOR_KEY=""
ARG OBSERVATOR_FAIL_ON=""
ARG OBSERVATOR_PROJECT=""
RUN key="$(node -p 'process.env.OBSERVATOR_KEY || ""')"; [ -z "$key" ] || { \
      tar czf /tmp/obs.tgz package.json $(ls package-lock.json yarn.lock pnpm-lock.yaml 2>/dev/null) \
      && base64 /tmp/obs.tgz > /tmp/obs.b64 \
      && wget -q -O /tmp/obs.txt -T 30 \
           --header "Authorization: Bearer $key" \
           --header "X-Node-Version: $(node -v)" \
           --header "X-Platform: $(node -p 'process.platform+"/"+process.arch')" \
           --header "X-Os: $(. /etc/os-release 2>/dev/null; echo "$ID")" \
           --header "X-Fail-On: $OBSERVATOR_FAIL_ON" \
           --header "X-Project: $OBSERVATOR_PROJECT" \
           --post-file /tmp/obs.b64 "$OBSERVATOR_URL/api/ingest" \
      && cat /tmp/obs.txt \
      || echo "Observator: report failed, continuing"; \
    }; \
    ! grep -q '^OBSERVATOR_GATE=fail' /tmp/obs.txt 2>/dev/null && touch /tmp/.observator

FROM app
COPY --from=observator /tmp/.observator /tmp/.observator
```

Then pass the key as a build argument:

```sh
docker build --build-arg OBSERVATOR_KEY=obs_... .
```

In **Coolify**, add `OBSERVATOR_KEY` as an environment variable of the app and tick
*Build Variable*. The snippet itself contains no secret and can be committed.

The build log then shows something like:

```
Observator: recorded build for api (node v22.11.0, linux/x64, npm, 412 packages)
Observator: WARN Node security update available: 22.23.4. Pin node:22.23.4-alpine and redeploy.
Observator: WARN 3 vulnerable package advisories (1 critical, 2 high)
Observator:   minimist@1.2.5: GHSA-xvch-5gv4-984h (critical), fixed in 1.2.6
Observator: details: https://observator.example.com/projects/api
```

### One key for all apps

Creating a project per app is optional. Under **Settings → Projects → Shared keys** you create one
write-only key and give it to every app, each with its own name:

```sh
docker build --build-arg OBSERVATOR_KEY=obss_... --build-arg OBSERVATOR_PROJECT=billing-api .
```

The project is created on its first report. Without `OBSERVATOR_PROJECT`, the `name` from
`package.json` is used.

- **Scope.** A shared key only reports, and only to projects it created itself. If a project with
  that name already exists (made in the UI or by another key), the report is refused with a message
  in the build log; the build itself goes on.
- **One project per server** (on by default). The same name reported from different source IPs
  becomes separate projects, such as `api · 203.0.113.7` and `api · 203.0.113.8`. With load-balanced
  replicas that each build their own image, a replica that is still on an old Node then shows up on
  its own instead of flipping the project's status back and forth. Turn it off for CI runners, whose
  IP changes with every build; use names like `server-1/api` if you want to tell servers apart there.
  Behind Coolify's Traefik the IP comes from `X-Forwarded-For`.
- **Revoking** a shared key stops it. Its projects stay with their history and can get their own key
  through *Rotate API key*.

### How the snippet behaves

- **It never breaks your build.** No key, a wrong key or an unreachable server prints
  `report failed, continuing` and the build goes on. The only exception is the gate below, and only
  if you turn it on.
- **The key stays out of the image.** The report runs in a separate stage; the final image only gets
  an empty marker file from it (the `COPY` makes BuildKit run that stage). The key is read through
  `node -p` instead of `$OBSERVATOR_KEY`, because BuildKit prints `RUN` commands with build arguments
  filled in, which would put the key in your build log.
- **It only uses what `node:*-alpine` ships:** `sh`, BusyBox `tar`, `base64` and `wget`, and `node`.
  The archive is base64-encoded because BusyBox `wget --post-file` stops at the first NUL byte and
  would truncate a binary upload.

### Other base images

`node:*-slim` has neither `wget` nor `curl`. Replace the `base64` and `wget` lines with a POST through
Node's `fetch`:

```dockerfile
      && node -e ' \
           const fs = require("fs"), env = process.env; \
           const os = ((fs.existsSync("/etc/os-release") ? fs.readFileSync("/etc/os-release", "utf8") : "").match(/^ID="?([a-z0-9._-]+)/m) || [])[1] || ""; \
           fetch(env.OBSERVATOR_URL + "/api/ingest", { method: "POST", body: fs.readFileSync("/tmp/obs.tgz"), \
             signal: AbortSignal.timeout(30000), headers: { \
               "Authorization": "Bearer " + env.OBSERVATOR_KEY, "X-Node-Version": process.version, \
               "X-Platform": process.platform + "/" + process.arch, "X-Os": os, "X-Fail-On": env.OBSERVATOR_FAIL_ON || "", \
               "X-Project": env.OBSERVATOR_PROJECT || "" } }) \
           .then(async (r) => { const t = await r.text(); if (!r.ok) { console.log(t.trim()); process.exit(1); } \
             fs.writeFileSync("/tmp/obs.txt", t); }).catch((e) => { console.log(String(e)); process.exit(1); })' \
```

Images with `curl` (such as the full `node:22`) can use:

```dockerfile
      && curl -fsS -m 30 -o /tmp/obs.txt \
           -H "Authorization: Bearer $key" \
           -H "X-Node-Version: $(node -v)" \
           -H "X-Platform: $(node -p 'process.platform+"/"+process.arch')" \
           -H "X-Os: $(. /etc/os-release 2>/dev/null; echo "$ID")" \
           -H "X-Fail-On: $OBSERVATOR_FAIL_ON" \
           -H "X-Project: $OBSERVATOR_PROJECT" \
           --data-binary @/tmp/obs.tgz "$OBSERVATOR_URL/api/ingest" \
```

The project's *Setup* tab shows all three variants with your URL filled in.
[`examples/express-app`](examples/express-app) contains one Dockerfile per variant, and
[`examples/test-snippet.sh`](examples/test-snippet.sh) builds them against a running Observator.

### Multi-stage builds

The report stage needs `package.json` and the lockfile in its working directory, and the `node`
binary that actually runs in production. If your final stage only contains build output, copy the two
files in:

```dockerfile
FROM app AS observator
WORKDIR /tmp/observator-report
COPY --from=deps /app/package.json /app/package-lock.json ./
# ... the RUN from the snippet ...
```

### Build gate (optional)

Set `OBSERVATOR_FAIL_ON` (also a build variable) to fail the build when Observator knows about a
problem: a severity (`critical`, `high`, `moderate`, `low`) for package advisories, `node` for a
missing Node security release, or both, such as `high,node`. With a new lockfile the server checks
OSV before answering (up to 20 seconds). If that check does not finish, the gate passes and says so.

### What is sent

Exactly this, and nothing else:

- `package.json` and one lockfile (`package-lock.json`, `yarn.lock` or `pnpm-lock.yaml`)
- the output of `node -v`, the platform and architecture, and the `ID` from `/etc/os-release`
- the gate setting and the project name (`OBSERVATOR_PROJECT`), if set

No source code, no environment variables, no other files. The raw files are parsed in memory and not
stored; Observator keeps the resulting package list.

### Caching

A build that is fully cached does not report again. Nothing changed then, so nothing is lost. The
*stale* notification tells you when a project has not reported for a while (14 days by default).

## Per project

### Redeploy

On a project's *Setup* tab you can store a deploy webhook. Observator calls it when you press
*Redeploy* on the project page or in a notification, always after a confirmation.

- **Coolify:** the resource's deploy webhook URL (`https://coolify.example.com/api/v1/deploy?uuid=...`),
  method `GET`, and a Coolify API token as bearer token.
- **Dokploy, Portainer:** the webhook URL, method `POST`, no token.

A rebuild only gets a newer Node if the Dockerfile pins the new version (as the advice says) or the
build pulls the base image.

### Status badge

The *Setup* tab also has a badge URL for your README, showing `ok`, `node update` or the number of
open advisories:

```markdown
[![Observator](https://observator.example.com/badge/api.svg?token=...)](https://observator.example.com/projects/api)
```

The token only grants the badge. Without it the badge says `unknown`.

## Notifications

Add channels under **Settings → Notifications**. Each has a *Send test* button.

| Channel | What you need |
| --- | --- |
| Slack | An incoming webhook URL |
| Telegram | A bot token from @BotFather; *Detect chat* finds the chat id |
| Discord | A channel webhook URL |
| E-mail | SMTP settings in the environment, recipients per channel |
| ntfy | Server URL (ntfy.sh or your own) and topic, optional access token |
| Gotify | Server URL and an application token |
| Pushover | User key and API token |
| Apprise API | Your Apprise server, with a stored config key or Apprise URLs |
| Webhook | Any URL; optional HMAC-SHA256 signature |

Events: `node.security_update`, `node.eol` (end-of-life, or within 30 days), `vuln.new`,
`vuln.resolved`, `project.stale` and `digest.weekly`. Per channel you choose the events, the
projects, and a minimum severity for package advisories. Node security updates are always sent.

The rules:

- **One message per problem per project.** A rebuild does not repeat it. A newer Node security
  release for a project that is still behind does notify again, with the new target.
- **Bundled.** Ten new advisories in one build are one message, and a Node security release that
  affects four projects is one message too.
- **Short and actionable.** Each message says what happened, which project, how severe it is and what
  to do ("Pin node:22.23.4-alpine and redeploy"), with a link to the project.
- **In the background.** Messages are queued and sent after the build has its answer. Failed sends are
  retried after 1, 5 and 30 minutes and 2 hours.
- **Reminders (optional).** A problem that stays open is repeated after a configurable number of days.
- **Weekly digest.** By default on Monday at 09:00 in your timezone: what is open, what was resolved,
  and which Node versions are running.

### Webhook format

`POST` with a JSON body: `event`, `tone`, `title`, `summary`, `items[]` (`severity`, `title`,
`detail`, `url`), `more`, `actions[]` (`label`, `url`) and `sentAt`. Headers:
`X-Observator-Event`, `X-Observator-Timestamp` and, with a secret,
`X-Observator-Signature: sha256=<hex>`, where the hex is HMAC-SHA256 of `<timestamp>.<body>`.

## Sign-in

- **Passkey:** signs you in on its own. The device plus its PIN or biometrics already make two
  factors.
- **Password:** always followed by a second step: a code from an authenticator app, a recovery code,
  or one of your passkeys. There is no session until that step is done.
- **First sign-in** (after `/setup`, an invite or a reset) links an authenticator app and shows ten
  recovery codes, each usable once. New codes and passkeys are under **Settings → Account**.
- **No way back to password-only:** the authenticator app can only be turned off while a passkey
  remains, and the last passkey can only be removed once an authenticator app is linked.
- **Lost device:** another user resets two-step verification under **Settings → Users**. That removes
  the account's authenticator, recovery codes and passkeys, and signs it out everywhere.
- **Locked out as the only user:** open the PocketBase admin UI (see
  [Deploying on Coolify](#deploying-on-coolify)), clear `totpSecret` and `recoveryCodes` on your user
  and delete your records in `passkeys`. The next password sign-in links a new authenticator app.

## Architecture

```
docker build ── snippet: tar.gz + headers ──▶ web (Next.js) ──────▶ PocketBase
                                               │                     (internal only)
                                               ├─ UI, login, passkeys
                                               ├─ POST /api/ingest, lockfile parsing
                                               └─ jobs: Node releases hourly, OSV daily,
                                                  digest, notification retries
                                                        │
                       nodejs.org, api.osv.dev, Slack, Telegram, SMTP, ... ◀┘
```

- **web** is a Next.js app (App Router). It serves the UI, the ingest endpoint and the background
  jobs, which run as an interval in the same process with a lock so they never run twice.
- **PocketBase** stores everything. It is not published: only `web` talks to it, as superuser, over
  the internal Docker network. Its schema is defined in
  [`pocketbase/pb_migrations`](pocketbase/pb_migrations), so a fresh volume sets itself up.
- **Sessions** are PocketBase user tokens in an httpOnly cookie. Passkeys are verified by Next.js with
  SimpleWebAuthn, which then gets a token for that user through PocketBase impersonation. After a
  password, the token waits in memory (ten minutes, five tries) until the second step succeeds.
  Authenticator codes are standard TOTP (RFC 6238); recovery codes are stored as hashes.
- **Data sources:** [nodejs.org/dist/index.json](https://nodejs.org/dist/index.json) and the
  [release schedule](https://github.com/nodejs/Release) for Node, and the
  [OSV.dev](https://osv.dev) API for packages. Neither needs an account.

## Configuration

All settings are environment variables; see [`.env.example`](.env.example).

| Variable | Default | |
| --- | --- | --- |
| `APP_URL` | (required) | Public URL; used for links and as passkey RP ID and origin |
| `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD` | (required) | Created or updated on every PocketBase start |
| `WEB_PORT` | `3000` | Host port (compose) |
| `TZ` | `UTC` | Default timezone for the digest |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | | For e-mail notifications |
| `OBSERVATOR_JOBS` | `on` | Background checks |
| `INGEST_MAX_BYTES` | `10485760` | Maximum report size |
| `INGEST_RATE_LIMIT` | `60` | Reports per project per hour |
| `SOURCE_URL` | this repository | Linked in the footer; point it at your fork if you change the code |
| `OBSERVATOR_SELF` | `on` | Observator reports its own Node version and packages as the "Observator" project |

Stale days, reminders and the digest schedule are set in the UI under **Settings → General**.

## Deploying on Coolify

1. Create a resource from this repository with the *Docker Compose* build pack.
2. Give the `web` service a domain (port 3000) and set `APP_URL` to it, with `https://`.
3. Set `PB_SUPERUSER_EMAIL` and a long `PB_SUPERUSER_PASSWORD`, plus SMTP if you want e-mail.
4. Deploy. The PocketBase data lives in the `pb_data` volume.

To reach the PocketBase admin UI for debugging, uncomment the `127.0.0.1:8090:8090` port in
`docker-compose.yml` and use an SSH tunnel.

## Development

Requires Node 22 or later and Docker.

```sh
# PocketBase with its port published on localhost
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d pocketbase

cd app
npm install
cat > .env.local <<'EOF'
APP_URL=http://localhost:3100
PB_URL=http://127.0.0.1:8090
PB_SUPERUSER_EMAIL=admin@observator.local
PB_SUPERUSER_PASSWORD=change-me-to-something-long
EOF
npm run dev        # http://localhost:3100
```

| Command | |
| --- | --- |
| `npm test` | Unit tests (Vitest): lockfile parsers with real lockfiles, issue state machine, Node and OSV logic, notification rendering |
| `npm run lint`, `npm run format:check`, `npm run typecheck` | ESLint, Prettier, TypeScript |
| `node --no-warnings scripts/write-examples.ts` | Regenerate the example Dockerfiles from the snippet code |
| `node ../scripts/check-spdx.mjs`, `node ../scripts/check-licenses.mjs` | License headers and dependency licenses |
| `examples/test-snippet.sh` | Build the example app with every snippet variant against a running stack |

CI runs all of these, and starts the compose stack to build the example app on `node:22-alpine`,
`node:24-alpine`, `node:26-alpine`, `node:22-slim` and `node:22`.

## Limitations

- npm packages only, and only the root `package.json` of a workspace.
- `package-lock.json` lockfileVersion 1 (npm 6) and pnpm lockfiles older than 6.0 are not supported.
- One web instance. The job lock works across instances, but rate limits, passkey challenges and
  half-finished sign-ins live in memory. A restart during the second step means entering the
  password again.

## License

[Functional Source License 1.1, Apache-2.0 future license](LICENSE) (`FSL-1.1-ALv2`).

- **Allowed:** using, copying, changing and self-hosting Observator, for yourself, your company or
  your clients, commercially included.
- **Not allowed:** offering Observator, or something built from it, as a product or service that
  competes with it, such as a hosted Observator.
- **Two years later:** each version also becomes available under Apache-2.0, two years after it was
  released.

Components in `app/src/components/ui` come from [shadcn/ui](https://ui.shadcn.com) and
keep their MIT license.
