// SPDX-License-Identifier: FSL-1.1-ALv2

export interface TarEntry {
  name: string;
  data: Buffer;
}

export class TarError extends Error {}

const BLOCK = 512;
const MAX_ENTRIES = 1000;

function readString(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

function readOctal(buf: Buffer, start: number, length: number): number {
  const field = buf.subarray(start, start + length);
  if (field[0] & 0x80) throw new TarError("tar entry too large");
  const text = readString(buf, start, length).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new TarError("invalid tar header");
  return parseInt(text, 8);
}

function checksumOk(header: Buffer): boolean {
  const expected = readOctal(header, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i];
  return sum === expected;
}

function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  const text = data.toString("utf8");
  while (pos < text.length) {
    const space = text.indexOf(" ", pos);
    if (space === -1) break;
    const len = parseInt(text.slice(pos, space), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(space + 1, pos + len - 1);
    const eq = record.indexOf("=");
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return out;
}

/**
 * Minimal ustar/pax/GNU reader over an in-memory archive. Returns regular files only.
 * Names are returned as stored; callers decide what to accept.
 */
export function readTar(archive: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let nextName: string | null = null;
  let count = 0;

  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;
    if (++count > MAX_ENTRIES) throw new TarError("too many tar entries");
    if (!checksumOk(header)) throw new TarError("invalid tar checksum");

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) throw new TarError("truncated tar archive");
    const data = archive.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      nextName = parsePax(data).path ?? nextName;
      continue;
    }
    if (type === "L") {
      nextName = readString(data, 0, data.length);
      continue;
    }
    if (type === "g" || type === "K") continue;

    const magic = readString(header, 257, 6);
    const prefix = magic.startsWith("ustar") ? readString(header, 345, 155) : "";
    const stored = readString(header, 0, 100);
    const name = nextName ?? (prefix ? `${prefix}/${stored}` : stored);
    nextName = null;

    if (type === "0" || type === "\0" || type === "7") entries.push({ name, data: Buffer.from(data) });
  }
  return entries;
}
