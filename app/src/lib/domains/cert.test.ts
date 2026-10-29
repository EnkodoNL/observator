// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCert } from "./cert";

// A self-signed certificate for example.test, made with openssl; skipped where openssl is missing.
let openssl = true;
try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
  openssl = false;
}

describe.skipIf(!openssl)("readCert", () => {
  let dir: string;
  let server: ReturnType<typeof createTlsServer>;
  let port = 0;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "obs-cert-"));
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-days",
        "30",
        "-subj",
        "/CN=example.test",
        "-addext",
        "subjectAltName=DNS:example.test",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    server = createTlsServer(
      { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) },
      (s) => s.end(),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reads the dates and says why it is not trusted", async () => {
    const info = await readCert("127.0.0.1", port, 5000);
    expect(info.unreachable).toBe("");
    expect(info.error).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    const days = (new Date(info.expiresAt!).getTime() - new Date(info.validFrom!).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it("reports an unreachable host without a verdict", async () => {
    const closed: Server = createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const freePort = (closed.address() as { port: number }).port;
    await new Promise((r) => closed.close(r));
    const info = await readCert("127.0.0.1", freePort, 5000);
    expect(info.unreachable).toBe("ECONNREFUSED");
    expect(info.expiresAt).toBeNull();
  });
});
