# Observator

![Observator](https://enkodo.app/observator-github-project.svg)

Self-hosted overview of the runtimes and npm packages inside your containers, with a message on
Slack, Telegram, e-mail or your own push service the moment one of them needs attention.

<!-- Screenshot: docs/screenshot.png (dashboard, dark mode) -->

`FROM node:22-alpine` tells you nothing about the Node version that actually ships. The image you
built three months ago still runs 22.11.0, and a rebuild often reuses the cached base image anyway.
Observator records what every build really contains, checks it against the Node.js release
schedule and OSV.dev, and stays quiet until there is something to do.

- **Runtimes:** the exact Node.js version per app, its release line (current, LTS, maintenance,
  end-of-life), and "Security update available: 22.23.4" with the image tag to pin. Bun, Deno,
  Python, PHP and Ruby are detected and shown as well, without release checks so far.
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

- **Runtimes overview:** all projects grouped by runtime and version. "These four apps need Node.js
  22.23.4", with the `FROM` line to pin.
- **Fix advice:** per advisory, the command or override that fixes it in your package manager
  (`npm install`, `yarn add`, `pnpm add`, `overrides`, `resolutions`), and whether it is a major upgrade.
- **Redeploy:** with a deploy webhook (Coolify, Dokploy, Portainer, ...), a Redeploy button on the
  project and in notifications, always with a confirmation.
- **Ignore with a reason:** accept an advisory for one project or all of them, optionally until a
  date. It stays visible as *ignored* and comes back when the ignore expires.
- **Build history and diffs:** when a runtime or the app's own version changed, and which packages
  were added, removed, upgraded or downgraded.
- **Outdated direct dependencies:** the latest version from the npm registry, labelled major, minor or
  patch. Display only.
- **Packages:** every package across all projects, vulnerable ones first. Per package: which projects
  use it, in which version, through which dependency, and the advisories that apply.
- **Labels:** `app:heatwave`, `env:prod`, `client:acme`, from the build or set by hand. Group and
  filter the overview by them; the servers of one app appear as one card.
- **MCP:** Claude Code (or another MCP client) can query and maintain Observator, and set it up in a
  repository's Dockerfiles in one go. It can create and change, never delete.
- **Status badge** for a README, a **command palette** (Cmd/Ctrl+K), and **invite links** for other
  users.
- **It watches itself:** Observator reports the Node.js version it runs on and its own packages at
  every start and daily, as the *Observator* project. No key or snippet involved.

## Quickstart

```sh
git clone https://github.com/EnkodoNL/observator.git
cd observator
cp .env.example .env        # set APP_URL, the PocketBase superuser password and SECRETS_KEY
docker compose up -d --build
```

Open `APP_URL` and create the first account on the setup page. It asks for the setup code that the
web container prints to its log (`docker compose logs web`), so nobody else can claim a fresh
install, and it only works once. `SETUP_CODE=off` skips the code, for an install nobody else can
reach yet. Then add a project under **Settings → Projects**. You get an API key, shown once, and the Dockerfile snippet below.

## Reporting from a Dockerfile

Two changes to your Dockerfile:

1. **Name the last stage `app`.** The last `FROM` line builds the image you deploy; add `AS app` to it.
   If it already has a name (`AS runner`), use that name instead of `app` in the snippet's two `FROM`
   lines. The *Setup* tab fills it in for you.
2. **Paste the snippet at the very bottom**, after everything else, `CMD` included. It ends with
   `FROM app` again, so the image you build and deploy is still your app.

Or let Observator do it: paste your Dockerfile under *Setup → From your Dockerfile* (beta). It comes
back with the snippet in place and a note per decision: the stage name, whether the base image has a
shell, and whether the lockfile has to come from an earlier stage. The Dockerfile is read in the
browser and not sent anywhere.

```dockerfile
FROM node:22-alpine AS deps
# ... your earlier stages, unchanged ...

# 1. the last stage, named app
FROM node:22-alpine AS app
# ... COPY, ENV, CMD: unchanged ...

# 2. everything below goes at the very bottom

# --- Observator: reports runtime versions + lockfile; does not end up in the final image ---
FROM ghcr.io/enkodonl/observator-reporter:1 AS observator-reporter
FROM app AS observator
COPY --from=observator-reporter /reporter /tmp/observator
ARG OBSERVATOR_URL=https://observator.example.com
ARG OBSERVATOR_KEY=""
ARG OBSERVATOR_FAIL_ON=""
ARG OBSERVATOR_PROJECT=""
ARG OBSERVATOR_LABELS=""
ARG OBSERVATOR_DOMAINS=""
RUN ["/tmp/observator"]

FROM app
COPY --from=observator /tmp/.observator /tmp/.observator
```

Then pass the key as a build argument:

```sh
docker build --build-arg OBSERVATOR_KEY=obs_... .
```

In **Coolify**, add `OBSERVATOR_KEY` as an environment variable of the app and tick
*Build Variable*. The snippet itself contains no secret and can be committed.

The snippet copies a small static binary, the reporter, from `ghcr.io/enkodonl/observator-reporter:1`
and runs it. Your Dockerfile then stays the same when the reporter changes: the `:1` tag follows
fixes and new runtimes. Builds that cannot pull from a registry use the
[plain sh snippet](#without-a-registry-plain-sh) instead; the *Setup* tab has both.

The build log then shows something like:

```
Observator: recorded build for api (node 22.11.0, linux/amd64, npm, 412 packages)
Observator: WARN Node.js security update available: 22.23.4. Pin node:22.23.4-alpine and redeploy.
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
`package.json` is used; an app without `package.json` needs `OBSERVATOR_PROJECT`.

- **Scope.** A shared key only reports, and only to projects it created itself. If a project with
  that name already exists (made in the UI or by another key), the report is refused with a message
  in the build log; the build itself goes on.
- **One project per server** (on by default). The same name reported from different source IPs
  becomes separate projects, such as `api · 203.0.113.7` and `api · 203.0.113.8`. With load-balanced
  replicas that each build their own image, a replica that is still on an old runtime then shows up
  on its own instead of flipping the project's status back and forth. Turn it off for CI runners, whose
  IP changes with every build; use names like `server-1/api` if you want to tell servers apart there.
  How Observator gets the IP is described under [Client addresses](#client-addresses).
- **Revoking** a shared key stops it. Its projects stay with their history and can get their own key
  through *Rotate API key*.

### Without a key: IP allowlist

Builds on your own servers can also report without any key. Give a shared key an *IP allowlist*
(**Settings → Projects → Shared keys**): reports without a key from those addresses count as that
key, with the same projects and limits. Nothing has to be configured per app; only the snippet goes
into each Dockerfile, without the key check, as the allowlist dialog shows it. It then reports
without `OBSERVATOR_KEY` and still uses a key when one is set, so the same Dockerfile works in CI.

- **Which address.** Observator uses the address described under
  [Client addresses](#client-addresses); behind Cloudflare (with `TRUST_CLOUDFLARE=on`) that is your
  server's own address. A build on the same server that reports to the port directly (with
  `WEB_BIND=0.0.0.0`) arrives from the Docker gateway (such as `172.17.0.1`) instead.
  Reports from addresses on no allowlist get `Observator: not recorded: ...` in the build log. The
  address itself is not in that answer, since it would confirm a forged one: it is listed under
  *Not recorded* on the settings page and in the allowlist dialog with an *Add* button, and the web
  container logs it as `[ingest] not recorded (401) from ...`.
- **A wrong key** from an allowed address, such as a stale `OBSERVATOR_KEY` or an unresolved
  `{{team.OBSERVATOR_KEY}}`, does not block the report: it is recorded, with a warning in the build log.
- **Ranges.** Single addresses or CIDR ranges, at most /8 for IPv4 and /32 for IPv6, each with an
  optional note. An address belongs to one shared key only. Hosting providers give each server an
  IPv6 /64, shown as `2a01:4f8:c2c:9793::`; write it as `2a01:4f8:c2c:9793::/64`.
- **Trade-off.** Any process on an allowed server can report. Since reports only ever write, that is
  about as safe as a shared key in a private repository; the key-checked snippet remains the
  default.

### How the snippet behaves

- **It never breaks your build.** No key skips the report. A report Observator does not accept (a
  wrong key, a rate limit, a name taken by another project) prints `Observator: not recorded: ...` with
  the reason and the address it came from; an unreachable server prints `report failed, continuing`.
  Either way the build goes on. The only exception is the gate below, and only
  if you turn it on.
- **The key stays out of the image.** The report runs in a separate stage; the final image only gets
  an empty marker file from it (the `COPY` makes BuildKit run that stage), not the reporter and not
  the key. The reporter reads the key from its environment, and the `RUN` line BuildKit prints is just
  `RUN ["/tmp/observator"]`. A key passed as a BuildKit secret works too:
  `RUN --mount=type=secret,id=OBSERVATOR_KEY,env=OBSERVATOR_KEY ["/tmp/observator"]`.
- **No shell needed.** The reporter is one static binary (Go, for amd64, arm64 and arm/v7). Its
  only dependency is the Go team's fallback root store (`golang.org/x/crypto/x509roots/fallback`,
  BSD-3-Clause, Mozilla's roots), so it reaches an HTTPS Observator from slim images that have no CA
  bundle; roots in the image itself still go first. It runs `node -v`, `bun --version`, `deno`,
  `python3`, `php` and `ruby` directly when the image has them and reports the versions it finds.

### Base images

Any image works, distroless included (node is found in `/nodejs/bin` there). An image without
`package.json` reports only its runtimes; `scratch` has no runtime to report, only the lockfile if you
copy it in.

[`examples/express-app`](examples/express-app) has the reporter on Alpine and distroless plus the
plain sh snippet per way of sending, and [`examples/python-app`](examples/python-app) both forms
without `package.json`. [`examples/test-snippet.sh`](examples/test-snippet.sh) builds them all against
a running Observator.

### Without a registry: plain sh

The same report in plain `sh`, with nothing to pull. It needs a shell and one of `curl`, `wget`,
`node` or `python3`, and sends with the first one the image has: Alpine with BusyBox `wget`, Debian
slim with Node's `fetch`, the full Debian images with `curl`, `python:*-slim` with `python3`. Images
without a shell (distroless, `scratch`) cannot run it.

```dockerfile
# --- Observator: reports runtime versions + lockfile; does not end up in the final image ---
FROM app AS observator
ARG OBSERVATOR_URL=https://observator.example.com
ARG OBSERVATOR_KEY=""
ARG OBSERVATOR_FAIL_ON=""
ARG OBSERVATOR_PROJECT=""
ARG OBSERVATOR_LABELS=""
ARG OBSERVATOR_DOMAINS=""
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
          -H "X-Domains: $OBSERVATOR_DOMAINS" \
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
          --header "X-Domains: $OBSERVATOR_DOMAINS" \
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
            "X-Domains": e.OBSERVATOR_DOMAINS || "", \
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
            ("X-Domains", "OBSERVATOR_DOMAINS"), \
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
```

The key is read from the environment (`env | sed`) instead of as `$OBSERVATOR_KEY`, because BuildKit
prints `RUN` commands with build arguments filled in, which would put the key in your build log. For
BusyBox `wget` the archive is base64-encoded, because `wget --post-file` stops at the first NUL byte
and would truncate a binary upload. Over MCP, `setup_dockerfile` gives this form with
`form: "shell"`, and `upgrade_observator` switches an existing snippet either way, keeping its key,
project, labels, domains and `OBSERVATOR_FAIL_ON`.

### Multi-stage builds

The report stage needs `package.json` and the lockfile in its working directory, and the runtime that
actually runs in production. A final stage that only holds build output, such as a Next.js
standalone image, has `package.json` but no lockfile; then only the runtime versions are checked.
Copy both from the stage that installed the dependencies, right below the first `FROM`:

```dockerfile
FROM runner AS observator
WORKDIR /tmp/observator-report
COPY --from=deps /app/package.json /app/package-lock.json* /app/pnpm-lock.yaml* /app/yarn.lock* ./
# ... the ARG and RUN lines from the snippet, unchanged ...
```

The `*` makes each lockfile optional, so the same line works for npm, pnpm and yarn. In the
*Setup* tab, tick *The last stage has no lockfile* and the snippet includes these lines.

### Build gate (optional)

Set `OBSERVATOR_FAIL_ON` (also a build variable) to fail the build when Observator knows about a
problem: a severity (`critical`, `high`, `moderate`, `low`) for package advisories, `runtime` for a
runtime security release that the image does not have yet (or one runtime by name, such as `node`),
or both, such as `high,node`. Advisories in dev dependencies only count when *Count dev
dependencies* is on under **Settings → General**. With a new lockfile the server checks
OSV before answering (up to 20 seconds). If that check does not finish, the gate passes and says so.

### What is sent

Exactly this, and nothing else:

- `package.json` and one lockfile (`package-lock.json`, `yarn.lock` or `pnpm-lock.yaml`), if the image
  has them
- the version of each runtime it finds (`node -v`, `python3 -c '...python_version()'`, ...), the
  platform (`linux/arm64`), and the `ID` from `/etc/os-release`
- the reporter's version (`X-Reporter: observator-reporter/1.0.0`), for the reporter image
- the gate setting, the project name (`OBSERVATOR_PROJECT`), the labels (`OBSERVATOR_LABELS`) and the
  domains it is served on (`OBSERVATOR_DOMAINS`), if set

No source code, no environment variables, no other files. The raw files are parsed in memory and not
stored; Observator keeps the resulting package list, and the `name` and `version` from
`package.json`.

### Caching

A build that is fully cached does not report again. Nothing changed then, so nothing is lost. The
*stale* notification tells you when a project has not reported for a while (14 days by default).

## Per project

### Redeploy

On a project's *Setup* tab you can store a deploy webhook. Observator calls it when you press
*Redeploy* on the project page or in a notification, always after a confirmation.

- **Coolify:** the resource's deploy webhook URL (`https://coolify.example.com/api/v1/deploy?uuid=...`),
  method `POST` (Coolify answers `GET` with 405 since v4.2), and a Coolify API token as bearer token.
  Give that token the `deploy` permission, and `read` if Observator should watch the resource's
  domains (see [Domains](#domains)); nothing more (*Keys & Tokens → API Tokens*). Leaked, it can then
  start redeploys and read resource settings, but change nothing.
- **Dokploy, Portainer:** the webhook URL, method `POST`, no token.

The URL and the token are stored encrypted, so this needs `SECRETS_KEY` (see
[Secrets at rest](#secrets-at-rest)).

A rebuild only gets a newer runtime if the Dockerfile pins the new version (as the advice says) or the
build pulls the base image.

### Status badges

Every app and every project has a public badge for a README. It shows `ok`, `node update` (or
`node eol`), `no builds`, or the open advisories in production, such as `2 high, 10 moderate`. It is
red for high and critical, amber for moderate.

- **App badge** (`/badge/app/<app>.svg`): all projects of an app together, such as every server behind
  a shared key. An app is its `app:` label, otherwise the name the build reported. This is the one for
  a repository's README.
- **Project badge** (`/badge/<slug>.svg`): one project, or one server of an app.

```markdown
[![Observator](https://observator.example.com/badge/app/api.svg?token=...)](https://observator.example.com/?label=app%3Aapi)
```

You find them at the bottom of a project's overview, under **Settings → Badges** (all apps and
projects), in a project's menu (*Copy badge*), and in `get_project` over MCP. The token in the link
only grants the badge; without it, or with an old one, the badge says `unknown`. *New token* retires
the current link, for when a badge should stop showing.

### Labels

A label is a word (`critical`) or `key:value` (`app:heatwave`, `env:prod`): lowercase letters,
digits and `. _ - /`, at most 20 per project. A project has two kinds:

- **From the build:** `--build-arg OBSERVATOR_LABELS=app:heatwave,role:web` (or a build variable in
  Coolify, or the default in the snippet's `ARG`). They follow the latest report.
- **By hand:** on the project's *Setup* tab, or through MCP. They stay until you change them.

The overview groups projects into apps by their `app:` label (otherwise by the name the build
reported, so the per-server projects of a shared key stay together) and names their parts by `role:`.
It filters on labels: all selected labels must match.

## Domains

Under **Domains**, Observator watches when domains and their certificates run out. A domain can belong
to a project or be watched on its own, such as a parked one.

- **Certificates.** Each hostname (`app.example.com`) is checked daily over TLS: the expiry date, the
  issuer, and whether the certificate is valid for the name. It warns once less than a third of its
  lifetime is left, the point where an automatic renewal should have happened (with Let's Encrypt's
  shorter certificates, a fixed 30 days would always be on), and is urgent at 7 days or when invalid.
- **Registrations.** A hostname's registered domain (`example.com`, from the
  [Public Suffix List](https://publicsuffix.org)) is looked up at its registry over
  [RDAP](https://about.rdap.org), weekly, or daily once the date is near. It warns 30 days ahead and
  is urgent at 7 (both under **Settings → General**). Some registries publish no expiry date (.nl,
  .de) or have no RDAP (.eu, .be): enter the date from your registrar with *Edit*, and it counts like
  the registry's.
- **Where they come from.** Added by hand under *Domains* or over MCP; from the build:
  `--build-arg OBSERVATOR_DOMAINS=app.example.com,api.example.com` (or a build variable in Coolify)
  ties those names to the project and follows each report, like `OBSERVATOR_LABELS`; or from Coolify:
  a project whose deploy webhook points at Coolify gets the resource's domains daily, when the
  webhook's token has the `read` permission. Names added by hand stay until you remove them.
- **Reminder and note.** Per domain, a reminder of your own some days before expiry, with a note, for
  something to do in time: moving a .nl domain to another registrar before it renews, say, so you do
  not pay for the same year twice.

What needs attention shows under *To do* on the overview and on the project's page, and goes out as
`domain.expiring` to the channels that want it; a domain without a project only to channels without
a project filter. Each phase (reminder, warning, urgent, expired) is sent once; a renewal starts over.
Over MCP: `list_domains`, `add_domain`, `update_domain`.

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

Events: `runtime.security_update`, `runtime.eol` (end-of-life, or within 30 days), `vuln.new`,
`vuln.resolved`, `project.stale`, `domain.expiring` (see [Domains](#domains)) and `digest.weekly`. Per channel you choose the events, the
projects, and a minimum severity for package advisories. Runtime security updates are always sent.

The rules:

- **One message per problem per project.** A rebuild does not repeat it. A newer security release
  for a project that is still behind does notify again, with the new target.
- **Bundled.** Ten new advisories in one build are one message, and a Node.js security release
  that affects four projects is one message too.
- **Short and actionable.** Each message says what happened, which project, how severe it is and what
  to do ("Pin node:22.23.4-alpine and redeploy"), with a link to the project.
- **In the background.** Messages are queued and sent after the build has its answer. Failed sends are
  retried after 1, 5 and 30 minutes and 2 hours.
- **Reminders (optional).** A problem that stays open is repeated after a configurable number of days.
- **Weekly digest.** By default on Monday at 09:00 in your timezone: what is open, what was resolved,
  and which runtime versions are running.

### Webhook format

`POST` with a JSON body: `event`, `tone`, `title`, `summary`, `items[]` (`severity`, `title`,
`detail`, `url`), `more`, `actions[]` (`label`, `url`) and `sentAt`. Headers:
`X-Observator-Event`, `X-Observator-Timestamp` and, with a secret,
`X-Observator-Signature: sha256=<hex>`, where the hex is HMAC-SHA256 of `<timestamp>.<body>`.

## MCP

Observator is an [MCP](https://modelcontextprotocol.io) server at `/api/mcp`, for Claude Code and
other clients. Create a token under **Settings → Account → MCP** (it asks for your password again,
because a token acts as you without a second factor), then:

```sh
claude mcp add --transport http observator https://observator.example.com/api/mcp \
  --header "Authorization: Bearer obsm_..."
```

Then ask things like "which projects run a Node.js version with an open security fix?", "where is
lodash 4.17.20 used?", or "set up Observator in my Dockerfiles, use the shared key in my env, and get
the project names and labels right". The `install` prompt (`/mcp__observator__install`) spells out
that last one; the `upgrade` prompt (`/mcp__observator__upgrade`) brings every existing snippet in a
repository to the current version, as the reporter image or as plain sh, and asks about settings a
snippet does not use yet, such as its domains.

- **Read:** projects with status and labels, project details with fix advice, builds and diffs,
  packages across projects, the runtimes overview, shared keys, settings and channels (secrets are never
  shown, only whether they are set).
  `upgrade_observator` replaces the snippet in a Dockerfile you pass with the current one, in the form
  you pick, keeps what the old one was set to, and returns questions about what it does not use yet
  (domains, labels, a fail-on for snippets from before that setting); it changes nothing in Observator
  itself.
- **Create and update** (tokens with *May make changes*): projects and their labels, deploy webhooks
  and keys, ignores (ending one lets it expire instead of deleting it), shared keys and their IP
  allowlists, settings and channels; run checks, redeploy, send a test notification.
  `setup_dockerfile` returns a Dockerfile with the snippet and, if you want, the key, project name
  and labels filled in as defaults, so the build needs no further configuration.
- **Never:** deleting anything, and users, invites, tokens, passwords, 2FA and passkeys. Those stay in
  the web UI.

Every change through MCP is logged by the web container as `[mcp] <email> (<token>) <tool> ...`.
The endpoint speaks both MCP protocol generations (2026-07-28 and the 2025 ones).

## Sign-in

- **Passkey:** signs you in on its own. The device plus its PIN or biometrics already make two
  factors, so a passkey must verify you (a security key without a PIN is refused).
- **Password:** always followed by a second step: a code from an authenticator app, a recovery code,
  or one of your passkeys. There is no session until that step is done.
- **First sign-in** (after `/setup`, an invite or a reset) links an authenticator app and shows ten
  recovery codes, each usable once. New codes and passkeys are under **Settings → Account**.
- **Changing sign-in methods** (adding or removing a passkey, linking an authenticator app) needs a
  sign-in from the last 10 minutes, so a stolen session cannot add a passkey of its own.
- **Sign out everywhere** under **Settings → Account** ends every session at once; signing out only
  forgets the current browser.
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
                                               └─ jobs: runtime releases hourly, OSV daily,
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
  [release schedule](https://github.com/nodejs/Release) for Node.js, the only runtime with release
  checks so far, and the [OSV.dev](https://osv.dev) API for packages. Neither needs an account.

## Configuration

All settings are environment variables; see [`.env.example`](.env.example).

| Variable | Default | |
| --- | --- | --- |
| `APP_URL` | (required) | Public URL; used for links and as passkey RP ID and origin |
| `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD` | (required) | Created or updated on every PocketBase start |
| `WEB_PORT` | `3000` | Host port, from `docker-compose.override.yml` (a plain `docker compose up`) |
| `WEB_BIND` | `127.0.0.1` | Host address that port is published on; see [Client addresses](#client-addresses) |
| `TZ` | `UTC` | Default timezone for the digest |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | | For e-mail notifications |
| `OBSERVATOR_JOBS` | `on` | Background checks |
| `INGEST_MAX_BYTES` | `10485760` | Maximum report size |
| `INGEST_RATE_LIMIT` | `60` | Reports per project per hour |
| `TRUSTED_PROXIES` | `1` | Reverse proxies in front of Observator that add an `X-Forwarded-For` entry; see [Client addresses](#client-addresses) |
| `TRUST_CLOUDFLARE` | `off` | Cloudflare proxies Observator: take the visitor from `CF-Connecting-IP` |
| `REPORTER_IMAGE` | `ghcr.io/enkodonl/observator-reporter:1` | Where the snippet copies the reporter from, such as your own mirror |
| `SOURCE_URL` | this repository | Linked in the footer; point it at your fork if you change the code |
| `SECRETS_KEY` | | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts stored secrets; without it, deploy webhooks and channels with credentials cannot be saved. See [Secrets at rest](#secrets-at-rest) |
| `SECRETS_KEY_PREVIOUS` | | The previous key during a rotation |
| `DEMO_MODE` | `off` | A public read-only demo; see [Demo](#demo) |
| `SETUP_CODE` | `on` | The first account needs the setup code from the web container's log; `off` lets the first visitor of `/setup` create it |
| `OBSERVATOR_SELF` | `on` | Observator reports its own Node.js version and packages as the "Observator" project |

Stale days, reminders and the digest schedule are set in the UI under **Settings → General**.

### Secrets at rest

Deploy webhooks (URL and token) and the credentials of notification channels are stored encrypted,
with AES-256-GCM under `SECRETS_KEY`. Keys, tokens, invites and recovery codes are stored as hashes
already. Without `SECRETS_KEY` such secrets cannot be saved; the reason is shown where you try.

This protects a copy of the database, such as a backup, a volume snapshot or the PocketBase admin
UI, not a compromised web container, which needs the key to use them. So keep the key out of the
backups of `pb_data`. Lose it and the secrets are gone: enter the webhooks and channel credentials
again.

To rotate, move the current key to `SECRETS_KEY_PREVIOUS`, set a new `SECRETS_KEY` and restart: the
start re-encrypts everything under the new key. Remove the previous key after that. Values saved
before encryption existed are encrypted at the first start with a key.

### Client addresses

Rate limits and the per-server split of shared-key projects use the client's address. Observator
expects a reverse proxy in front of it (Coolify's Traefik, Caddy, nginx) and trusts only the
`X-Forwarded-For` entry that proxy added, the last one; earlier entries come from the client and can
say anything. With more proxies in a row, set `TRUSTED_PROXIES` to their number.

That only holds when clients cannot reach Observator past the proxy. `docker-compose.yml` therefore
publishes no port at all: Coolify's proxy reaches the container over the Docker network. A plain
`docker compose up` also loads `docker-compose.override.yml`, which publishes it on `127.0.0.1`
(`WEB_PORT`), for a local install or a proxy outside Docker. A client that talks to
the port directly writes its own `X-Forwarded-For` and passes as any address, IP allowlists included.
Set `WEB_BIND=0.0.0.0` only when a firewall keeps everyone else off the port, for instance so builds
on the same host can reach it through the Docker gateway.

With Cloudflare in front of that proxy, set `TRUST_CLOUDFLARE=on`. When the last hop is a
[Cloudflare address](https://www.cloudflare.com/ips/), Observator then takes the visitor from
`CF-Connecting-IP`. It is off by default because any Cloudflare customer can reach your proxy from a
Cloudflare address and set that header themselves; with it on, let only Cloudflare reach the proxy
(a firewall on Cloudflare's ranges, or authenticated origin pulls).

## Deploying on Coolify

1. Create a resource from this repository with the *Docker Compose* build pack.
2. Give the `web` service a domain (port 3000) and set `APP_URL` to it, with `https://`.
3. Set `PB_SUPERUSER_EMAIL` and a long `PB_SUPERUSER_PASSWORD`, `SECRETS_KEY`
   (`openssl rand -base64 32`), plus SMTP if you want e-mail. Behind Cloudflare, also set
   `TRUST_CLOUDFLARE=on`.
4. Deploy. The PocketBase data lives in the `pb_data` volume.

Coolify uses `docker-compose.yml` only, which publishes no host port, so several Observators (a demo
next to the real one) run side by side on one server without port clashes.

To reach the PocketBase admin UI for debugging, uncomment the `127.0.0.1:8090:8090` port in
`docker-compose.yml` and use an SSH tunnel.

## Demo

`DEMO_MODE=on` turns an install into a public, read-only demo. Visitors are let in without signing in
and see the overview, projects, packages, runtimes and settings, but cannot change anything: every
action that would sends them back with a "not saved" note. Users and accounts are hidden, so no names
or e-mail addresses show. Builds keep reporting and the checks keep running, so the demo stays alive.

You manage the demo by signing in at `/login` as usual: a real account has its normal rights. The
setup code, ingest keys, MCP tokens and badges work as on any install. A second Observator for the
demo runs next to the real one on the same Coolify server (see
[Deploying on Coolify](#deploying-on-coolify)); give it its own `APP_URL`, `SECRETS_KEY` and
superuser password.

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
| `npm test` | Unit tests (Vitest): lockfile parsers with real lockfiles, issue state machine, runtime and OSV logic, the snippet's shell, Node and Python code, notification rendering |
| `npm run lint`, `npm run format:check`, `npm run typecheck` | ESLint, Prettier, TypeScript |
| `cd ../reporter && go vet ./... && go test ./...` | The reporter (Go 1.27; on Linux also HTTPS without a CA bundle) |
| `node --no-warnings scripts/write-examples.ts` | Regenerate the example Dockerfiles from the snippet code |
| `node ../scripts/check-spdx.mjs`, `node ../scripts/check-licenses.mjs` | License headers and dependency licenses |
| `examples/test-snippet.sh` | Build the example apps with the reporter (built from `reporter/`) and the plain sh snippet against a running stack |

CI runs all of these, and starts the compose stack to build the example apps: the reporter on Alpine,
Debian slim, distroless and `python:3.12-slim`, and the plain sh snippet on `node:22-alpine`,
`node:24-alpine`, `node:26-alpine`, `node:22-slim`, `node:22` and `python:3.12-slim`.

**Releasing the reporter:** push a tag `reporter-v1.2.3`. The *Reporter image* workflow tests it and
publishes `ghcr.io/enkodonl/observator-reporter` as `1.2.3`, `1.2`, `1` and `latest` for amd64, arm64
and arm/v7. After the very first release, set the package to *Public* (package settings on GitHub),
so builds can pull it without logging in. Running the workflow by hand builds without publishing.
A change in `reporter/` only reaches builds after a tag. When a release sends something new, also
raise `MIN_REPORTER` in `app/src/lib/ingest/request.ts`, so older reporters get a warning in the build
log instead of dropping it silently.

## Limitations

- Node.js is the only runtime with release and end-of-life checks; other runtimes are shown, not
  checked.
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

The reporter in [`reporter/`](reporter) is [Apache-2.0](reporter/LICENSE), so it can go into any
build pipeline. Components in `app/src/components/ui` come from [shadcn/ui](https://ui.shadcn.com) and
keep their MIT license.
