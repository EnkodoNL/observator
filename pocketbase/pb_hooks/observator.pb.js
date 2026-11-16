// SPDX-License-Identifier: FSL-1.1-ALv2
/// <reference path="../pb_data/types.d.ts" />

// The PocketBase version this container runs, so Observator can check its own PocketBase.
// The JSVM does not expose PocketBase's version; the image sets PB_VERSION from its pin.
// An image without it answers an empty version, and Observator then leaves PocketBase out.
routerAdd(
  "GET",
  "/api/observator/pocketbase",
  (e) => e.json(200, { version: $os.getenv("PB_VERSION") || "" }),
  $apis.requireSuperuserAuth(),
);
