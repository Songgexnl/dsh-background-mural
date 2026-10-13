/**
 * Media classification for Mural.
 *
 * Uploads are keyed by content type and extension. Both are allowlists: an
 * unknown type is rejected rather than guessed, so the library never ends up
 * holding a file DSH would later serve with a surprising `Content-Type`.
 */

/** Extension → `{ kind, mime }`. */
const BY_EXTENSION = new Map([
  [".jpg", { kind: "image", mime: "image/jpeg" }],
  [".jpeg", { kind: "image", mime: "image/jpeg" }],
  [".png", { kind: "image", mime: "image/png" }],
  [".gif", { kind: "image", mime: "image/gif" }],
  [".webp", { kind: "image", mime: "image/webp" }],
  [".avif", { kind: "image", mime: "image/avif" }],
  [".bmp", { kind: "image", mime: "image/bmp" }],
  [".svg", { kind: "image", mime: "image/svg+xml" }],
  [".mp4", { kind: "video", mime: "video/mp4" }],
  [".m4v", { kind: "video", mime: "video/mp4" }],
  [".webm", { kind: "video", mime: "video/webm" }],
  [".ogv", { kind: "video", mime: "video/ogg" }],
  [".mov", { kind: "video", mime: "video/quicktime" }]
]);

/** Content type → `{ kind, ext }`. */
const BY_MIME = new Map([
  ["image/jpeg", { kind: "image", ext: ".jpg" }],
  ["image/jpg", { kind: "image", ext: ".jpg" }],
  ["image/png", { kind: "image", ext: ".png" }],
  ["image/gif", { kind: "image", ext: ".gif" }],
  ["image/webp", { kind: "image", ext: ".webp" }],
  ["image/avif", { kind: "image", ext: ".avif" }],
  ["image/bmp", { kind: "image", ext: ".bmp" }],
  ["image/x-ms-bmp", { kind: "image", ext: ".bmp" }],
  ["image/svg+xml", { kind: "image", ext: ".svg" }],
  ["video/mp4", { kind: "video", ext: ".mp4" }],
  ["video/webm", { kind: "video", ext: ".webm" }],
  ["video/ogg", { kind: "video", ext: ".ogv" }],
  ["video/quicktime", { kind: "video", ext: ".mov" }]
]);

/** The `accept` attribute the picker advertises, kept in sync with the allowlist. */
export const ACCEPT_ATTRIBUTE = [
  ...new Set([...BY_MIME.keys()])
].join(",");

/** Lower-cased extension of a file name, `""` when there is none. */
export function extensionOf(name) {
  const base = String(name ?? "");
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

/** Strip any directory part a client may have sent, keeping the display name only. */
export function baseNameOf(name) {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
}

/**
 * Resolve the `{ kind, ext, mime }` triple for an upload.
 * @param declaredMime - the request `Content-Type`, parameters stripped.
 * @param fileName - the client-declared file name (used for its extension only).
 * @returns the resolved triple, or `null` when either signal is off the allowlist.
 */
export function resolveMediaType(declaredMime, fileName) {
  const mime = String(declaredMime ?? "").split(";")[0].trim().toLowerCase();
  const ext = extensionOf(fileName);
  const byMime = BY_MIME.get(mime);
  const byExt = BY_EXTENSION.get(ext);
  if (byMime === undefined && byExt === undefined) return null;
  // When both signals exist they must agree on the kind; a `.png` sent as
  // `video/mp4` is a client bug or a probe, and is rejected rather than guessed.
  if (byMime !== undefined && byExt !== undefined && byMime.kind !== byExt.kind) return null;
  const kind = byMime?.kind ?? byExt.kind;
  const resolvedExt = byExt !== undefined ? ext : byMime.ext;
  const resolvedMime = byExt !== undefined ? byExt.mime : byMime.mime;
  return { kind, ext: resolvedExt, mime: resolvedMime };
}

/**
 * Magic-byte sniff for the first bytes of a file. Guards against a file whose
 * extension claims an image while the bytes say otherwise. Returns `null` when
 * the signature is inconclusive (e.g. SVG, which is text).
 */
export function sniffKind(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const b = buffer;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image";
  if (b.toString("ascii", 4, 8) === "ftyp") {
    const brand = b.toString("ascii", 8, 12);
    if (brand.startsWith("avif") || brand.startsWith("avis") || brand.startsWith("mif1")) return "image";
    return "video";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video";
  if (b.toString("ascii", 0, 4) === "OggS") return "video";
  return null;
}
