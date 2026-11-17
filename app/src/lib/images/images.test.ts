// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { describeImage, versionIn } from "./describe";
import { parseImageRef } from "./reference";
import { parseChallenge } from "./registry";

describe("parseImageRef", () => {
  it("takes apart Docker Hub, GHCR and other registries", () => {
    expect(parseImageRef("mariadb:11")).toMatchObject({
      registry: "registry-1.docker.io",
      repository: "library/mariadb",
      tag: "11",
      name: "mariadb",
    });
    expect(parseImageRef("bitnami/postgresql")).toMatchObject({
      repository: "bitnami/postgresql",
      tag: "latest",
    });
    expect(parseImageRef("ghcr.io/acme/web-app:2.1.0")).toMatchObject({
      registry: "ghcr.io",
      repository: "acme/web-app",
      name: "ghcr.io/acme/web-app",
    });
    expect(parseImageRef("registry.example.com:5000/team/api")).toMatchObject({
      registry: "registry.example.com:5000",
      repository: "team/api",
      tag: "latest",
    });
    const digest = `sha256:${"a".repeat(64)}`;
    expect(parseImageRef(`redis:7.2@${digest}`)).toMatchObject({ tag: "7.2", digest });
  });

  it("refuses what is not an image reference", () => {
    for (const bad of ["", "two words", "Upper/Case", "redis@sha256:short", "a".repeat(600)])
      expect(parseImageRef(bad)).toBeNull();
  });
});

describe("versionIn", () => {
  it("reads the version at the start of a tag or env value", () => {
    expect(versionIn("16-alpine")).toBe("16");
    expect(versionIn("1:11.8.9+maria~ubu2404")).toBe("11.8.9");
    expect(versionIn("16.4-1.pgdg120+1")).toBe("16.4");
    expect(versionIn("v2.38.1")).toBe("2.38.1");
    expect(versionIn("latest")).toBeNull();
    expect(versionIn("postgresql-latest")).toBeNull();
  });
});

describe("describeImage", () => {
  const config = (env: Record<string, string>, labels: Record<string, string> = {}) => ({ env, labels });

  it("records only the line of a moving tag, and the exact version of a pinned one", () => {
    const moving = describeImage(
      parseImageRef("mariadb:11")!,
      config({ MARIADB_VERSION: "1:11.8.9+maria~ubu2404" }),
    );
    expect(moving).toMatchObject({
      product: "mariadb",
      pinned: false,
      version: "11.8",
      versionNow: "11.8.9",
    });
    const pinned = describeImage(
      parseImageRef("mariadb:11.8.9")!,
      config({ MARIADB_VERSION: "1:11.8.9+maria~ubu2404" }),
    );
    expect(pinned).toMatchObject({ pinned: true, version: "11.8.9" });
    const postgres = describeImage(parseImageRef("postgres:16-alpine")!, config({ PG_VERSION: "16.4" }));
    expect(postgres).toMatchObject({
      product: "postgresql",
      pinned: false,
      version: "16",
      versionNow: "16.4",
    });
    expect(describeImage(parseImageRef("postgres:16.4-alpine")!, config({ PG_VERSION: "16.4" })).pinned).toBe(
      true,
    );
  });

  it("finds runtimes inside an image and where its source lives", () => {
    const app = describeImage(
      parseImageRef("ghcr.io/acme/web-app:latest")!,
      config({ NODE_VERSION: "18.20.3", PATH: "/usr/local/bin" }),
    );
    expect(app).toMatchObject({
      product: null,
      pinned: false,
      runtimes: [{ name: "node", version: "18.20.3" }],
      source: "acme/web-app",
    });
    const labelled = describeImage(
      parseImageRef("example/tool:2.0.1")!,
      config({}, { "org.opencontainers.image.source": "https://github.com/Example/Tool.git" }),
    );
    expect(labelled).toMatchObject({ pinned: true, version: "2.0.1", source: "example/tool" });
  });

  it("still says what it can when the registry could not be read", () => {
    const offline = describeImage(parseImageRef("redis:7.2.5")!, null, "the registry is unreachable");
    expect(offline).toMatchObject({
      product: "redis",
      pinned: true,
      version: "7.2.5",
      error: "the registry is unreachable",
    });
    expect(describeImage(parseImageRef("redis:7")!, null).pinned).toBe(false);
  });
});

describe("parseChallenge", () => {
  it("reads the token endpoint from a registry's 401", () => {
    expect(
      parseChallenge(
        'Bearer realm="https://auth.example.com/token",service="registry.example.com",scope="repository:a/b:pull"',
      ),
    ).toEqual({
      realm: "https://auth.example.com/token",
      service: "registry.example.com",
      scope: "repository:a/b:pull",
    });
    expect(parseChallenge('Basic realm="x"')).toBeNull();
  });
});
