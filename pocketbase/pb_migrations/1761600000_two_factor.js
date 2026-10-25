// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// Two-factor authentication: a password is never enough on its own. The TOTP secret and the
// recovery code hashes are hidden fields, only readable by the superuser (the web process).

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new TextField({ name: "totpSecret", max: 64, hidden: true }));
    users.fields.add(new DateField({ name: "totpEnabledAt" }));
    // Last accepted 30-second step, so a code cannot be used twice.
    users.fields.add(new NumberField({ name: "totpLastStep", onlyInt: true }));
    users.fields.add(new JSONField({ name: "recoveryCodes", maxSize: 4000, hidden: true }));
    app.save(users);

    // Sessions created before this migration may have been password-only: end them all.
    for (const user of app.findAllRecords("users")) {
      user.refreshTokenKey();
      app.save(user);
    }
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    for (const name of ["totpSecret", "totpEnabledAt", "totpLastStep", "recoveryCodes"]) users.fields.removeByName(name);
    app.save(users);
  },
);
