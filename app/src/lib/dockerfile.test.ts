// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { analyzeDockerfile } from "./dockerfile";
import { dockerSnippet } from "./snippet";

const URL = "https://obs.example.com";

function ok(text: string) {
  const a = analyzeDockerfile(text, URL);
  if (!a.ok) throw new Error(a.error);
  return {
    ...a,
    out: a.lines.map((l) => l.text).join("\n"),
    added: a.lines.filter((l) => l.added).map((l) => l.text),
  };
}

// Next.js standalone with pnpm and a worker bundle in the same image.
const NEXT_STANDALONE = `# One image, two processes
FROM node:24-alpine AS base
ENV TZ=Europe/Amsterdam
RUN apk add --no-cache openssl ca-certificates tzdata
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/dist-worker ./dist-worker
EXPOSE 3000
CMD ["node", "server.js"]`;

describe("analyzeDockerfile", () => {
  it("copies the lockfile into a Next.js standalone stage from the install stage", () => {
    const a = ok(NEXT_STANDALONE);
    expect(a.stage).toBe("runner");
    expect(a.lockfileFrom).toEqual({ stage: "deps", dir: "/app" });
    expect(a.notes.map((n) => n.text).join("\n")).toContain("Next.js standalone output (line 21)");
    expect(a.out.startsWith(NEXT_STANDALONE)).toBe(true);
    expect(
      a.out.endsWith(dockerSnippet(URL, { stage: "runner", lockfileFrom: { stage: "deps", dir: "/app" } })),
    ).toBe(true);
  });

  it("names an unnamed last stage and leaves the rest alone", () => {
    const a = ok(`FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["node", "index.js"]
`);
    expect(a.stage).toBe("app");
    expect(a.lockfileFrom).toBeUndefined();
    expect(a.lines[0]).toEqual({ text: "FROM node:22-alpine AS app", added: true });
    expect(a.lines.slice(1, 6).every((l) => !l.added)).toBe(true);
    expect(
      a.notes.some((n) => n.level === "ok" && n.text.includes("package.json and the lockfile are in /app")),
    ).toBe(true);
  });

  it("picks a free name when app is taken by an earlier stage", () => {
    const a = ok(`FROM node:22 AS app
RUN npm ci
FROM node:22-slim
COPY --from=app /package.json /package-lock.json ./`);
    expect(a.stage).toBe("runtime");
    expect(a.lines[2].text).toBe("FROM node:22-slim AS runtime");
  });

  it("names the real base image, following FROM chains", () => {
    const a = ok("FROM node:24-slim AS base\nFROM base AS app\nCOPY . .");
    expect(a.notes.find((n) => n.level === "ok" && n.text.startsWith("Base image"))?.text).toContain(
      "node:24-slim",
    );
  });

  it("warns for images without a shell, but only for the sh snippet", () => {
    const distroless = `FROM node:22 AS build
WORKDIR /app
COPY . .
FROM gcr.io/distroless/nodejs22-debian12 AS app
COPY --from=build /app /app`;
    const shell = analyzeDockerfile(distroless, URL, { form: "shell" });
    if (!shell.ok) throw new Error(shell.error);
    expect(shell.notes.find((n) => n.level === "warn")?.text).toContain("no shell");
    const image = ok(distroless);
    expect(image.notes.some((n) => n.level === "warn")).toBe(false);
    expect(image.notes.map((n) => n.text).join("\n")).toContain("fine for distroless");
  });

  it("switches an earlier snippet between the two forms", () => {
    const v2 = ok(NEXT_STANDALONE).out;
    const toShell = analyzeDockerfile(v2, URL, { form: "shell" });
    if (!toShell.ok) throw new Error(toShell.error);
    const v1 = toShell.lines.map((l) => l.text).join("\n");
    expect(v1).not.toContain("observator-reporter");
    expect(v1.split("# --- Observator")).toHaveLength(2);
    expect(v1.startsWith(NEXT_STANDALONE)).toBe(true);
    // And back: the reporter's own stage goes with the rest of the snippet.
    expect(ok(v1).out).toBe(v2);
  });

  it("follows folders copied between stages", () => {
    const a = ok(`FROM node:22-alpine AS deps
WORKDIR /src
COPY package.json yarn.lock ./
FROM node:22-alpine AS app
WORKDIR /srv
COPY --from=deps /src ./`);
    expect(a.lockfileFrom).toBeUndefined();
    expect(a.notes.some((n) => n.text.includes("yarn.lock are in /srv"))).toBe(true);
  });

  it("refers to an unnamed source stage by index", () => {
    const a = ok(`FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
FROM node:22-alpine AS app
COPY --from=0 /app/node_modules ./node_modules`);
    expect(a.lockfileFrom).toEqual({ stage: "0", dir: "/app" });
  });

  it("does not name a lockfile copied with a glob", () => {
    const a = ok(`FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=deps /app/.next/standalone ./`);
    expect(a.lockfileFrom).toEqual({ stage: "deps", dir: "/app" });
  });

  it("warns when no stage has a lockfile", () => {
    const a = ok(`FROM node:22-alpine AS app
WORKDIR /app
COPY package.json ./
COPY src ./src`);
    expect(a.lockfileFrom).toBeUndefined();
    expect(a.notes.find((n) => n.level === "warn")?.text).toContain(
      "only the runtime versions would be checked",
    );
  });

  it("reports only the runtime for an app without package.json", () => {
    const a = ok(`FROM python:3.12-slim AS app
WORKDIR /app
COPY main.py ./
CMD ["python3", "main.py"]`);
    expect(a.lockfileFrom).toBeUndefined();
    expect(a.notes.some((n) => n.level === "warn")).toBe(false);
    expect(a.notes.map((n) => n.text).join("\n")).toContain("only the runtime versions are reported");
    expect(a.out.endsWith(dockerSnippet(URL))).toBe(true);
  });

  it("replaces an earlier snippet instead of adding a second one", () => {
    const first = ok(NEXT_STANDALONE).out;
    const again = ok(first.replace(URL, "https://old.example.com"));
    expect(again.out).toBe(first);
    expect(again.notes[0].text).toContain("already reports");
  });

  it("refuses to replace a snippet that is not at the bottom", () => {
    const moved = `${ok(NEXT_STANDALONE).out}\nRUN echo after`;
    const a = analyzeDockerfile(moved, URL);
    expect(a.ok).toBe(false);
  });

  it("reads continuation lines, comments inside them and heredocs", () => {
    const a = ok(`FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json \\
  # the lockfile too
  pnpm-lock.yaml ./
RUN <<EOF
FROM not-a-stage
EOF
FROM node:22-alpine AS app
WORKDIR /app
COPY --from=deps /app/package.json /app/pnpm-lock.yaml ./`);
    expect(a.stage).toBe("app");
    expect(a.lockfileFrom).toBeUndefined();
    expect(a.notes.some((n) => n.text.includes("pnpm-lock.yaml are in /app"))).toBe(true);
  });

  it("handles --platform and an AS on the last line of a continued FROM", () => {
    const a = ok("FROM --platform=$BUILDPLATFORM \\\n  node:22-alpine\nCOPY . .");
    expect(a.lines[1].text).toBe("  node:22-alpine AS app");
  });

  it("explains an empty paste", () => {
    expect(analyzeDockerfile("# just a comment\n", URL)).toEqual({
      ok: false,
      error: "No FROM line found. Paste the whole Dockerfile.",
    });
  });
});
