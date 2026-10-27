// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import type { IssueRecord, Severity } from "@/lib/pb/types";
import { groupVulns } from "./vuln-groups";

const vuln = (
  pkg: string,
  osvId: string,
  severity: Severity,
  fixedIn: string,
  status = "open",
  version = "1.0.0",
) =>
  ({
    id: osvId,
    kind: "vuln",
    severity,
    status,
    data: { package: pkg, version, osvId, fixedIn },
  }) as unknown as IssueRecord;

describe("groupVulns", () => {
  it("groups per package and picks the upgrade that fixes every open advisory", () => {
    const [qs, ...rest] = groupVulns([
      vuln("qs", "A", "moderate", "6.14.1"),
      vuln("qs", "B", "high", "6.7.3"),
      vuln("qs", "C", "low", "6.16.0", "ignored"),
    ]);
    expect(rest).toEqual([]);
    expect(qs).toMatchObject({ package: "qs", severity: "high", open: 2, unfixed: 0 });
    // 6.14.1 > 6.7.3 numerically; the ignored 6.16.0 does not count.
    expect(qs.fix?.fixedIn).toBe("6.14.1");
    expect(qs.issues.map((i) => i.id)).toEqual(["B", "A", "C"]);
  });

  it("counts advisories without a fix and sorts fully ignored packages last", () => {
    const groups = groupVulns([
      vuln("send", "A", "critical", "", "ignored"),
      vuln("lodash", "B", "moderate", ""),
      vuln("lodash", "C", "moderate", "4.17.21", "open", "4.17.20"),
      vuln("minimist", "D", "high", "1.2.6"),
    ]);
    expect(groups.map((g) => g.package)).toEqual(["minimist", "lodash", "send"]);
    expect(groups[1]).toMatchObject({ unfixed: 1, versions: ["1.0.0", "4.17.20"] });
    expect(groups[2]).toMatchObject({ open: 0, severity: "critical", fix: null });
  });
});
