// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { readTar, TarError } from "./tar";

function header(name: string, size: number, type = "0", prefix = ""): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  h.write(prefix, 345, 155, "utf8");
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}

function entry(name: string, content: string, type = "0", prefix = ""): Buffer {
  const data = Buffer.from(content);
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return Buffer.concat([header(name, data.length, type, prefix), padded]);
}

const end = Buffer.alloc(1024);

describe("readTar", () => {
  it("reads regular files and skips directories and symlinks", () => {
    const tar = Buffer.concat([
      entry("package.json", '{"name":"x"}'),
      entry("dir/", "", "5"),
      entry("link", "", "2"),
      entry("yarn.lock", "# yarn lockfile v1\n"),
      end,
    ]);
    const files = readTar(tar);
    expect(files.map((f) => f.name)).toEqual(["package.json", "yarn.lock"]);
    expect(files[0].data.toString()).toBe('{"name":"x"}');
  });

  it("applies ustar prefixes, pax paths and GNU long names", () => {
    const pax = "30 path=../../etc/passwd.json\n";
    const tar = Buffer.concat([
      entry("package.json", "{}", "0", "sub"),
      entry("PaxHeader", pax, "x"),
      entry("package.json", "{}"),
      entry("././@LongLink", "very/long/package-lock.json", "L"),
      entry("package-lock.json", "{}"),
      end,
    ]);
    expect(readTar(tar).map((f) => f.name)).toEqual([
      "sub/package.json",
      "../../etc/passwd.json",
      "very/long/package-lock.json",
    ]);
  });

  it("rejects corrupt and truncated archives", () => {
    const good = entry("package.json", "x".repeat(1000));
    const corrupt = Buffer.from(good);
    corrupt[0] = 0x41;
    expect(() => readTar(corrupt)).toThrow(TarError);
    expect(() => readTar(good.subarray(0, 700))).toThrow(/truncated/);
  });
});
