// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// Labels on projects, for grouping and filtering: "labels" are kept by hand (UI, MCP),
// "buildLabels" follow the latest report (OBSERVATOR_LABELS). And personal MCP tokens: a
// bearer token per user for the /api/mcp endpoint, stored as a hash like the API keys.

migrate(
  (app) => {
    const projects = app.findCollectionByNameOrId("projects");
    projects.fields.add(new JSONField({ name: "labels", maxSize: 4000 }));
    projects.fields.add(new JSONField({ name: "buildLabels", maxSize: 4000 }));
    app.save(projects);

    const users = app.findCollectionByNameOrId("users");
    const tokens = new Collection({
      type: "base",
      name: "mcp_tokens",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        // Removing a user removes their tokens: they stop working immediately.
        { name: "user", type: "relation", collectionId: users.id, cascadeDelete: true, maxSelect: 1, required: true },
        { name: "name", type: "text", required: true, max: 100 },
        { name: "tokenHash", type: "text", required: true, max: 128 },
        { name: "tokenPrefix", type: "text", max: 32 },
        { name: "canWrite", type: "bool" },
        { name: "lastUsedAt", type: "date" },
        { name: "lastUsedIp", type: "text", max: 64 },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_mcp_tokens_hash ON mcp_tokens (tokenHash)",
        "CREATE INDEX idx_mcp_tokens_user ON mcp_tokens (user)",
      ],
    });
    app.save(tokens);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("mcp_tokens"));
    const projects = app.findCollectionByNameOrId("projects");
    for (const name of ["labels", "buildLabels"]) projects.fields.removeByName(name);
    app.save(projects);
  },
);
