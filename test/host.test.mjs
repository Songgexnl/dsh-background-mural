/**
 * Contract tests for the Mural host half.
 *
 * Run with `node --test test/` from the package root. These cover the pure
 * pieces — media classification, range parsing, the same-origin fence, settings
 * normalization and the on-disk library — which is where a background plugin
 * can actually do damage: a mis-parsed range breaks video seeking, and a
 * mis-validated upload path is a filesystem write with attacker-chosen bytes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { isSameOriginRequest, parseRangeHeader, readJsonBody } from "../lib/http-utils.js";
import { baseNameOf, resolveMediaType, sniffKind } from "../lib/media-types.js";
import { MuralStore, parseUploadMeta, resolveDshHome } from "../lib/store.js";
import { entryToJson, mergeSettings, normalizeSettings } from "../lib/routes.js";

/** Build a fake request stream carrying one buffer. */
function requestFrom(buffer, headers = {}) {
  const stream = Readable.from([buffer]);
  stream.headers = headers;
  stream.method = "POST";
  stream.url = "/api/background-mural/upload";
  return stream;
}

test("resolveMediaType accepts a matching pair", () => {
  assert.deepEqual(resolveMediaType("image/jpeg", "photo.jpg"), { kind: "image", ext: ".jpg", mime: "image/jpeg" });
  assert.deepEqual(resolveMediaType("video/mp4", "clip.MP4"), { kind: "video", ext: ".mp4", mime: "video/mp4" });
  assert.deepEqual(resolveMediaType("image/png; charset=binary", "x.png"), { kind: "image", ext: ".png", mime: "image/png" });
});

test("resolveMediaType rejects unknown or contradictory signals", () => {
  assert.equal(resolveMediaType("application/pdf", "doc.pdf"), null);
  assert.equal(resolveMediaType("text/plain", ""), null);
  // Declared MIME and extension disagree about the kind: never guess.
  assert.equal(resolveMediaType("video/mp4", "photo.png"), null);
  assert.equal(resolveMediaType("image/png", "clip.mp4"), null);
});

test("resolveMediaType falls back to whichever signal is known", () => {
  assert.deepEqual(resolveMediaType("application/octet-stream", "art.webp"), { kind: "image", ext: ".webp", mime: "image/webp" });
  assert.deepEqual(resolveMediaType("video/webm", ""), { kind: "video", ext: ".webm", mime: "video/webm" });
});

test("baseNameOf strips directories and control characters", () => {
  assert.equal(baseNameOf("C:\\Users\\me\\my photo.png"), "my photo.png");
  assert.equal(baseNameOf("/tmp/a/b/../../etc/passwd"), "passwd");
  assert.equal(baseNameOf("bad\u0000name.png"), "badname.png");
  assert.equal(baseNameOf("x".repeat(400)).length, 180);
});

test("sniffKind recognizes the common signatures", () => {
  assert.equal(sniffKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "image");
  assert.equal(sniffKind(Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\u001a\n"), Buffer.alloc(8)])), "image");
  assert.equal(sniffKind(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(4)])), "image");
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(4)]);
  assert.equal(sniffKind(mp4), "video");
  const avif = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypavif"), Buffer.alloc(4)]);
  assert.equal(sniffKind(avif), "image");
  assert.equal(sniffKind(Buffer.from("not a media file at all")), null);
});

test("parseRangeHeader handles the forms a video element sends", () => {
  assert.deepEqual(parseRangeHeader("bytes=0-", 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRangeHeader("bytes=100-199", 1000), { start: 100, end: 199 });
  assert.deepEqual(parseRangeHeader("bytes=-200", 1000), { start: 800, end: 999 });
  assert.deepEqual(parseRangeHeader("bytes=950-5000", 1000), { start: 950, end: 999 });
  assert.equal(parseRangeHeader(undefined, 1000), null);
  assert.deepEqual(parseRangeHeader("bytes=1000-1200", 1000), { unsatisfiable: true });
  assert.deepEqual(parseRangeHeader("bytes=abc", 1000), { unsatisfiable: true });
});

test("isSameOriginRequest fences cross-site browsers only", () => {
  assert.equal(isSameOriginRequest({ headers: {} }), true);
  assert.equal(isSameOriginRequest({ headers: { "sec-fetch-site": "same-origin" } }), true);
  assert.equal(isSameOriginRequest({ headers: { "sec-fetch-site": "cross-site" } }), false);
  assert.equal(isSameOriginRequest({ headers: { origin: "http://127.0.0.1:19387", host: "127.0.0.1:19387" } }), true);
  assert.equal(isSameOriginRequest({ headers: { origin: "http://evil.test", host: "127.0.0.1:19387" } }), false);
  assert.equal(isSameOriginRequest({ headers: { origin: "null", host: "127.0.0.1:19387" } }), true);
});

test("readJsonBody bounds the payload", async () => {
  const ok = requestFrom(Buffer.from(JSON.stringify({ dim: 42 })));
  assert.deepEqual(await readJsonBody(ok), { dim: 42 });
  const huge = requestFrom(Buffer.alloc(2048, 0x61));
  await assert.rejects(() => readJsonBody(huge, 128), /body-too-large/);
  const broken = requestFrom(Buffer.from("{not json"));
  await assert.rejects(() => readJsonBody(broken), /invalid-json/);
});

test("normalizeSettings clamps and repairs every field", () => {
  const normalized = normalizeSettings({
    enabled: false,
    activeId: 7,
    fit: "squish",
    playback: "forever",
    dim: 500,
    blur: -3,
    opacity: "42",
    focusX: 101,
    volume: 250,
    sidebarOpacity: 999,
    sound: "yes"
  });
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.activeId, "");
  assert.equal(normalized.fit, "cover");
  assert.equal(normalized.playback, "loop");
  assert.equal(normalized.dim, 90);
  assert.equal(normalized.blur, 0);
  assert.equal(normalized.opacity, 42);
  assert.equal(normalized.focusX, 100);
  assert.equal(normalized.volume, 100);
  assert.equal(normalized.sidebarOpacity, 100);
  assert.equal(normalized.sound, false);
});

test("the sidebar fill defaults to a visible panel", () => {
  const defaults = normalizeSettings({});
  assert.equal(defaults.sidebarOpacity, 42);
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.dim, 30);
});

test("mergeSettings only accepts known keys", () => {
  const merged = mergeSettings({ dim: 10 }, { dim: 55, evil: "x", activeId: "abc" });
  assert.equal(merged.dim, 55);
  assert.equal(merged.activeId, "abc");
  assert.equal(Object.hasOwn(merged, "evil"), false);
});

test("resolveDshHome prefers DSH_HOME and falls back to the platform home", () => {
  assert.equal(resolveDshHome({ DSH_HOME: "C:\\dsh-home" }, "C:\\Users\\me"), "C:\\dsh-home");
  assert.equal(resolveDshHome({}, "/home/me"), join("/home/me", ".dsh"));
  assert.equal(resolveDshHome({ DSH_HOME: "~/custom" }, "/home/me"), join("/home/me", "custom"));
});

test("parseUploadMeta accepts only plausible numbers", () => {
  const good = Buffer.from(JSON.stringify({ width: 1920, height: 1080, durationMs: 4200 })).toString("base64url");
  assert.deepEqual(parseUploadMeta(good), { width: 1920, height: 1080, durationMs: 4200 });
  assert.deepEqual(parseUploadMeta("not-base64!!"), {});
  assert.deepEqual(parseUploadMeta(Buffer.from('{"width":-1}').toString("base64url")), {});
});

test("entryToJson never exposes the on-disk path", () => {
  const json = entryToJson({ id: "abc", file: "abc.mp4", name: "clip.mp4", kind: "video", ext: ".mp4", mime: "video/mp4", size: 10, createdAt: 1 });
  assert.equal(json.url, "/api/background-mural/media/abc");
  assert.equal(Object.hasOwn(json, "file"), false);
});

test("MuralStore stores, lists, resolves and deletes media", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mural-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new MuralStore(root).load();

  const png = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\u001a\n"), Buffer.alloc(32, 7)]);
  const accepted = await store.acceptUpload(requestFrom(png, { "content-length": String(png.length) }), {
    kind: "image",
    ext: ".png",
    mime: "image/png",
    name: "wallpaper.png",
    maxBytes: 1024 * 1024,
    meta: { width: 100, height: 50 }
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.entry.name, "wallpaper.png");
  assert.equal(accepted.entry.size, png.length);
  assert.equal(accepted.entry.width, 100);

  const id = accepted.entry.id;
  assert.equal(store.get(id).id, id);
  assert.equal(store.list().length, 1);
  assert.equal(store.totalBytes(), png.length);
  assert.deepEqual(readFileSync(store.absolutePath(store.get(id))), png);

  // The index survives a reload.
  const reopened = new MuralStore(root).load();
  assert.equal(reopened.list().length, 1);

  assert.equal(store.remove(id), true);
  assert.equal(store.list().length, 0);
  assert.equal(store.remove(id), false);
});

test("MuralStore rejects oversized and mismatched uploads", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mural-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new MuralStore(root).load();

  const big = Buffer.alloc(4096, 1);
  const rejected = await store.acceptUpload(requestFrom(big, { "content-length": String(big.length) }), {
    kind: "image",
    ext: ".png",
    mime: "image/png",
    name: "big.png",
    maxBytes: 1024,
    meta: {}
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 413);
  assert.equal(store.list().length, 0);

  // A JPEG body declared as a video is refused on the signature check.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const mismatch = await store.acceptUpload(requestFrom(jpeg), {
    kind: "video",
    ext: ".mp4",
    mime: "video/mp4",
    name: "fake.mp4",
    maxBytes: 1024 * 1024,
    meta: {}
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.status, 415);
  assert.equal(store.list().length, 0);
});

test("MuralStore adopts media files the index lost", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mural-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = new MuralStore(root).load();
  const png = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\u001a\n"), Buffer.alloc(16, 3)]);
  await first.acceptUpload(requestFrom(png), {
    kind: "image",
    ext: ".png",
    mime: "image/png",
    name: "kept.png",
    maxBytes: 1024 * 1024,
    meta: {}
  });
  // Corrupt the index: the bytes on disk must still be recoverable.
  writeFileSync(join(root, "index.json"), "{ not json", "utf8");
  const recovered = new MuralStore(root).load();
  assert.equal(recovered.list().length, 1);
  assert.equal(recovered.list()[0].adopted, true);
});

test("MuralStore drops index rows whose file vanished", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mural-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new MuralStore(root).load();
  const png = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\u001a\n"), Buffer.alloc(16, 3)]);
  const accepted = await store.acceptUpload(requestFrom(png), {
    kind: "image",
    ext: ".png",
    mime: "image/png",
    name: "gone.png",
    maxBytes: 1024 * 1024,
    meta: {}
  });
  rmSync(join(root, "media", accepted.entry.file), { force: true });
  const reloaded = new MuralStore(root).load();
  assert.equal(reloaded.list().length, 0);
});

test("MuralStore.absolutePath refuses to escape the media directory", () => {
  const store = new MuralStore(join(tmpdir(), "mural-fence"));
  assert.equal(store.absolutePath({ file: "../secrets.txt" }), null);
  assert.equal(store.absolutePath({ file: "sub/../../secrets.txt" }), null);
  assert.notEqual(store.absolutePath({ file: "ok.png" }), null);
});
