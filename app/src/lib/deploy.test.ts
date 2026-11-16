// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { canRedeploy, withForce } from "./deploy";

describe("redeploy", () => {
  it("always rebuilds through a Coolify webhook, which comes with force=false", () => {
    // Without force Coolify reuses the image of the same commit, so a moving tag stays old.
    expect(
      withForce("https://coolify.example.com/api/v1/deploy?uuid=abc123def456ghi789jkl012&force=false"),
    ).toBe("https://coolify.example.com/api/v1/deploy?uuid=abc123def456ghi789jkl012&force=true");
    expect(withForce("https://coolify.example.com/api/v1/deploy?uuid=abc123def456ghi789jkl012")).toBe(
      "https://coolify.example.com/api/v1/deploy?uuid=abc123def456ghi789jkl012&force=true",
    );
    // Not a Coolify webhook: left as it is.
    expect(withForce("https://dokploy.example.com/api/deploy/abc")).toBe(
      "https://dokploy.example.com/api/deploy/abc",
    );
  });

  it("can redeploy with a Coolify link or a webhook", () => {
    const none = { deployWebhookUrl: "", coolifyServer: "", coolifyUuid: "" };
    expect(canRedeploy(none)).toBe(false);
    expect(canRedeploy({ ...none, deployWebhookUrl: "enc:v1:…" })).toBe(true);
    expect(canRedeploy({ ...none, coolifyServer: "srv1", coolifyUuid: "abc123def456ghi789jkl012" })).toBe(
      true,
    );
    // A uuid that no connected server has yet is not enough.
    expect(canRedeploy({ ...none, coolifyUuid: "abc123def456ghi789jkl012" })).toBe(false);
  });
});
