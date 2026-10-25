// SPDX-License-Identifier: FSL-1.1-ALv2
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness plus a PocketBase reachability check, used by the compose healthcheck. */
export async function GET() {
  try {
    const res = await fetch(`${env().PB_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`pocketbase ${res.status}`);
    return Response.json({ status: "ok" });
  } catch (err) {
    return Response.json({ status: "degraded", error: String(err) }, { status: 503 });
  }
}
