// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { applicationDomains, coolifyTarget, serviceDomains } from "./coolify";

describe("coolifyTarget", () => {
  it("reads the server and resource from a deploy webhook", () => {
    expect(coolifyTarget("https://coolify.example.com/api/v1/deploy?uuid=ab12cd34ef56&force=false")).toEqual({
      base: "https://coolify.example.com",
      uuid: "ab12cd34ef56",
    });
    expect(coolifyTarget("https://example.com/coolify/api/v1/deploy/?uuid=ab12cd34ef56,zz99zz99")).toEqual({
      base: "https://example.com/coolify",
      uuid: "ab12cd34ef56",
    });
  });

  it("is null for anything else", () => {
    expect(coolifyTarget("https://dokploy.example.com/api/deploy/abc")).toBeNull();
    expect(coolifyTarget("https://coolify.example.com/api/v1/deploy")).toBeNull();
    expect(coolifyTarget("not a url")).toBeNull();
  });
});

describe("domains from Coolify", () => {
  it("takes fqdn and the per-service domains of a compose application", () => {
    expect(
      applicationDomains({
        fqdn: "https://a.example.com, https://b.example.com:8443",
        docker_compose_domains: JSON.stringify({
          web: { domain: "https://c.example.com" },
          worker: { domain: "" },
        }),
      }),
    ).toEqual(["https://a.example.com", "https://b.example.com:8443", "https://c.example.com"]);
    expect(applicationDomains({ fqdn: null, docker_compose_domains: "not json" })).toEqual([]);
  });

  it("takes each application of a service", () => {
    expect(serviceDomains({ applications: [{ fqdn: "https://x.example.com" }, { fqdn: null }] })).toEqual([
      "https://x.example.com",
    ]);
  });
});
