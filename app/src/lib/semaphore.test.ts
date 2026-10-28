// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { Semaphore } from "./semaphore";

describe("Semaphore", () => {
  it("lets `limit` through, queues `queue` more and turns the rest away", async () => {
    const s = new Semaphore(2, 1);
    const a = await s.acquire();
    const b = await s.acquire();
    let thirdIn = false;
    const third = s.acquire().then((r) => ((thirdIn = true), r));
    expect(await s.acquire()).toBeNull();
    expect(thirdIn).toBe(false);
    a!();
    a!(); // twice is harmless
    const c = await third;
    expect(thirdIn).toBe(true);
    b!();
    c!();
    expect(await s.acquire()).not.toBeNull();
  });
});
