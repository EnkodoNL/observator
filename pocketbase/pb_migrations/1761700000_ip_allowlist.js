// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// IP allowlists on shared keys: builds from these addresses may report without a key and count
// as that key. Normalized CIDRs, such as "198.51.100.4/32".

migrate(
  (app) => {
    const keys = app.findCollectionByNameOrId("ingest_keys");
    keys.fields.add(new JSONField({ name: "allowedIps", maxSize: 4000 }));
    app.save(keys);
  },
  (app) => {
    const keys = app.findCollectionByNameOrId("ingest_keys");
    keys.fields.removeByName("allowedIps");
    app.save(keys);
  },
);
