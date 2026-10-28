// SPDX-License-Identifier: FSL-1.1-ALv2

/** At most `limit` at a time; up to `queue` more wait their turn, the rest are turned away. */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly limit: number,
    private readonly queue: number,
  ) {}

  /** A release function (call it once), or null when too many are already waiting. */
  async acquire(): Promise<(() => void) | null> {
    if (this.active < this.limit) {
      this.active++;
      return this.releaser();
    }
    if (this.waiting.length >= this.queue) return null;
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    return this.releaser();
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // Hand the slot straight to the next in line, or free it.
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    };
  }
}
