// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// Atomically replaces the current component set of a project.
// Called by the Observator web process after parsing a new lockfile.
// Body: { project: string, components: [{ name, version, direct, dev, via }] }
routerAdd(
  "POST",
  "/api/observator/components/replace",
  (e) => {
    const body = e.requestInfo().body || {};
    const projectId = String(body.project || "");
    const list = Array.isArray(body.components) ? body.components : null;
    if (!projectId || !list) {
      throw new BadRequestError("project and components are required");
    }

    // Throws a 404 when the project does not exist.
    e.app.findRecordById("projects", projectId);

    let inserted = 0;
    e.app.runInTransaction((txApp) => {
      txApp
        .db()
        .newQuery("DELETE FROM components WHERE project = {:project}")
        .bind({ project: projectId })
        .execute();

      const collection = txApp.findCollectionByNameOrId("components");
      for (const c of list) {
        const record = new Record(collection);
        record.set("project", projectId);
        record.set("name", String(c.name));
        record.set("version", String(c.version));
        record.set("direct", c.direct === true);
        record.set("dev", c.dev === true);
        record.set("via", Array.isArray(c.via) ? c.via.slice(0, 3) : []);
        txApp.save(record);
        inserted++;
      }
    });

    return e.json(200, { inserted: inserted });
  },
  $apis.requireSuperuserAuth(),
);
