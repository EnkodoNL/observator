// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// Domains to watch for expiry. "domains" are registered domains (enkodo.dev): their registration
// expires. "hosts" are names whose TLS certificate is checked (app.enkodo.dev), each under its
// registered domain and optionally linked to a project. Both keep their own alert phase, so a
// domain needs no project: issues are per project, these are not.

migrate(
  (app) => {
    const locked = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const domains = new Collection({
      type: "base",
      name: "domains",
      ...locked,
      fields: [
        { name: "name", type: "text", required: true, max: 253 },
        // Added by hand, or only there because a host under it is watched (then it goes with them).
        { name: "manual", type: "bool" },
        { name: "note", type: "text", max: 1000 },
        // Days before expiry for a reminder of one's own, such as moving to another registrar.
        { name: "remindDays", type: "number", onlyInt: true, min: 0, max: 3650 },
        // For registries that publish no expiry (.nl, .de): the date from the registrar.
        { name: "manualExpiresAt", type: "date" },
        { name: "registration", type: "json", maxSize: 4000 },
        { name: "alert", type: "json", maxSize: 1000 },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_domains_name ON domains (name)"],
    });
    app.save(domains);

    const projects = app.findCollectionByNameOrId("projects");
    const hosts = new Collection({
      type: "base",
      name: "hosts",
      ...locked,
      fields: [
        { name: "name", type: "text", required: true, max: 253 },
        { name: "domain", type: "relation", collectionId: domains.id, cascadeDelete: true, maxSelect: 1, required: true },
        // Optional: a host without a project is watched on its own.
        { name: "project", type: "relation", collectionId: projects.id, cascadeDelete: false, maxSelect: 1 },
        // Where it came from: manual, build (OBSERVATOR_DOMAINS), coolify.
        { name: "sources", type: "json", maxSize: 200 },
        { name: "cert", type: "json", maxSize: 4000 },
        { name: "alert", type: "json", maxSize: 1000 },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_hosts_name ON hosts (name)",
        "CREATE INDEX idx_hosts_domain ON hosts (domain)",
        "CREATE INDEX idx_hosts_project ON hosts (project)",
      ],
    });
    app.save(hosts);
  },
  (app) => {
    for (const name of ["hosts", "domains"]) app.delete(app.findCollectionByNameOrId(name));
  },
);
