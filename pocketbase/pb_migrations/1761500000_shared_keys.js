// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// Shared (write-only) ingest keys: one key for many apps. A report names its project, which
// is created on first use and stays linked to the key that created it. With splitByIp, the
// same name reported from different source IPs (load-balanced replicas, each building its own
// image) becomes one project per server, so a replica that lags behind is visible.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const keys = new Collection({
      type: "base",
      name: "ingest_keys",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "name", type: "text", required: true, max: 100 },
        { name: "keyHash", type: "text", required: true, max: 128 },
        { name: "keyPrefix", type: "text", max: 32 },
        { name: "splitByIp", type: "bool" },
        { name: "createdBy", type: "relation", collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
        { name: "lastUsedAt", type: "date" },
        { name: "lastUsedIp", type: "text", max: 64 },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_ingest_keys_hash ON ingest_keys (keyHash)"],
    });
    app.save(keys);

    const projects = app.findCollectionByNameOrId("projects");
    projects.fields.add(
      new RelationField({ name: "ingestKey", collectionId: keys.id, cascadeDelete: false, maxSelect: 1 }),
    );
    // The name as reported (OBSERVATOR_PROJECT or package.json), and the source IP when the
    // key splits by IP. Together with ingestKey they identify an auto-created project.
    projects.fields.add(new TextField({ name: "sourceName", max: 100 }));
    projects.fields.add(new TextField({ name: "instance", max: 64 }));
    projects.addIndex(
      "idx_projects_source",
      true,
      "ingestKey, sourceName, instance",
      "ingestKey != ''",
    );
    app.save(projects);

    const builds = app.findCollectionByNameOrId("builds");
    builds.fields.add(new TextField({ name: "sourceIp", max: 64 }));
    app.save(builds);
  },
  (app) => {
    const projects = app.findCollectionByNameOrId("projects");
    projects.removeIndex("idx_projects_source");
    for (const name of ["ingestKey", "sourceName", "instance"]) projects.fields.removeByName(name);
    app.save(projects);
    const builds = app.findCollectionByNameOrId("builds");
    builds.fields.removeByName("sourceIp");
    app.save(builds);
    app.delete(app.findCollectionByNameOrId("ingest_keys"));
  },
);
