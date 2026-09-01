import { describe, expect, it } from "vitest";
import { Cask } from "../src/cask/cask";
import { crc32 } from "../src/cask/crc32";
import { decodeRecord, encodeRecord } from "../src/cask/record";

describe("put/get", () => {
  it("stores a value and reads it back through the index", () => {
    const db = new Cask();
    db.put("user:1", "glib");
    expect(db.get("user:1")).toBe("glib");
    expect(db.index.get("user:1")?.offset).toBe(0);
    const rec = db.records[0];
    expect(rec?.crcOk).toBe(true);
    expect(rec?.tombstone).toBe(false);
  });

  it("returns undefined for a missing key", () => {
    const db = new Cask();
    db.put("a", "1");
    expect(db.get("missing")).toBeUndefined();
  });
});

describe("overwrite latest wins", () => {
  it("keeps both records and serves the latest value", () => {
    const db = new Cask();
    db.put("a", "one");
    db.put("a", "two");
    expect(db.records).toHaveLength(2);
    expect(db.records[0]?.value).toBe("one");
    expect(db.records[1]?.value).toBe("two");
    expect(db.get("a")).toBe("two");
    expect(db.index.get("a")?.offset).toBe(db.records[1]?.offset);
    expect(db.isLive(db.records[0]!)).toBe(false);
    expect(db.isLive(db.records[1]!)).toBe(true);
    expect(db.stats().liveKeys).toBe(1);
    expect(db.stats().wasted).toBe(1);
  });
});

describe("del", () => {
  it("appends a tombstone and drops the key from the index", () => {
    const db = new Cask();
    db.put("a", "1");
    db.del("a");
    expect(db.get("a")).toBeUndefined();
    expect(db.index.has("a")).toBe(false);
    expect(db.records).toHaveLength(2);
    expect(db.records[1]?.tombstone).toBe(true);
    expect(db.records[1]?.crcOk).toBe(true);
    expect(db.stats().liveKeys).toBe(0);
    expect(db.stats().wasted).toBe(2);
  });
});

describe("compact", () => {
  it("shrinks the log and get still works", () => {
    const db = new Cask();
    db.put("a", "1");
    db.put("b", "2");
    db.put("a", "3");
    db.del("b");
    expect(db.records.length).toBe(4);
    expect(db.get("a")).toBe("3");

    const beforeBytes = db.stats().bytes;
    db.compact();

    expect(db.records.length).toBe(1);
    expect(db.records.length).toBeLessThan(4);
    expect(db.stats().bytes).toBeLessThan(beforeBytes);
    expect(db.stats().wasted).toBe(0);
    expect(db.stats().liveKeys).toBe(1);
    expect(db.get("a")).toBe("3");
    expect(db.get("b")).toBeUndefined();
    expect(db.records[0]?.offset).toBe(0);
    expect(db.records[0]?.crcOk).toBe(true);
    expect(db.segment).toBe(2);
  });
});

describe("record crc", () => {
  it("round-trips a put and a tombstone with a matching crc", () => {
    const put = encodeRecord("k", "v", false);
    const rec = decodeRecord(put, 0);
    expect(rec.crcOk).toBe(true);
    expect(rec.key).toBe("k");
    expect(rec.value).toBe("v");

    const del = encodeRecord("k", "", true);
    const tomb = decodeRecord(del, 0);
    expect(tomb.crcOk).toBe(true);
    expect(tomb.tombstone).toBe(true);

    const flipped = new Uint8Array(put);
    flipped[0] ^= 0xff;
    expect(decodeRecord(flipped, 0).crcOk).toBe(false);
  });

  it("is stable for a known payload", () => {
    expect(crc32(new Uint8Array([0x01, 0x02, 0x03, 0x04]))).toBe(0xb63cfbcd);
  });
});
