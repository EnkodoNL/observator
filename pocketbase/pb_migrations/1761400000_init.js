// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// Initial Observator schema. Every collection is superuser-only (all API rules null):
// the Next.js server is the only client and enforces authorization itself.

const timestamps = () => [
  { name: "created", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

const locked = {
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

const SEVERITIES = ["unknown", "low", "moderate", "high", "critical"];

migrate(
  (app) => {
    // --- users: no public sign-up, password auth only, 30 day tokens ---
    const users = app.findCollectionByNameOrId("users");
    users.listRule = null;
    users.viewRule = "id = @request.auth.id";
    users.createRule = null;
    users.updateRule = null;
    users.deleteRule = null;
    users.authToken.duration = 30 * 24 * 60 * 60;
    users.passwordAuth.enabled = true;
    users.oauth2.enabled = false;
    users.otp.enabled = false;
    users.mfa.enabled = false;
    app.save(users);

    const passkeys = new Collection({
      type: "base",
      name: "passkeys",
      ...locked,
      fields: [
        { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
        { name: "credentialId", type: "text", required: true, max: 1024 },
        { name: "publicKey", type: "text", required: true, max: 4096 },
        { name: "counter", type: "number", onlyInt: true, min: 0 },
        { name: "transports", type: "json", maxSize: 2000 },
        { name: "deviceType", type: "text", max: 64 },
        { name: "backedUp", type: "bool" },
        { name: "name", type: "text", max: 100 },
        { name: "lastUsed", type: "date" },
        ...timestamps(),
      ],
      indexes: ["CREATE UNIQUE INDEX idx_passkeys_credential ON passkeys (credentialId)"],
    });
    app.save(passkeys);

    const invites = new Collection({
      type: "base",
      name: "invites",
      ...locked,
      fields: [
        { name: "tokenHash", type: "text", required: true, max: 128 },
        { name: "email", type: "email" },
        { name: "createdBy", type: "relation", collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
        { name: "expiresAt", type: "date", required: true },
        { name: "usedAt", type: "date" },
        ...timestamps(),
      ],
      indexes: ["CREATE UNIQUE INDEX idx_invites_token ON invites (tokenHash)"],
    });
    app.save(invites);

    const projects = new Collection({
      type: "base",
      name: "projects",
      ...locked,
      fields: [
        { name: "name", type: "text", required: true, max: 100 },
        { name: "slug", type: "text", required: true, max: 64, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
        { name: "apiKeyHash", type: "text", required: true, max: 128 },
        { name: "apiKeyPrefix", type: "text", max: 32 },
        { name: "badgeToken", type: "text", required: true, max: 128 },
        { name: "deployWebhookUrl", type: "url" },
        { name: "deployWebhookMethod", type: "select", values: ["GET", "POST"], maxSelect: 1 },
        { name: "deployWebhookToken", type: "text", max: 1024, hidden: true },
        { name: "lastBuildAt", type: "date" },
        { name: "vulnsCheckedAt", type: "date" },
        ...timestamps(),
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_projects_slug ON projects (slug)",
        "CREATE UNIQUE INDEX idx_projects_key ON projects (apiKeyHash)",
        "CREATE UNIQUE INDEX idx_projects_badge ON projects (badgeToken)",
      ],
    });
    app.save(projects);

    const builds = new Collection({
      type: "base",
      name: "builds",
      ...locked,
      fields: [
        { name: "project", type: "relation", required: true, collectionId: projects.id, cascadeDelete: true, maxSelect: 1 },
        { name: "nodeVersion", type: "text", required: true, max: 32 },
        { name: "platform", type: "text", max: 32 },
        { name: "arch", type: "text", max: 32 },
        { name: "os", type: "text", max: 32 },
        { name: "lockfileType", type: "select", values: ["npm", "yarn-v1", "yarn-berry", "pnpm", "none"], maxSelect: 1 },
        { name: "lockfileHash", type: "text", max: 128 },
        { name: "packageCount", type: "number", onlyInt: true, min: 0 },
        { name: "changes", type: "json", maxSize: 2 * 1024 * 1024 },
        { name: "error", type: "text", max: 2000 },
        ...timestamps(),
      ],
      indexes: ["CREATE INDEX idx_builds_project ON builds (project, created)"],
    });
    app.save(builds);

    const components = new Collection({
      type: "base",
      name: "components",
      ...locked,
      fields: [
        { name: "project", type: "relation", required: true, collectionId: projects.id, cascadeDelete: true, maxSelect: 1 },
        { name: "name", type: "text", required: true, max: 214 },
        { name: "version", type: "text", required: true, max: 256 },
        { name: "direct", type: "bool" },
        { name: "dev", type: "bool" },
        { name: "via", type: "json", maxSize: 2000 },
        ...timestamps(),
      ],
      indexes: [
        "CREATE INDEX idx_components_project ON components (project)",
        "CREATE INDEX idx_components_name ON components (name)",
        "CREATE INDEX idx_components_name_version ON components (name, version)",
      ],
    });
    app.save(components);

    const vulnerabilities = new Collection({
      type: "base",
      name: "vulnerabilities",
      ...locked,
      fields: [
        { name: "name", type: "text", required: true, max: 214 },
        { name: "version", type: "text", required: true, max: 256 },
        { name: "ecosystem", type: "text", required: true, max: 32 },
        { name: "osvId", type: "text", required: true, max: 128 },
        { name: "aliases", type: "json", maxSize: 10000 },
        { name: "severity", type: "select", values: SEVERITIES, maxSelect: 1 },
        { name: "summary", type: "text", max: 2000 },
        { name: "fixedIn", type: "text", max: 256 },
        { name: "url", type: "url" },
        { name: "modified", type: "date" },
        { name: "checkedAt", type: "date" },
        ...timestamps(),
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_vulns_unique ON vulnerabilities (ecosystem, name, version, osvId)",
        "CREATE INDEX idx_vulns_osv ON vulnerabilities (osvId)",
      ],
    });
    app.save(vulnerabilities);

    const ignores = new Collection({
      type: "base",
      name: "ignores",
      ...locked,
      fields: [
        { name: "project", type: "relation", collectionId: projects.id, cascadeDelete: true, maxSelect: 1 },
        { name: "osvId", type: "text", max: 128 },
        { name: "package", type: "text", max: 214 },
        { name: "reason", type: "text", required: true, max: 1000 },
        { name: "expiresAt", type: "date" },
        { name: "createdBy", type: "relation", collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
        ...timestamps(),
      ],
    });
    app.save(ignores);

    const issues = new Collection({
      type: "base",
      name: "issues",
      ...locked,
      fields: [
        { name: "project", type: "relation", required: true, collectionId: projects.id, cascadeDelete: true, maxSelect: 1 },
        { name: "kind", type: "select", required: true, values: ["node_security", "node_eol", "vuln", "stale"], maxSelect: 1 },
        { name: "key", type: "text", required: true, max: 512 },
        { name: "revision", type: "text", max: 256 },
        { name: "severity", type: "select", values: SEVERITIES, maxSelect: 1 },
        { name: "title", type: "text", max: 500 },
        { name: "data", type: "json", maxSize: 20000 },
        { name: "status", type: "select", required: true, values: ["open", "ignored", "resolved"], maxSelect: 1 },
        { name: "firstSeen", type: "date" },
        { name: "lastSeen", type: "date" },
        { name: "resolvedAt", type: "date" },
        { name: "notifiedAt", type: "date" },
        ...timestamps(),
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_issues_key ON issues (project, key)",
        "CREATE INDEX idx_issues_status ON issues (status)",
      ],
    });
    app.save(issues);

    const channels = new Collection({
      type: "base",
      name: "channels",
      ...locked,
      fields: [
        {
          name: "type",
          type: "select",
          required: true,
          values: ["slack", "telegram", "discord", "email", "ntfy", "gotify", "pushover", "apprise", "webhook"],
          maxSelect: 1,
        },
        { name: "name", type: "text", required: true, max: 100 },
        { name: "config", type: "json", maxSize: 20000, hidden: true },
        { name: "enabled", type: "bool" },
        { name: "minSeverity", type: "select", values: SEVERITIES, maxSelect: 1 },
        { name: "events", type: "json", maxSize: 2000 },
        { name: "projects", type: "relation", collectionId: projects.id, cascadeDelete: false, maxSelect: 999 },
        ...timestamps(),
      ],
    });
    app.save(channels);

    const notifications = new Collection({
      type: "base",
      name: "notifications",
      ...locked,
      fields: [
        { name: "channel", type: "relation", required: true, collectionId: channels.id, cascadeDelete: true, maxSelect: 1 },
        { name: "event", type: "text", required: true, max: 64 },
        { name: "dedupeKey", type: "text", required: true, max: 256 },
        { name: "payload", type: "json", maxSize: 200000 },
        { name: "status", type: "select", required: true, values: ["pending", "sent", "failed"], maxSelect: 1 },
        { name: "attempts", type: "number", onlyInt: true, min: 0 },
        { name: "nextAttemptAt", type: "date" },
        { name: "error", type: "text", max: 2000 },
        { name: "sentAt", type: "date" },
        ...timestamps(),
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications (channel, dedupeKey)",
        "CREATE INDEX idx_notifications_queue ON notifications (status, nextAttemptAt)",
      ],
    });
    app.save(notifications);

    const kv = new Collection({
      type: "base",
      name: "kv",
      ...locked,
      fields: [
        { name: "key", type: "text", required: true, max: 256 },
        { name: "value", type: "json", maxSize: 5 * 1024 * 1024 },
        { name: "expiresAt", type: "date" },
        ...timestamps(),
      ],
      indexes: ["CREATE UNIQUE INDEX idx_kv_key ON kv (key)"],
    });
    app.save(kv);

    const settings = app.settings();
    settings.meta.appName = "Observator";
    settings.meta.hideControls = false;
    app.save(settings);
  },
  (app) => {
    for (const name of [
      "kv",
      "notifications",
      "channels",
      "issues",
      "ignores",
      "vulnerabilities",
      "components",
      "builds",
      "projects",
      "invites",
      "passkeys",
    ]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        // already gone
      }
    }
  },
);
