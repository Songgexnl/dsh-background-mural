/**
 * Mural's media library on disk.
 *
 * Layout (under the DSH home directory):
 *
 *   background-mural/index.json      library metadata (never the file bytes)
 *   background-mural/media/<id><ext> uploaded originals
 *   background-mural/tmp/            partial uploads (atomic rename on success)
 *
 * The library is intentionally simple and self-healing: a missing or corrupt
 * index still leaves the media files readable, and the index is rewritten
 * through a temp file plus rename so a crash cannot leave it half written.
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { sniffKind } from "./media-types.js";

/** Index file format version. */
export const INDEX_VERSION = 1;

/** Expand a leading `~` / `~/` in a user-supplied path. */
export function expandHome(value, home = homedir()) {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(home, value.slice(2));
  return value;
}

/**
 * Resolve the DSH home directory.
 *
 * Precedence mirrors the rest of the DSH plugin family: an explicit
 * `DSH_HOME` wins, the platform home directory is the fallback.
 * @param env - environment to read, injectable for tests.
 * @param home - home directory fallback, injectable for tests.
 */
export function resolveDshHome(env = process.env, home = homedir()) {
  const raw = env.DSH_HOME;
  if (typeof raw === "string" && raw.trim() !== "") {
    const expanded = expandHome(raw.trim(), home);
    return resolve(expanded);
  }
  return join(home, ".dsh");
}

/** Default store root: `<DSH_HOME>/background-mural`. */
export function defaultStoreRoot(env = process.env, home = homedir()) {
  return join(resolveDshHome(env, home), "background-mural");
}

/** Parse the upload's `x-mural-meta` header: `{width,height,durationMs}`, best effort. */
export function parseUploadMeta(header) {
  if (typeof header !== "string" || header === "") return {};
  let raw;
  try {
    raw = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  } catch {
    return {};
  }
  if (raw === null || typeof raw !== "object") return {};
  const meta = {};
  if (Number.isFinite(raw.width) && raw.width > 0) meta.width = Math.round(raw.width);
  if (Number.isFinite(raw.height) && raw.height > 0) meta.height = Math.round(raw.height);
  if (Number.isFinite(raw.durationMs) && raw.durationMs > 0) meta.durationMs = Math.round(raw.durationMs);
  return meta;
}

/** The media library: index bookkeeping plus bounded, atomic file intake. */
export class MuralStore {
  /** @param root - store root directory. */
  constructor(root) {
    this.root = root;
    this.mediaDir = join(root, "media");
    this.tmpDir = join(root, "tmp");
    this.indexPath = join(root, "index.json");
    /** @type {Map<string, object>} */
    this.entries = new Map();
    this.loaded = false;
  }

  /** Create the directory skeleton. */
  ensureDirs() {
    mkdirSync(this.mediaDir, { recursive: true });
    mkdirSync(this.tmpDir, { recursive: true });
  }

  /**
   * Load the index, recovering from a missing or corrupt file by rescanning the
   * media directory, so bytes a user dropped in by hand are still usable.
   */
  load() {
    if (this.loaded) return this;
    this.ensureDirs();
    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(this.indexPath, "utf8"));
    } catch {
      parsed = null;
    }
    if (parsed !== null && typeof parsed === "object" && Array.isArray(parsed.items)) {
      for (const item of parsed.items) {
        if (item === null || typeof item !== "object") continue;
        if (typeof item.id !== "string" || item.id === "") continue;
        this.entries.set(item.id, item);
      }
    }
    this.reconcile();
    this.loaded = true;
    return this;
  }

  /** Drop index rows whose file vanished, and adopt media files the index lost. */
  reconcile() {
    for (const [id, entry] of [...this.entries]) {
      if (!existsSync(join(this.mediaDir, entry.file))) this.entries.delete(id);
    }
    // Known file names are collected once: a name already claimed by an index
    // row is never adopted a second time under a different id.
    const claimed = new Set([...this.entries.values()].map((entry) => entry.file));
    let names = [];
    try {
      names = readdirSync(this.mediaDir);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (name.startsWith(".") || claimed.has(name)) continue;
      let stat;
      try {
        stat = statSync(join(this.mediaDir, name));
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const dot = name.lastIndexOf(".");
      const id = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
      const kind = [".mp4", ".webm", ".ogv", ".mov", ".m4v"].includes(ext) ? "video" : "image";
      claimed.add(name);
      this.entries.set(id, {
        id,
        file: name,
        name,
        kind,
        ext,
        mime: kind === "video" ? "video/mp4" : "image/*",
        size: stat.size,
        createdAt: Math.round(stat.mtimeMs),
        adopted: true
      });
    }
  }

  /** Persist the index atomically (temp file + rename). */
  save() {
    this.ensureDirs();
    const payload = {
      version: INDEX_VERSION,
      items: [...this.entries.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    };
    const tmp = `${this.indexPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    renameSync(tmp, this.indexPath);
  }

  /** All entries, newest first. */
  list() {
    return [...this.entries.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  /** One entry by id, or `null`. */
  get(id) {
    if (typeof id !== "string" || id === "") return null;
    return this.entries.get(id) ?? null;
  }

  /** Absolute path of one entry's file, or `null` when the entry is unknown. */
  absolutePath(entry) {
    if (entry === null || entry === undefined) return null;
    const target = resolve(this.mediaDir, entry.file);
    // Path-escape fence: the resolved path must stay inside the media directory.
    if (target !== this.mediaDir && !target.startsWith(this.mediaDir + sep)) return null;
    return target;
  }

  /** Delete one entry and its file. Returns whether anything was removed. */
  remove(id) {
    const entry = this.get(id);
    if (entry === null) return false;
    const abs = this.absolutePath(entry);
    this.entries.delete(id);
    if (abs !== null) {
      try {
        rmSync(abs, { force: true });
      } catch {
        /* the index row is gone either way; the file is best effort */
      }
    }
    this.save();
    return true;
  }

  /**
   * Stream one request body into the library.
   *
   * The body is written to a temp file while counting bytes; exceeding
   * `maxBytes` aborts and removes it. The leading bytes are sniffed so a file
   * whose declared type disagrees with its signature is rejected.
   *
   * @param req - the incoming request.
   * @param spec - `{ kind, ext, mime, name, maxBytes, meta }`.
   * @returns `{ ok: true, entry }` or `{ ok: false, status, error }`.
   */
  async acceptUpload(req, spec) {
    const { maxBytes } = spec;
    const declared = req.headers["content-length"];
    if (typeof declared === "string" && declared !== "") {
      const length = Number.parseInt(declared, 10);
      if (Number.isFinite(length) && length > maxBytes) {
        return { ok: false, status: 413, error: "payload-too-large" };
      }
    }
    this.ensureDirs();
    const id = randomUUID();
    const partial = join(this.tmpDir, `${id}.part`);
    const sink = createWriteStream(partial);
    let received = 0;
    let head = Buffer.alloc(0);
    let aborted = null;

    const cleanup = () => {
      try {
        sink.destroy();
      } catch {
        /* already gone */
      }
      try {
        rmSync(partial, { force: true });
      } catch {
        /* already gone */
      }
    };

    try {
      await new Promise((resolvePromise, rejectPromise) => {
        const fail = (error) => {
          aborted = error;
          rejectPromise(error);
        };
        sink.on("error", fail);
        req.on("error", fail);
        req.on("aborted", () => fail(new Error("request-aborted")));
        sink.on("drain", () => req.resume());
        req.on("data", (chunk) => {
          if (aborted !== null) return;
          received += chunk.length;
          if (received > maxBytes) {
            fail(new Error("payload-too-large"));
            return;
          }
          if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
          let flushed = true;
          try {
            flushed = sink.write(chunk);
          } catch (error) {
            fail(error);
            return;
          }
          if (!flushed) req.pause();
        });
        req.on("end", () => {
          if (aborted !== null) return;
          sink.end(() => resolvePromise());
        });
      });
    } catch (error) {
      cleanup();
      const message = error instanceof Error ? error.message : String(error);
      if (message === "payload-too-large") return { ok: false, status: 413, error: "payload-too-large" };
      return { ok: false, status: 400, error: "upload-failed" };
    }

    if (received === 0) {
      cleanup();
      return { ok: false, status: 400, error: "empty-upload" };
    }

    const sniffed = sniffKind(head);
    if (sniffed !== null && sniffed !== spec.kind) {
      cleanup();
      return { ok: false, status: 415, error: "content-type-mismatch" };
    }

    const file = `${id}${spec.ext}`;
    const finalPath = join(this.mediaDir, file);
    try {
      renameSync(partial, finalPath);
    } catch {
      cleanup();
      return { ok: false, status: 500, error: "store-failed" };
    }

    const entry = {
      id,
      file,
      name: spec.name === "" ? `${id}${spec.ext}` : spec.name,
      kind: spec.kind,
      ext: spec.ext,
      mime: spec.mime,
      size: received,
      createdAt: Date.now(),
      ...spec.meta
    };
    this.entries.set(id, entry);
    try {
      this.save();
    } catch {
      /* the file is on disk and will be adopted on the next load */
    }
    return { ok: true, entry };
  }

  /** Total library size in bytes. */
  totalBytes() {
    let total = 0;
    for (const entry of this.entries.values()) total += Number(entry.size ?? 0);
    return total;
  }

  /** The library root, for diagnostics in the UI. */
  describe() {
    return { root: this.root, mediaDir: basename(this.mediaDir), count: this.entries.size, totalBytes: this.totalBytes() };
  }
}
