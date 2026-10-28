// SPDX-License-Identifier: FSL-1.1-ALv2
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Server actions that only look things up; the read-only demo may call them. */
const READ_ONLY = new Set(["searchPackageNamesAction"]);

function actionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return actionFiles(path);
    return /\.tsx?$/.test(e.name) && readFileSync(path, "utf8").includes('"use server"') ? [path] : [];
  });
}

/** Each exported action with its body, up to the next export. */
function actions(path: string): [string, string][] {
  const src = readFileSync(path, "utf8");
  const parts = src.split(/^export async function /m).slice(1);
  return parts.map((part) => [part.slice(0, part.indexOf("(")), part.split(/^export /m)[0]]);
}

// The demo session may look at everything (requireUser), but every action that changes something
// must refuse it, which requireWriter does. A new action without it fails here.
describe("(app) server actions", () => {
  const all = actionFiles(__dirname).flatMap((f) =>
    actions(f).map(([name, body]) => [`${f.slice(__dirname.length + 1)} ${name}`, name, body] as const),
  );

  it.each(all)("%s checks the caller", (_label, name, body) => {
    if (READ_ONLY.has(name)) expect(body).toMatch(/await requireUser\(\)/);
    else expect(body).toMatch(/await requireWriter\(\)|await ownPasskey\(/);
  });
});
