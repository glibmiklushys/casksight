import { crc32 } from "./crc32";

export const FLAG_TOMBSTONE = 1;
export const HEADER_SIZE = 16;

export type Hint = {
  offset: number;
  size: number;
};

export type LogRecord = {
  offset: number;
  key: string;
  value: string | null;
  tombstone: boolean;
  crc: number;
  crcOk: boolean;
  size: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  const v = n >>> 0;
  b[0] = v & 0xff;
  b[1] = (v >>> 8) & 0xff;
  b[2] = (v >>> 16) & 0xff;
  b[3] = (v >>> 24) & 0xff;
  return b;
}

export function readU32(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset]! |
      (buf[offset + 1]! << 8) |
      (buf[offset + 2]! << 16) |
      (buf[offset + 3]! << 24)) >>>
    0
  );
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const len = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Packed little-endian record: crc32, key_len, val_len, flags, key, value. */
export function encodeRecord(key: string, value: string, tombstone: boolean): Uint8Array {
  const keyBytes = encoder.encode(key);
  const valBytes = tombstone ? new Uint8Array(0) : encoder.encode(value);
  const flags = tombstone ? FLAG_TOMBSTONE : 0;
  const payload = concatBytes([
    u32le(keyBytes.length),
    u32le(valBytes.length),
    u32le(flags),
    keyBytes,
    valBytes,
  ]);
  return concatBytes([u32le(crc32(payload)), payload]);
}

export function decodeRecord(file: Uint8Array, offset: number): LogRecord {
  if (offset + HEADER_SIZE > file.length) {
    throw new Error(`truncated header at ${offset}`);
  }
  const crc = readU32(file, offset);
  const keyLen = readU32(file, offset + 4);
  const valLen = readU32(file, offset + 8);
  const flags = readU32(file, offset + 12);
  const size = HEADER_SIZE + keyLen + valLen;
  if (offset + size > file.length) {
    throw new Error(`truncated record at ${offset}`);
  }
  const payload = file.subarray(offset + 4, offset + size);
  const crcOk = crc32(payload) === crc;
  const key = decoder.decode(file.subarray(offset + 16, offset + 16 + keyLen));
  const tombstone = (flags & FLAG_TOMBSTONE) !== 0;
  const value = tombstone
    ? null
    : decoder.decode(file.subarray(offset + 16 + keyLen, offset + size));
  return { offset, key, value, tombstone, crc, crcOk, size };
}

export function scanLog(file: Uint8Array): LogRecord[] {
  const records: LogRecord[] = [];
  let offset = 0;
  while (offset < file.length) {
    const rec = decodeRecord(file, offset);
    records.push(rec);
    offset += rec.size;
  }
  return records;
}
