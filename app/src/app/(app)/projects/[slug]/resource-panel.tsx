// SPDX-License-Identifier: FSL-1.1-ALv2
import type { ResourceInventory } from "@/lib/coolify/inventory";
import { runtimeLabel } from "@/lib/runtimes/labels";
import { formatDate, timeAgo } from "@/lib/time";

/** Advisories to check by hand, linked to the repository's own pages; nothing when there are none. */
function CheckByHand({
  source,
  ids,
  children,
}: {
  source: string;
  ids: string[];
  children: React.ReactNode;
}) {
  if (ids.length === 0) return null;
  return (
    <span className="block text-warn">
      {children}{" "}
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && ", "}
          <a
            href={`https://github.com/${source}/security/advisories/${id}`}
            className="font-mono underline-offset-4 hover:underline"
            rel="noreferrer"
          >
            {id}
          </a>
        </span>
      ))}
    </span>
  );
}

/**
 * Where a Coolify database or service comes from and what its images are: the tag, whether it is
 * pinned, the version behind a moving tag right now, the runtimes inside and the source repo.
 */
export function ResourcePanel({
  inventory,
  goneAt,
}: {
  inventory: ResourceInventory | null;
  goneAt: Date | null;
}) {
  if (!inventory) {
    return (
      <p className="text-sm text-muted-foreground">
        Not synced yet. Observator reads Coolify&rsquo;s databases and services every hour, or now with{" "}
        <em>Run checks</em> on the overview.
      </p>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        A Coolify {inventory.kind}
        {inventory.type ? ` (${inventory.type})` : ""} on {inventory.server}, read from Coolify&rsquo;s API
        every hour, last {timeAgo(new Date(inventory.syncedAt))}. Nothing reports from inside it: its images
        are read from their registry. A moving tag shows what it points to now; what runs can be older until
        Coolify pulls it again (a database restart does, a service only with <em>Pull latest</em>).
      </p>
      {goneAt && (
        <p className="text-warn">
          Gone from Coolify since {formatDate(goneAt)}. Its issues are closed; delete the project from the
          menu at the top right when you no longer need it.
        </p>
      )}
      {inventory.error && <p className="text-warn">Its parts could not be listed: {inventory.error}</p>}
      {inventory.images.length === 0 ? (
        <p className="text-muted-foreground">No images.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {inventory.images.map((image) => (
            <li key={`${image.part}/${image.ref}`} className="space-y-1 px-3 py-2">
              <p className="flex flex-wrap items-baseline gap-x-2">
                {image.part && <span className="text-muted-foreground">{image.part}</span>}
                <code className="font-mono break-all">{image.ref}</code>
                <span className="text-xs text-muted-foreground">
                  {image.pinned
                    ? "pinned"
                    : image.versionNow
                      ? `moving tag, now ${image.versionNow}`
                      : "moving tag"}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {[
                  image.product && image.version && `${runtimeLabel(image.product)} ${image.version}`,
                  ...image.runtimes.map((r) => `${runtimeLabel(r.name)} ${r.version} inside`),
                  image.source && `source github.com/${image.source}`,
                  image.error && `registry: ${image.error}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Nothing Observator recognizes in this image yet."}
              </p>
            </li>
          ))}
        </ul>
      )}
      {inventory.apps && inventory.apps.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-medium">Apps, by their repository</h3>
          <ul className="space-y-1 text-muted-foreground">
            {inventory.apps.map((app) => (
              <li key={`${app.part}/${app.source}`}>
                <a
                  href={`https://github.com/${app.source}`}
                  className="text-foreground underline-offset-4 hover:underline"
                  rel="noreferrer"
                >
                  {app.source}
                </a>
                {": "}
                {app.version
                  ? `${app.version}${app.assumed ? " (assumed: the newest release in the tag's line)" : ""}`
                  : "version unknown"}
                {app.latest && app.latest !== app.version && `, newest release ${app.latest}`}
                {app.error && <span className="text-warn"> GitHub: {app.error}</span>}
                <CheckByHand source={app.source} ids={app.unclear}>
                  {app.unclear.length === 1 ? "An advisory names" : `${app.unclear.length} advisories name`}{" "}
                  its versions in words Observator cannot read; check by hand:
                </CheckByHand>
                <CheckByHand source={app.source} ids={app.contradicts ?? []}>
                  {(app.contradicts ?? []).length === 1
                    ? "An advisory contradicts itself"
                    : `${(app.contradicts ?? []).length} advisories contradict themselves`}
                  : the affected range includes this version, the patched versions too. Observator follows the
                  patched versions; check by hand:
                </CheckByHand>
              </li>
            ))}
          </ul>
        </div>
      )}
      {inventory.scan !== undefined && (
        <p className="text-muted-foreground">
          Coolify&rsquo;s image scan:{" "}
          {inventory.scan === null
            ? "none yet."
            : inventory.scan.error
              ? `could not be read this time (${inventory.scan.error}); the last findings stay.`
              : inventory.scan.off
                ? `none: ${inventory.scan.off}. Turn it on there for advisories on the packages in what runs.`
                : `${inventory.scan.fixable} ${inventory.scan.fixable === 1 ? "finding" : "findings"} with a fix, listed as advisories on the overview; ${inventory.scan.unfixable} without one yet, counted only.${inventory.scan.scannedAt ? ` Scanned ${timeAgo(new Date(inventory.scan.scannedAt))}.` : ""}`}
        </p>
      )}
    </div>
  );
}
