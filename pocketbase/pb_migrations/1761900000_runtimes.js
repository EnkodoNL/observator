// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// Runtime-agnostic: a build reports its runtimes ([{name, version}], from X-Runtime) instead of a
// Node version, runtime issues are keyed per runtime ("runtime_security:node:22"), and packages
// carry their ecosystem. Existing data is converted in place, so nothing is notified again.

const ARCH = { x64: "amd64", x86_64: "amd64", aarch64: "arm64", ia32: "386" };

/**
 * A JSON field as a plain value. record.get() returns raw bytes in the JSVM (JSON.stringify of
 * those yields {"0":123,...}); getString() returns the JSON text.
 */
function json(record, field) {
  const text = record.getString(field);
  return text ? JSON.parse(text) : null;
}

migrate(
  (app) => {
    // builds: nodeVersion → runtimes; changes.node → changes.runtimes; arch in Docker's names.
    const builds = app.findCollectionByNameOrId("builds");
    builds.fields.add(new JSONField({ name: "runtimes", maxSize: 4000 }));
    app.save(builds);
    for (const b of app.findAllRecords("builds")) {
      const version = b.getString("nodeVersion");
      b.set("runtimes", version ? [{ name: "node", version: version }] : []);
      const changes = json(b, "changes");
      if (changes && changes.node) {
        changes.runtimes = [{ name: "node", from: changes.node.from, to: changes.node.to }];
        delete changes.node;
        b.set("changes", changes);
      }
      const arch = b.getString("arch");
      if (ARCH[arch]) b.set("arch", ARCH[arch]);
      app.saveNoValidate(b);
    }
    builds.fields.removeByName("nodeVersion");
    app.save(builds);

    // issues: node_security / node_eol → runtime_security / runtime_eol, same status and revision.
    const issues = app.findCollectionByNameOrId("issues");
    const kind = issues.fields.getByName("kind");
    kind.values = ["node_security", "node_eol", "runtime_security", "runtime_eol", "vuln", "stale"];
    app.save(issues);
    for (const i of app.findAllRecords("issues")) {
      const old = i.getString("kind");
      if (old !== "node_security" && old !== "node_eol") continue;
      const data = json(i, "data") || {};
      const line = String(data.major ?? i.getString("key").split(":")[1] ?? "");
      const next = old === "node_security" ? "runtime_security" : "runtime_eol";
      delete data.major;
      i.set("kind", next);
      i.set("key", `${next}:node:${line}`);
      i.set("data", Object.assign({ runtime: "node", line: line }, data));
      app.saveNoValidate(i);
    }
    kind.values = ["runtime_security", "runtime_eol", "vuln", "stale"];
    app.save(issues);

    // channels: subscribed event names. An unknown name would make the channel get everything.
    const rename = { "node.security_update": "runtime.security_update", "node.eol": "runtime.eol" };
    for (const c of app.findAllRecords("channels")) {
      const events = json(c, "events");
      if (!Array.isArray(events) || !events.some((e) => rename[e])) continue;
      c.set("events", events.map((e) => rename[e] || e));
      app.saveNoValidate(c);
    }

    // components: the package ecosystem, npm for everything so far.
    const components = app.findCollectionByNameOrId("components");
    components.fields.add(new TextField({ name: "ecosystem", max: 32 }));
    components.addIndex("idx_components_ecosystem_name", false, "ecosystem, name", "");
    app.save(components);
    app.db().newQuery("UPDATE components SET ecosystem = 'npm' WHERE ecosystem = '' OR ecosystem IS NULL").execute();
  },
  (app) => {
    const builds = app.findCollectionByNameOrId("builds");
    builds.fields.add(new TextField({ name: "nodeVersion", max: 32 }));
    app.save(builds);
    for (const b of app.findAllRecords("builds")) {
      const node = (json(b, "runtimes") || []).find((r) => r.name === "node");
      b.set("nodeVersion", node ? node.version : "");
      app.saveNoValidate(b);
    }
    builds.fields.removeByName("runtimes");
    app.save(builds);

    const issues = app.findCollectionByNameOrId("issues");
    const kind = issues.fields.getByName("kind");
    kind.values = ["node_security", "node_eol", "runtime_security", "runtime_eol", "vuln", "stale"];
    app.save(issues);
    for (const i of app.findAllRecords("issues")) {
      const k = i.getString("kind");
      if (k !== "runtime_security" && k !== "runtime_eol") continue;
      const data = json(i, "data") || {};
      const prev = k === "runtime_security" ? "node_security" : "node_eol";
      i.set("kind", prev);
      i.set("key", `${prev}:${data.line}`);
      i.set("data", Object.assign({ major: Number(data.line) }, data));
      app.saveNoValidate(i);
    }
    kind.values = ["node_security", "node_eol", "vuln", "stale"];
    app.save(issues);

    const components = app.findCollectionByNameOrId("components");
    components.removeIndex("idx_components_ecosystem_name");
    components.fields.removeByName("ecosystem");
    app.save(components);
  },
);
