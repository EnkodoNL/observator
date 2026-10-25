// SPDX-License-Identifier: FSL-1.1-ALv2
//
// Creates a project with a fresh API key and a shared key in a running stack, and prints
// "<project key> <shared key>".
// Runs inside the web container, which can reach PocketBase:
//   docker compose exec -T web node --input-type=module - < scripts/e2e-seed.mjs
import { createHash, randomBytes } from "node:crypto";

const pb = process.env.PB_URL ?? "http://pocketbase:8090";
const auth = await fetch(`${pb}/api/collections/_superusers/auth-with-password`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ identity: process.env.PB_SUPERUSER_EMAIL, password: process.env.PB_SUPERUSER_PASSWORD }),
}).then((r) => r.json());
if (!auth.token) throw new Error(`superuser login failed: ${JSON.stringify(auth)}`);

const key = `obs_${randomBytes(32).toString("base64url")}`;
const slug = `e2e-${randomBytes(3).toString("hex")}`;
const res = await fetch(`${pb}/api/collections/projects/records`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: auth.token },
  body: JSON.stringify({
    name: `E2E ${slug}`,
    slug,
    apiKeyHash: createHash("sha256").update(key).digest("hex"),
    apiKeyPrefix: key.slice(0, 12),
    badgeToken: randomBytes(18).toString("base64url"),
  }),
});
if (!res.ok) throw new Error(`project creation failed: ${res.status} ${await res.text()}`);

const shared = `obss_${randomBytes(32).toString("base64url")}`;
const sharedRes = await fetch(`${pb}/api/collections/ingest_keys/records`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: auth.token },
  body: JSON.stringify({
    name: `E2E ${slug}`,
    keyHash: createHash("sha256").update(shared).digest("hex"),
    keyPrefix: shared.slice(0, 13),
    splitByIp: true,
  }),
});
if (!sharedRes.ok) throw new Error(`shared key creation failed: ${sharedRes.status} ${await sharedRes.text()}`);
console.log(`${key} ${shared}`);
