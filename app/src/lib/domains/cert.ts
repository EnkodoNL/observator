// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { connect } from "node:tls";
import { checkOutbound, OutboundError } from "@/lib/outbound";
import type { CertInfo } from "@/lib/pb/types";

const iso = (date: string | undefined) => (date ? new Date(date).toISOString() : null);

/**
 * The certificate a TLS server presents for `host`, without the outbound guard; checkCert is the
 * one to use. Verification is not enforced, so an invalid certificate can still be read: Node
 * records why it fails (chain, expiry, and the hostname, which it checks even then).
 */
export function readCert(host: string, port = 443, timeoutMs = 10_000): Promise<CertInfo> {
  const base: CertInfo = {
    expiresAt: null,
    validFrom: null,
    issuer: "",
    error: "",
    unreachable: "",
    checkedAt: new Date().toISOString(),
  };
  return new Promise((resolve) => {
    // servername sends SNI: without it a proxy such as Traefik answers with its default certificate.
    const socket = connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    });
    const done = (info: CertInfo) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(info);
    };
    // A hard deadline: the socket timeout only fires on inactivity.
    const timer = setTimeout(
      () => done({ ...base, unreachable: `timed out after ${timeoutMs / 1000}s` }),
      timeoutMs,
    );
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      done({
        ...base,
        expiresAt: iso(cert.valid_to),
        validFrom: iso(cert.valid_from),
        issuer: String(cert.issuer?.O ?? cert.issuer?.CN ?? ""),
        error: socket.authorized ? "" : String(socket.authorizationError ?? "UNVERIFIED"),
      });
    });
    socket.once("error", (err: NodeJS.ErrnoException) =>
      done({ ...base, unreachable: err.code ?? err.message }),
    );
  });
}

/** The certificate of `host` on port 443, after the outbound guard (no loopback, link-local or PocketBase). */
export async function checkCert(host: string): Promise<CertInfo> {
  try {
    await checkOutbound(`https://${host}`);
  } catch (err) {
    if (!(err instanceof OutboundError)) throw err;
    return {
      expiresAt: null,
      validFrom: null,
      issuer: "",
      error: "",
      unreachable: `refused: ${err.message}`,
      checkedAt: new Date().toISOString(),
    };
  }
  return readCert(host);
}
