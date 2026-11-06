// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// Go: a build can report the modules of its Go programs (lockfile type "go"), and Go module
// paths may be longer than npm's 214 characters.

const NAMES = [
  ["components", "name"],
  ["vulnerabilities", "name"],
  ["ignores", "package"],
  ["builds", "appName"],
];

function setMax(app, max) {
  for (const [collection, field] of NAMES) {
    const c = app.findCollectionByNameOrId(collection);
    c.fields.getByName(field).max = max;
    app.save(c);
  }
}

migrate(
  (app) => {
    const builds = app.findCollectionByNameOrId("builds");
    builds.fields.getByName("lockfileType").values = ["npm", "yarn-v1", "yarn-berry", "pnpm", "go", "none"];
    app.save(builds);
    setMax(app, 512);
  },
  (app) => {
    const builds = app.findCollectionByNameOrId("builds");
    for (const b of app.findAllRecords("builds", $dbx.exp("lockfileType = 'go'"))) {
      b.set("lockfileType", "none");
      app.saveNoValidate(b);
    }
    builds.fields.getByName("lockfileType").values = ["npm", "yarn-v1", "yarn-berry", "pnpm", "none"];
    app.save(builds);
    setMax(app, 214);
  },
);
