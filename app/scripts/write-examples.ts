// SPDX-License-Identifier: FSL-1.1-ALv2
// Regenerates the Dockerfiles in examples/: node --no-warnings app/scripts/write-examples.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EXAMPLE_DOCKERFILES } from "../src/lib/snippet-examples.ts";

const root = join(import.meta.dirname, "..", "..", "examples");
for (const { path, content } of EXAMPLE_DOCKERFILES) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content());
  console.log(`wrote examples/${path}`);
}
