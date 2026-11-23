// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// The hourly Coolify sync compared its stored reading with a fresh one as JSON, and PocketBase
// hands JSON back with its keys sorted: every database and service got an identical build each
// hour. Per such project, a build that runs exactly what the build before it ran goes; the first
// of each run stays, so every real change keeps its build. Builds of apps (reported by their
// Dockerfile) are left alone: each of those is a build that happened. Nothing refers to a build.

/** A JSON field's value with its keys sorted, as text, so the same content compares equal. */
function canonical(record, field) {
  const text = record.getString(field);
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (!v || typeof v !== "object") return v;
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
    return out;
  };
  return JSON.stringify(sort(text ? JSON.parse(text) : null));
}

/** What a build says runs: the same signature means nothing changed. */
function signature(build) {
  return JSON.stringify([
    canonical(build, "runtimes"),
    ...["lockfileType", "lockfileHash", "appName", "appVersion", "os", "platform", "arch", "error"].map(
      (f) => build.getString(f),
    ),
    build.getInt("packageCount"),
  ]);
}

migrate(
  (app) => {
    let removed = 0;
    for (const project of app.findAllRecords("projects", $dbx.exp("coolifyKind != ''"))) {
      const builds = app.findRecordsByFilter("builds", "project = {:id}", "created,id", 0, 0, {
        id: project.id,
      });
      let previous = null;
      let kept = null;
      for (const build of builds) {
        const sig = signature(build);
        if (sig === previous) {
          app.delete(build);
          removed++;
          continue;
        }
        previous = sig;
        kept = build;
      }
      // "Changed 3 h ago" again means the last change, not the last sync.
      if (kept && project.getString("lastBuildAt") !== kept.getString("created")) {
        project.set("lastBuildAt", kept.getString("created"));
        app.saveNoValidate(project);
      }
    }
    if (removed) console.log(`removed ${removed} identical builds of Coolify databases and services`);
  },
  () => {
    // The removed builds were copies of the build before them; there is nothing to bring back.
  },
);
