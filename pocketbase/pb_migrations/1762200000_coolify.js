// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// Coolify servers connected in Settings, and per project the Coolify application it is: from the
// build (COOLIFY_RESOURCE_UUID), picked by hand, or Observator's own. The token is stored sealed
// with SECRETS_KEY, like the deploy webhooks.

migrate(
  (app) => {
    const locked = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const servers = new Collection({
      type: "base",
      name: "coolify_servers",
      ...locked,
      fields: [
        { name: "name", type: "text", required: true, max: 100 },
        { name: "url", type: "text", required: true, max: 500 },
        { name: "token", type: "text", max: 4000 },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    });
    app.save(servers);

    const projects = app.findCollectionByNameOrId("projects");
    projects.fields.add(
      new RelationField({ name: "coolifyServer", collectionId: servers.id, cascadeDelete: false, maxSelect: 1 }),
    );
    projects.fields.add(new TextField({ name: "coolifyUuid", max: 64 }));
    // "build", "picked" or "self": where the link came from, for the Setup tab.
    projects.fields.add(new TextField({ name: "coolifySource", max: 16 }));
    app.save(projects);
  },
  (app) => {
    const projects = app.findCollectionByNameOrId("projects");
    for (const name of ["coolifyServer", "coolifyUuid", "coolifySource"]) projects.fields.removeByName(name);
    app.save(projects);
    app.delete(app.findCollectionByNameOrId("coolify_servers"));
  },
);
