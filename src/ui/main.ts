import { Cask } from "../cask/cask";
import type { LogRecord } from "../cask/record";

let store = new Cask();
let keyDraft = "";
let valueDraft = "";
let selectedKey = "";
let focus: "key" | "value" | null = null;
let caret = 0;
let note = "Put a key. The log grows; the index remembers where the latest record lives.";
let getBanner: { kind: "hit" | "miss"; text: string } | null = null;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function padOffset(offset: number): string {
  return "+" + offset.toString().padStart(4, "0");
}

function crcHex(crc: number): string {
  return "0x" + crc.toString(16).padStart(8, "0");
}

function render(): void {
  const root = document.getElementById("app");
  if (!root) return;

  const stats = store.stats();
  const records = store.records;
  const key = keyDraft;
  const selected = selectedKey || key;

  root.innerHTML = `
    <header class="masthead">
      <div>
        <p class="brand">Casksight</p>
        <h1>Watch a key/value log.</h1>
        <p class="lede">
          Every write is an append. RAM holds a hash table of keys to byte offsets.
          Get never scans. Compaction copies only live records into a new segment.
        </p>
      </div>
      <div class="clock">
        <strong>${stats.liveKeys} live</strong>
        ${stats.logRecords} records · ${stats.wasted} wasted · ${stats.bytes} B
      </div>
    </header>

    ${
      getBanner
        ? `<p class="banner ${getBanner.kind}">${esc(getBanner.text)}</p>`
        : ""
    }

    <p class="status">${esc(note)}</p>

    <div class="layout">
      <aside class="panel write">
        <h2>Write</h2>
        <label>
          Key
          <input id="key" type="text" autocomplete="off" spellcheck="false" value="${esc(keyDraft)}" />
        </label>
        <label>
          Value
          <input id="value" type="text" autocomplete="off" spellcheck="false" value="${esc(valueDraft)}" />
        </label>
        <div class="actions">
          <button type="button" data-act="put">Put</button>
          <button type="button" data-act="get">Get</button>
          <button type="button" data-act="del">Delete</button>
          <button type="button" data-act="compact">Compact</button>
          <button type="button" class="danger" data-act="reset">Reset</button>
        </div>
      </aside>

      <section class="panel log-panel">
        <div class="panel-head">
          <h2>Log</h2>
          <span>segment ${stats.segment} · old → new</span>
        </div>
        <div class="tape">
          ${records.length === 0 ? `<p class="empty">empty log</p>` : records.map((rec) => recHtml(rec, selected)).join("")}
        </div>
      </section>

      <aside class="panel index-panel">
        <div class="panel-head">
          <h2>Index</h2>
          <span>key → offset</span>
        </div>
        ${indexHtml(selected)}
      </aside>
    </div>
  `;

  bind(root);
  restoreFocus();
}

function recHtml(rec: LogRecord, selected: string): string {
  const live = store.isLive(rec);
  const classes = ["rec"];
  if (rec.tombstone) classes.push("tombstone");
  if (!live) classes.push("obsolete");
  if (live) classes.push("live");
  if (live && rec.key === selected) classes.push("selected");

  const kind = rec.tombstone ? "DEL" : "PUT";
  const body = rec.tombstone ? "tombstone" : rec.value ?? "";
  const head = live && rec.key === selected ? `<span class="head">index</span>` : "";
  const crc = rec.crcOk ? "ok" : "bad";

  return `
    <article class="${classes.join(" ")}" data-key="${esc(rec.key)}">
      <div class="rec-rail">${padOffset(rec.offset)}</div>
      <div class="rec-body">
        <div class="rec-top">
          <span class="kind">${kind}</span>
          <span class="rkey">${esc(rec.key)}</span>
          ${head}
        </div>
        <div class="rec-val">${esc(body)}</div>
        <div class="rec-meta">crc ${crcHex(rec.crc)} · ${crc} · ${rec.size} B</div>
      </div>
    </article>
  `;
}

function indexHtml(selected: string): string {
  const rows = [...store.index.entries()];
  if (rows.length === 0) {
    return `<p class="empty">no keys</p>`;
  }
  return `
    <table>
      <thead>
        <tr><th>Key</th><th>Offset</th></tr>
      </thead>
      <tbody>
        ${rows
          .map(([key, hint]) => {
            const on = key === selected ? " class=\"on\"" : "";
            return `<tr${on} data-key="${esc(key)}"><td>${esc(key)}</td><td>${padOffset(hint.offset)}</td></tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function bind(root: HTMLElement): void {
  root.querySelectorAll("button[data-act]").forEach((button) => {
    button.addEventListener("click", () => onAction(button.getAttribute("data-act")));
  });

  const keyInput = document.getElementById("key") as HTMLInputElement | null;
  const valueInput = document.getElementById("value") as HTMLInputElement | null;

  keyInput?.addEventListener("input", (event) => {
    const el = event.target as HTMLInputElement;
    rememberField("key", el);
    keyDraft = el.value;
    selectedKey = el.value;
    getBanner = null;
    render();
  });

  valueInput?.addEventListener("input", (event) => {
    const el = event.target as HTMLInputElement;
    rememberField("value", el);
    valueDraft = el.value;
  });

  keyInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onAction("put");
    }
  });

  valueInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onAction("put");
    }
  });

  root.querySelectorAll(".rec[data-key]").forEach((el) => {
    el.addEventListener("click", () => {
      const k = el.getAttribute("data-key") ?? "";
      keyDraft = k;
      selectedKey = k;
      getBanner = null;
      note = `Selected “${k}”. The gold mark is the offset the index currently holds.`;
      render();
    });
  });

  root.querySelectorAll("tr[data-key]").forEach((el) => {
    el.addEventListener("click", () => {
      const k = el.getAttribute("data-key") ?? "";
      keyDraft = k;
      selectedKey = k;
      const hint = store.hint(k);
      note = hint
        ? `Index(“${k}”) → ${padOffset(hint.offset)}. Get will seek there and check the CRC.`
        : `“${k}” is not in the index.`;
      getBanner = null;
      render();
    });
  });
}

function rememberField(which: "key" | "value", el: HTMLInputElement): void {
  focus = which;
  caret = el.selectionStart ?? el.value.length;
}

function restoreFocus(): void {
  if (!focus) return;
  const el = document.getElementById(focus) as HTMLInputElement | null;
  if (!el) return;
  el.focus();
  const pos = Math.min(caret, el.value.length);
  el.setSelectionRange(pos, pos);
}

function onAction(act: string | null): void {
  syncDrafts();
  const key = keyDraft.trim();

  if (act === "put") {
    if (!key) {
      note = "Key is empty.";
      getBanner = null;
      render();
      return;
    }
    store.put(key, valueDraft);
    selectedKey = key;
    getBanner = null;
    note = `Appended PUT ${key}. Index now points at the new offset.`;
  } else if (act === "get") {
    if (!key) {
      note = "Key is empty.";
      getBanner = { kind: "miss", text: "Key is empty." };
      render();
      return;
    }
    selectedKey = key;
    const hint = store.hint(key);
    const value = store.get(key);
    if (value === undefined) {
      getBanner = { kind: "miss", text: `${key}  ·  not in index` };
      note = `Get missed. No hint for “${key}”.`;
    } else {
      getBanner = {
        kind: "hit",
        text: `${key} = ${value}  ·  offset ${hint ? padOffset(hint.offset) : "?"}  ·  crc ok`,
      };
      note = `Get followed the index to ${hint ? padOffset(hint.offset) : "?"} and read the record.`;
    }
  } else if (act === "del") {
    if (!key) {
      note = "Key is empty.";
      getBanner = null;
      render();
      return;
    }
    store.del(key);
    selectedKey = key;
    getBanner = null;
    note = `Appended tombstone for “${key}” and dropped it from the index.`;
  } else if (act === "compact") {
    const before = store.stats();
    store.compact();
    const after = store.stats();
    getBanner = null;
    note = `Compacted to segment ${after.segment}. ${before.logRecords} records → ${after.logRecords} live.`;
  } else if (act === "reset") {
    store = new Cask();
    keyDraft = "";
    valueDraft = "";
    selectedKey = "";
    getBanner = null;
    note = "Empty log, empty index.";
  }

  render();
}

function syncDrafts(): void {
  const keyInput = document.getElementById("key") as HTMLInputElement | null;
  const valueInput = document.getElementById("value") as HTMLInputElement | null;
  if (keyInput) keyDraft = keyInput.value;
  if (valueInput) valueDraft = valueInput.value;
}

export function boot(): void {
  render();
}
