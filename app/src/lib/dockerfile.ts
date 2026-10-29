// SPDX-License-Identifier: FSL-1.1-ALv2
import {
  dockerSnippet,
  sourceDir,
  stageName,
  type LockfileSource,
  type SnippetForm,
  type SnippetOptions,
} from "./snippet";

/**
 * Reads a pasted Dockerfile and works out how to add the snippet: which stage is last and
 * whether it needs a name, whether its base image can run the snippet, and whether package.json and
 * the lockfile are in its working directory or have to come from an earlier stage.
 *
 * It follows FROM chains, WORKDIR and COPY/ADD (also --from, globs and Next.js standalone
 * output). It does not run anything, so .dockerignore and files created by RUN are unknown;
 * the notes say so where it matters. Everything stays in the browser.
 */

export interface DockerfileNote {
  level: "ok" | "info" | "warn";
  text: string;
}

export interface DockerfileLine {
  text: string;
  added: boolean;
}

/** What an earlier snippet in the Dockerfile was set to, so a new one can keep it. */
export interface SnippetSettings {
  form: SnippetForm;
  /** The reporter image, for the image form. */
  image?: string;
  url?: string;
  /** The ARG defaults as written; empty when the build passes them in. */
  key: string;
  failOn: string;
  project: string;
  labels: string;
  domains: string;
  keyless: boolean;
}

export type DockerfileAnalysis =
  | { ok: false; error: string }
  | {
      ok: true;
      stage: string;
      lockfileFrom?: LockfileSource;
      /** The snippet that was there before, when one was replaced. */
      existing?: SnippetSettings;
      notes: DockerfileNote[];
      lines: DockerfileLine[];
    };

const PACKAGE_JSON = "package.json";
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];

/** How a file got into a folder, for the explanation. */
interface Origin {
  line: number;
  how: "explicit" | "context" | "standalone";
}

interface Folder {
  pkg?: Origin;
  lock?: Origin & { name?: string };
}

interface Stage {
  index: number;
  name?: string;
  image: string;
  /** The external image at the end of the FROM chain. */
  base: string;
  line: number;
  /** Physical line of the FROM instruction's last line, where "AS app" would go. */
  fromEnd: number;
  workdir: string;
  folders: Map<string, Folder>;
  observator: boolean;
}

interface Instruction {
  keyword: string;
  args: string;
  /** 1-based physical lines. */
  start: number;
  end: number;
}

/** Joins continuation lines, drops comments and skips heredoc bodies. */
function instructions(text: string): Instruction[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const escape = /^#\s*escape\s*=\s*`/im.test(lines.slice(0, 5).join("\n")) ? "`" : "\\";
  const out: Instruction[] = [];
  let i = 0;
  while (i < lines.length) {
    const first = lines[i].trim();
    if (first === "" || first.startsWith("#")) {
      i++;
      continue;
    }
    const start = i;
    let joined = "";
    for (;;) {
      const line = lines[i];
      const trimmed = line.trim();
      if (i > start && trimmed.startsWith("#")) {
        i++;
        continue;
      }
      if (trimmed.endsWith(escape) && i + 1 < lines.length) {
        joined += trimmed.slice(0, -1) + " ";
        i++;
        continue;
      }
      joined += trimmed;
      break;
    }
    const end = i;
    i++;
    // Heredocs (RUN <<EOF ... EOF): the body is not instructions. Not <<< here-strings, and
    // without a terminator nothing is skipped.
    if (/^(RUN|COPY|ADD)\s/i.test(joined)) {
      for (const m of joined.matchAll(/(?<!<)<<-?\s*["']?([A-Za-z_]\w*)["']?/g)) {
        const close = lines.findIndex((l, j) => j >= i && l.trim() === m[1]);
        if (close >= 0) i = close + 1;
      }
    }
    const m = /^(\S+)\s*(.*)$/.exec(joined);
    if (m) out.push({ keyword: m[1].toUpperCase(), args: m[2], start: start + 1, end: end + 1 });
  }
  return out;
}

/** Splits arguments on whitespace, keeping quoted parts; JSON array form too. */
function tokens(args: string): string[] {
  const trimmed = args.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Not JSON after all; fall through to the shell form.
    }
  }
  return [...trimmed.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return "/" + parts.join("/");
}

const resolve = (dir: string, path: string) => normalize(path.startsWith("/") ? path : `${dir}/${path}`);
const dirname = (path: string) => normalize(path.split("/").slice(0, -1).join("/") || "/");
const basename = (path: string) => path.split("/").filter(Boolean).at(-1) ?? "";

function globMatches(pattern: string, name: string): boolean {
  if (!/[*?[]/.test(pattern)) return pattern === name;
  const source = pattern
    .split("")
    .map((c) => (c === "*" ? "[^/]*" : c === "?" ? "[^/]" : /[.+^${}()|\\]/.test(c) ? `\\${c}` : c))
    .join("");
  return new RegExp(`^${source}$`).test(name);
}

const isContext = (src: string) => [".", "./", "*", "/"].includes(src);

/**
 * Where a COPY puts a source: into the destination folder, or the destination itself is the
 * new file name when a single file is copied to a path without trailing slash.
 */
function target(dest: string, workdir: string, many: boolean, src: string): { dir: string; name?: string } {
  const resolved = resolve(workdir, dest);
  if (dest.endsWith("/") || dest === "." || many) return { dir: resolved };
  const name = basename(resolved);
  // "COPY package.json /app" copies into /app when it is a folder; assume a folder unless the
  // destination is clearly a file with the same kind of name.
  if (name === basename(src) || name.includes(".")) return { dir: dirname(resolved), name };
  return { dir: resolved };
}

function folder(stage: Stage, dir: string): Folder {
  const f = stage.folders.get(dir) ?? {};
  stage.folders.set(dir, f);
  return f;
}

function copy(ins: Instruction, stage: Stage, stages: Stage[]): string | undefined {
  const parts = tokens(ins.args);
  let from: string | undefined;
  const rest: string[] = [];
  for (const p of parts) {
    if (p.startsWith("--from=")) from = p.slice(7);
    else if (!p.startsWith("--")) rest.push(p);
  }
  if (rest.length < 2) return;
  const dest = rest.at(-1)!;
  const sources = rest.slice(0, -1);
  const many = sources.length > 1;

  if (from === undefined) {
    for (const src of sources) {
      if (isContext(src)) {
        const f = folder(stage, resolve(stage.workdir, dest));
        f.pkg = { line: ins.start, how: "context" };
        f.lock = { line: ins.start, how: "context" };
        continue;
      }
      const to = target(dest, stage.workdir, many, src);
      const name = basename(src);
      const f = () => folder(stage, to.dir);
      if (globMatches(name, PACKAGE_JSON)) f().pkg = { line: ins.start, how: "explicit" };
      const lock = LOCKFILES.find((l) => globMatches(name, l));
      // "pnpm-lock.yaml*" may or may not exist; only a plain name says which lockfile it is.
      if (lock) f().lock = { line: ins.start, how: "explicit", name: /[*?[]/.test(name) ? undefined : lock };
    }
    return;
  }

  const source =
    stages.find((s) => s.name === from.toLowerCase()) ?? stages.find((s) => String(s.index) === from);
  if (!source) return;
  let standalone: string | undefined;
  for (const src of sources) {
    const path = normalize(src.startsWith("/") ? src : `/${src}`);
    const into = resolve(stage.workdir, dest);
    if (/\.next\/standalone$/.test(path)) {
      // Next.js always copies package.json into its standalone output, never the lockfile.
      folder(stage, into).pkg = { line: ins.start, how: "standalone" };
      standalone = `line ${ins.start}`;
      continue;
    }
    const name = basename(path);
    const inDir = source.folders.get(dirname(path));
    if (inDir && (globMatches(name, PACKAGE_JSON) || LOCKFILES.some((l) => globMatches(name, l)))) {
      const f = folder(stage, target(dest, stage.workdir, many, src).dir);
      if (inDir.pkg && globMatches(name, PACKAGE_JSON)) f.pkg = { ...inDir.pkg, line: ins.start };
      if (
        inDir.lock &&
        LOCKFILES.some((l) => globMatches(name, l) && (!inDir.lock?.name || l === inDir.lock.name))
      )
        f.lock = { ...inDir.lock, line: ins.start };
      continue;
    }
    // A folder: everything the source stage has in or below it moves along, into the destination.
    for (const [dir, files] of source.folders) {
      if (dir !== path && !dir.startsWith(`${path}/`) && path !== "/") continue;
      const moved = normalize(`${into}/${path === "/" ? dir : dir.slice(path.length)}`);
      const f = folder(stage, moved);
      if (files.pkg) f.pkg = { ...files.pkg, line: ins.start };
      if (files.lock) f.lock = { ...files.lock, line: ins.start };
    }
  }
  return standalone;
}

/**
 * The reporter runs without a shell; the sh snippet picks its own client, so for it only images
 * without a shell are a problem.
 */
function baseNote(base: string, form: SnippetForm): DockerfileNote {
  const image = base.toLowerCase();
  if (form === "image") {
    if (image === "scratch")
      return {
        level: "info",
        text: "The last stage is based on scratch: the reporter runs there, but finds no runtime to report, only package.json and the lockfile if you copy them in.",
      };
    return {
      level: "ok",
      text: `Base image ${base}: the reporter runs on its own, without a shell${/distroless/.test(image) ? " (fine for distroless)" : ""}.`,
    };
  }
  if (/distroless/.test(image) || image === "scratch")
    return {
      level: "warn",
      text: `The last stage is based on ${base}, which has no shell, so the snippet cannot run in it. Report from a stage with the same runtime and a shell (an alpine or slim image) instead.`,
    };
  return {
    level: "ok",
    text: `Base image ${base}: the snippet sends with curl, wget, node or python3, whichever the image has.`,
  };
}

/** An http(s) URL that can stand unquoted in an ARG line; anything else is dropped. */
function plainUrl(value: string | undefined): string | undefined {
  if (!value || !/^https?:\/\/[^\s"'`$\\]+$/.test(value)) return undefined;
  try {
    new URL(value);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Reads the snippet's own instructions (everything from its first stage on): the ARG defaults,
 * the reporter image and whether it reports without a key. Older sh snippets read the same way.
 */
function readSnippet(snippet: Instruction[], stages: Stage[], from: Stage): SnippetSettings {
  const reporter = stages.find((s) => s.index >= from.index && s.name === "observator-reporter");
  const args = new Map<string, string>();
  for (const ins of snippet) {
    if (ins.keyword !== "ARG") continue;
    const m = /^([A-Za-z_]\w*)(?:=(.*))?$/.exec(ins.args.trim());
    if (m) args.set(m[1].toUpperCase(), tokens(m[2] ?? "")[0] ?? "");
  }
  const run = snippet.find((i) => i.keyword === "RUN")?.args ?? "";
  const keyless = reporter
    ? tokens(run).includes("--keyless")
    : // The sh form skips the report without a key through this guard; keyless drops it.
      run.includes("OBSERVATOR_KEY") && !/\[\s*-z\s+"\$key"\s*\]\s*\|\|/.test(run);
  return {
    form: reporter ? "image" : "shell",
    image: reporter?.image,
    url: plainUrl(args.get("OBSERVATOR_URL")),
    key: args.get("OBSERVATOR_KEY") ?? "",
    failOn: args.get("OBSERVATOR_FAIL_ON") ?? "",
    project: args.get("OBSERVATOR_PROJECT") ?? "",
    labels: args.get("OBSERVATOR_LABELS") ?? "",
    domains: args.get("OBSERVATOR_DOMAINS") ?? "",
    keyless,
  };
}

const describe = (o: Origin) =>
  o.how === "context"
    ? `the build context copied on line ${o.line}`
    : o.how === "standalone"
      ? `the Next.js standalone output on line ${o.line}`
      : `line ${o.line}`;

export function analyzeDockerfile(
  text: string,
  url: string,
  options: Pick<
    SnippetOptions,
    "form" | "image" | "keyless" | "key" | "project" | "labels" | "domains" | "failOn"
  > = {},
): DockerfileAnalysis {
  const all = instructions(text);
  const stages: Stage[] = [];
  const standaloneLines = new Map<Stage, string>();

  for (const ins of all) {
    if (ins.keyword === "FROM") {
      const parts = tokens(ins.args).filter((p) => !p.startsWith("--"));
      const image = parts[0] ?? "";
      const name = parts.length >= 3 && parts[1].toUpperCase() === "AS" ? parts[2].toLowerCase() : undefined;
      const parent = stages.find((s) => s.name === image.toLowerCase());
      stages.push({
        index: stages.length,
        name,
        image,
        base: parent?.base ?? image,
        line: ins.start,
        fromEnd: ins.end,
        workdir: parent?.workdir ?? "/",
        folders: new Map([...(parent?.folders ?? [])].map(([dir, f]) => [dir, { ...f }] as [string, Folder])),
        // The snippet's stages: the reporter image (image form) and the report stage.
        observator: name === "observator" || name === "observator-reporter",
      });
      continue;
    }
    const stage = stages.at(-1);
    if (!stage) continue;
    if (ins.keyword === "WORKDIR") stage.workdir = resolve(stage.workdir, tokens(ins.args)[0] ?? "/");
    if (ins.keyword === "COPY" || ins.keyword === "ADD") {
      const standalone = copy(ins, stage, stages);
      if (standalone) standaloneLines.set(stage, standalone);
    }
  }

  if (stages.length === 0) return { ok: false, error: "No FROM line found. Paste the whole Dockerfile." };

  const notes: DockerfileNote[] = [];
  let lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  let app = stages;

  // An earlier snippet: keep what is above it and add the current version.
  const existing = stages.find((s) => s.observator);
  let previous: SnippetSettings | undefined;
  if (existing) {
    // Only the snippet's own shape is replaced: the observator stage, then one stage that copies
    // the marker. Anything else after it would be lost, so that is left to the user.
    const after = stages.filter((s) => s.index > existing.index && !s.observator);
    const tail = after.length === 1 ? all.filter((i) => i.start > after[0].line) : [];
    if (after.length > 1 || tail.some((i) => i.keyword !== "COPY" || !/--from=observator\b/i.test(i.args)))
      return {
        ok: false,
        error:
          "There is an Observator snippet, but not at the bottom of the Dockerfile. Move it there or remove it, then paste again.",
      };
    let from = existing.line - 1;
    for (let i = from - 1; i >= 0 && i >= from - 3; i--) {
      if (/^#\s*---\s*Observator\b/i.test(lines[i].trim())) {
        from = i;
        break;
      }
      if (lines[i].trim() !== "") break;
    }
    previous = readSnippet(
      all.filter((i) => i.start >= existing.line),
      stages,
      existing,
    );
    lines = lines.slice(0, from);
    while (lines.length && lines.at(-1)!.trim() === "") lines.pop();
    app = stages.filter((s) => s.line <= from);
    notes.push({
      level: "info",
      text: "This Dockerfile already reports to Observator; the snippet is replaced with the current one.",
    });
    if (app.length === 0)
      return { ok: false, error: "Only the Observator snippet was found, no stage of your own." };
  }

  const last = app.at(-1)!;
  let stage = last.name;
  // The name goes into new FROM lines as is, so it has to be one Docker accepts and nothing more.
  if (stage && stageName(stage, "") !== stage)
    return {
      ok: false,
      error: `The last stage name "${stage.slice(0, 40)}" is not a valid Docker stage name.`,
    };
  const added = new Set<number>();
  if (stage) {
    notes.push({
      level: "ok",
      text: `Your last stage is ${stage} (line ${last.line}). The snippet uses that name.`,
    });
  } else {
    stage = ["app", "runtime", "final", "observed-app"].find((n) => !stages.some((s) => s.name === n))!;
    const i = last.fromEnd - 1;
    lines[i] = `${lines[i].replace(/\s+$/, "")} AS ${stage}`;
    added.add(i);
    notes.push({
      level: "info",
      text: `Your last stage has no name. Line ${last.fromEnd} gets "AS ${stage}" so the snippet can refer to it.`,
    });
  }

  notes.push(baseNote(last.base, options.form ?? "image"));

  const here = last.folders.get(last.workdir);
  let lockfileFrom: LockfileSource | undefined;
  if (here?.pkg && here.lock) {
    const lockName = here.lock.name ? `${here.lock.name}` : "the lockfile";
    notes.push({
      level: "ok",
      text: `package.json and ${lockName} are in ${last.workdir} of the last stage (${describe(here.lock)}).`,
    });
    if (here.lock.how === "context")
      notes.push({ level: "info", text: "That assumes your lockfile is not listed in .dockerignore." });
  } else {
    // The stage that installs the dependencies: an explicit lockfile COPY beats COPY . .
    const candidates = app
      .filter((s) => s !== last)
      .flatMap((s) => [...s.folders].filter(([, f]) => f.pkg && f.lock).map(([dir, f]) => ({ s, dir, f })))
      .sort(
        (a, b) =>
          Number(a.f.lock!.how !== "explicit") - Number(b.f.lock!.how !== "explicit") ||
          a.s.index - b.s.index,
      );
    const pick = candidates[0];
    const anyPackageJson = app.some((s) => [...s.folders.values()].some((f) => f.pkg));
    const why = here?.pkg
      ? standaloneLines.has(last)
        ? `The last stage has package.json from the Next.js standalone output (${standaloneLines.get(last)}), but no lockfile.`
        : "The last stage has package.json but no lockfile."
      : `The last stage has no package.json in ${last.workdir}.`;
    if (pick) {
      lockfileFrom = {
        stage: pick.s.name && stageName(pick.s.name, "") === pick.s.name ? pick.s.name : String(pick.s.index),
        dir: sourceDir(pick.dir),
      };
      notes.push({
        level: "info",
        text: `${why} The snippet copies both from ${pick.s.name ?? `stage ${pick.s.index}`} (${pick.dir}, ${describe(pick.f.lock!)}).`,
      });
    } else if (!anyPackageJson) {
      // Most likely an app in another language: its runtime is still reported.
      notes.push({
        level: "info",
        text: "No stage has a package.json, so only the runtime versions are reported (npm is the only package manager Observator reads so far).",
      });
    } else {
      notes.push({
        level: "warn",
        text: `${why} No stage copies a lockfile, so only the runtime versions would be checked. COPY your lockfile in one of the stages.`,
      });
    }
  }

  const snippet = dockerSnippet(url, { ...options, stage, lockfileFrom }).split("\n");
  const result: DockerfileLine[] = lines.map((l, i) => ({ text: l, added: added.has(i) }));
  result.push({ text: "", added: true }, ...snippet.map((text) => ({ text, added: true })));
  return { ok: true, stage, lockfileFrom, existing: previous, notes, lines: result };
}
