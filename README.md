# Casksight

A Bitcask-style key/value log you can watch. Put a key, overwrite it, delete it, then compact. The append-only tape grows on the left of the index; the hash table of live keys sits on the right.

**Live:** [glibmiklushys.github.io/casksight](https://glibmiklushys.github.io/casksight/)

This is the same idea as [KeelDB](https://github.com/glibmiklushys/keeldb), the C++20 engine: CRC records, an in-memory index, crash-style replay as “the log is the truth.” Here the “disk” is a byte array so the tests stay deterministic and the page can step through every append.

## Bitcask, in short

Hash tables are fast until they have to persist. Bitcask (Riak) kept the hash table in RAM and made the disk boring: **every write is an append**. You never update a row in place.

A `put` encodes a record, writes it at the end of the active segment, and stores `{offset, size}` under that key. A later `put` of the same key appends a new record; the index just moves. The old bytes stay until compaction.

`get` does not scan. It looks up the hint, seeks to that offset, checks the CRC, and returns the value. If the key is missing, there is no hint.

`del` appends a **tombstone** (flag bit 0) and drops the key from the index. Old puts and the tombstone are waste. They still occupy the log so a replay can reconstruct the same map: later records win, a tombstone removes the key.

`compact()` writes every live key — the records the index still points at — into a new segment, then swaps that file in. Overwrites and deletes stop occupying space. Reads still go through the same index.

```
put / del  →  log (append)
get        →  index  →  seek + CRC
compact    →  new segment of live keys  →  index
```

Record layout, little-endian, packed, no padding:

```
[crc32: u32][key_len: u32][val_len: u32][flags: u32][key][value]
```

`crc32` covers everything after it. Flag bit 0 is a tombstone. Offsets are byte positions in the current segment.

The whole key set must fit in memory. That is the deal: O(1) reads, sequential writes, and an index rebuild by replaying the log.

## How to run

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build    # typecheck + production bundle
npm run preview  # serve dist/
```

## Architecture

- `src/cask/cask.ts` — `put`, `del`, `get`, `compact`. One in-memory segment (`Uint8Array`) and a `Map` of hints.
- `src/cask/record.ts` — encode / decode / scan. Same 16-byte header as KeelDB.
- `src/cask/crc32.ts` — IEEE CRC-32.
- `src/ui/` — vanilla DOM. No React.
- `test/` — put/get, overwrite, delete, compact. No wall-clock, no disk.

## What the UI shows

The center column is the log, oldest record at the top. Live records (the ones the index still names) stay bright. Overwritten puts dim. Tombstones use a warmer mark. Type a key — or click a log row or index row — and the gold **index** tag sits on the record that hint points at.

| Control | What it does |
| --- | --- |
| Put | Append a CRC record; move the index to the new offset |
| Get | Follow the hint, verify CRC, show a banner |
| Delete | Append a tombstone; drop the key from the index |
| Compact | Rewrite only live keys into a new segment |
| Reset | Empty log and index |

The masthead counts live keys, log records, and wasted/obsolete records (everything the index does not point at).

## License

MIT © 2026 Glib Miklushys
