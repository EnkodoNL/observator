// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// The name and version from package.json per build, for information: which release of the app
// a build was, next to its runtimes and packages.

migrate(
  (app) => {
    const builds = app.findCollectionByNameOrId("builds");
    builds.fields.add(new TextField({ name: "appName", max: 214 }));
    builds.fields.add(new TextField({ name: "appVersion", max: 64 }));
    app.save(builds);
  },
  (app) => {
    const builds = app.findCollectionByNameOrId("builds");
    for (const name of ["appName", "appVersion"]) builds.fields.removeByName(name);
    app.save(builds);
  },
);
