import { concatBytes, decodeRecord, encodeRecord, scanLog } from "./record";
import type { Hint, LogRecord } from "./record";

export type CaskStats = {
  liveKeys: number;
  logRecords: number;
  wasted: number;
  bytes: number;
  segment: number;
};

/**
 * In-memory Bitcask: one append-only byte log plus a hash table of live keys.
 * Offsets are byte positions. Compaction writes a new segment of live records only.
 */
export class Cask {
  private file: Uint8Array = new Uint8Array(0);
  private hints = new Map<string, Hint>();
  private segmentId = 1;

  put(key: string, value: string): void {
    this.append(encodeRecord(key, value, false), key, true);
  }

  del(key: string): void {
    this.append(encodeRecord(key, "", true), key, false);
  }

  get(key: string): string | undefined {
    const hint = this.hints.get(key);
    if (!hint) return undefined;
    const rec = decodeRecord(this.file, hint.offset);
    if (rec.size !== hint.size) {
      throw new Error(`index size mismatch for ${key}`);
    }
    if (!rec.crcOk) {
      throw new Error(`crc mismatch at offset ${hint.offset}`);
    }
    if (rec.tombstone) return undefined;
    return rec.value ?? undefined;
  }

  compact(): void {
    const live = this.records.filter((rec) => this.isLive(rec));
    let next: Uint8Array = new Uint8Array(0);
    const hints = new Map<string, Hint>();
    for (const rec of live) {
      const encoded = encodeRecord(rec.key, rec.value ?? "", false);
      const offset = next.length;
      next = concatBytes([next, encoded]);
      hints.set(rec.key, { offset, size: encoded.length });
    }
    this.file = next;
    this.hints = hints;
    this.segmentId += 1;
  }

  hint(key: string): Hint | undefined {
    return this.hints.get(key);
  }

  isLive(rec: LogRecord): boolean {
    const hint = this.hints.get(rec.key);
    return hint !== undefined && hint.offset === rec.offset;
  }

  get records(): LogRecord[] {
    return scanLog(this.file);
  }

  get index(): ReadonlyMap<string, Hint> {
    return this.hints;
  }

  get bytes(): Uint8Array {
    return this.file;
  }

  get segment(): number {
    return this.segmentId;
  }

  stats(): CaskStats {
    const logRecords = this.records.length;
    const liveKeys = this.hints.size;
    return {
      liveKeys,
      logRecords,
      wasted: logRecords - liveKeys,
      bytes: this.file.length,
      segment: this.segmentId,
    };
  }

  private append(encoded: Uint8Array, key: string, live: boolean): void {
    const offset = this.file.length;
    this.file = concatBytes([this.file, encoded]);
    if (live) {
      this.hints.set(key, { offset, size: encoded.length });
    } else {
      this.hints.delete(key);
    }
  }
}
