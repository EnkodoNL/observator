// SPDX-License-Identifier: FSL-1.1-ALv2
// Regenerates examples/express-app/Dockerfile*: node --no-warnings app/scripts/write-examples.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXAMPLE_DOCKERFILES, exampleDockerfile } from "../src/lib/snippet-examples.ts";

const dir = join(import.meta.dirname, "..", "..", "examples", "express-app");
for (const { file, variant, image, note } of EXAMPLE_DOCKERFILES) {
  writeFileSync(join(dir, file), exampleDockerfile(variant, image, note));
  console.log(`wrote examples/express-app/${file}`);
}
