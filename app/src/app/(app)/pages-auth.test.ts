// SPDX-License-Identifier: FSL-1.1-ALv2
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every page.tsx under this directory. */
function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? pages(join(dir, e.name)) : e.name === "page.tsx" ? [join(dir, e.name)] : [],
  );
}

// The (app) layout checks the session too, but Next can skip a layout the client says it already
// has (the router state header), so a page must not rely on it: each one checks for itself.
describe("(app) pages", () => {
  it.each(pages(__dirname).map((p) => [p.slice(__dirname.length + 1), p]))(
    "%s calls requireUser()",
    (_name, path) => {
      expect(readFileSync(path, "utf8")).toMatch(/await requireUser\(\)/);
    },
  );
});
