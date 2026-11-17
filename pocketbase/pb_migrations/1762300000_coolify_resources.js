// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// Coolify databases and services as projects: synced from the Coolify API rather than reported
// by a build. coolifyKind says which ("" for an app with the snippet); coolifyGoneAt is set when
// a successful listing no longer has the resource, and cleared when it comes back.
migrate(
  (app) => {
    const projects = app.findCollectionByNameOrId("projects");
    projects.fields.add(new TextField({ name: "coolifyKind", max: 16 }));
    projects.fields.add(new DateField({ name: "coolifyGoneAt" }));
    app.save(projects);
  },
  (app) => {
    const projects = app.findCollectionByNameOrId("projects");
    for (const name of ["coolifyKind", "coolifyGoneAt"]) projects.fields.removeByName(name);
    app.save(projects);
  },
);
