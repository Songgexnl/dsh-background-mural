/**
 * Mural's HTTP surface.
 *
 * Every route is same-origin fenced, every request body is bounded, and every
 * filesystem read is resolved through the store's escape fence. Uploads use a
 * raw body with metadata in headers rather than multipart: the browser sends
 * the original bytes untouched, which keeps large video uploads streamable and
 * keeps this host half free of a multipart parser dependency.
 *
 * Handlers take `(req, res)` and read their own URL, matching how the DSH
 * webserver dispatches registered routes.
 */
import { json, readJsonBody, requireSameOrigin, serveFile } from "./http-utils.js";
import { ACCEPT_ATTRIBUTE, baseNameOf, resolveMediaType } from "./media-types.js";
import { parseUploadMeta } from "./store.js";

/** Route prefix owned by this plugin. */
export const API_PREFIX = "/api/background-mural";

/** Upload ceiling when nothing else is configured: 512 MiB. */
export const DEFAULT_MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/** Refuse to start an upload that would push the library past this: 8 GiB. */
export const DEFAULT_MAX_LIBRARY_BYTES = 8 * 1024 * 1024 * 1024;

/** Shape of the persisted settings record. */
export const MURAL_SETTINGS_SCHEMA = {
  type: "object",
  properties: {
    /** Master switch: when off, nothing is painted and no media is fetched. */
    enabled: { type: "boolean", default: true },
    /** Id of the active library entry, `""` for none. */
    activeId: { type: "string", default: "" },
    /** How the media fills the viewport. */
    fit: { type: "string", enum: ["cover", "contain", "fill", "tile"], default: "cover" },
    /** Video playback style. */
    playback: { type: "string", enum: ["loop", "once", "static"], default: "loop" },
    /** Scrim strength painted over the media, 0-100. */
    dim: { type: "number", min: 0, max: 90, default: 30 },
    /** Backdrop blur radius in px, 0-60. */
    blur: { type: "number", min: 0, max: 60, default: 0 },
    /** Media opacity, 0-100. */
    opacity: { type: "number", min: 0, max: 100, default: 100 },
    /** Horizontal focal point, 0-100 (used with `cover`). */
    focusX: { type: "number", min: 0, max: 100, default: 50 },
    /** Vertical focal point, 0-100 (used with `cover`). */
    focusY: { type: "number", min: 0, max: 100, default: 50 },
    /** Video sound. */
    sound: { type: "boolean", default: false },
    /** Video volume, 0-100. */
    volume: { type: "number", min: 0, max: 100, default: 40 },
    /** Pause a playing video while the window/tab is hidden. */
    pauseOnHidden: { type: "boolean", default: true },
    /** Paint a readability scrim at the top and bottom edges. */
    vignette: { type: "boolean", default: true },
    /** Read the repository manifest once after mounting and offer a newer build. */
    autoCheckUpdate: { type: "boolean", default: true },
    /** Version the user dismissed with "do not remind me again", `""` for none. */
    skipUpdateVersion: { type: "string", default: "" },
    /** How much of the shell's own chrome fill survives, 0-100. */
    surfaceStrength: { type: "number", min: 0, max: 100, default: 100 },
    /** Frosted blur applied to the chrome surfaces, 0-40 px. */
    surfaceBlur: { type: "number", min: 0, max: 40, default: 14 },
    /** Extra scrim added in the light theme only, 0-40. */
    lightThemeDim: { type: "number", min: 0, max: 40, default: 15 },
    /** Upload ceiling in bytes. */
    maxUploadBytes: { type: "number", min: 1048576, default: DEFAULT_MAX_UPLOAD_BYTES },
    /** Library capacity ceiling in bytes. */
    maxLibraryBytes: { type: "number", min: 1048576, default: DEFAULT_MAX_LIBRARY_BYTES }
  }
};

/** Clamp a numeric setting into range, falling back to the default. */
function clampNumber(value, min, max, fallback) {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

/** Normalize one settings record into the exact shape the routes and client expect. */
export function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === "object" ? raw : {};
  const fit = String(source.fit ?? "cover");
  const playback = String(source.playback ?? "loop");
  return {
    enabled: source.enabled !== false,
    activeId: typeof source.activeId === "string" ? source.activeId : "",
    fit: ["cover", "contain", "fill", "tile"].includes(fit) ? fit : "cover",
    playback: ["loop", "once", "static"].includes(playback) ? playback : "loop",
    dim: clampNumber(source.dim, 0, 90, 30),
    blur: clampNumber(source.blur, 0, 60, 0),
    opacity: clampNumber(source.opacity, 0, 100, 100),
    focusX: clampNumber(source.focusX, 0, 100, 50),
    focusY: clampNumber(source.focusY, 0, 100, 50),
    sound: source.sound === true,
    volume: clampNumber(source.volume, 0, 100, 40),
    pauseOnHidden: source.pauseOnHidden !== false,
    vignette: source.vignette !== false,
    autoCheckUpdate: source.autoCheckUpdate !== false,
    skipUpdateVersion: typeof source.skipUpdateVersion === "string" ? source.skipUpdateVersion : "",
    surfaceStrength: clampNumber(source.surfaceStrength, 0, 100, 100),
    surfaceBlur: clampNumber(source.surfaceBlur, 0, 40, 14),
    lightThemeDim: clampNumber(source.lightThemeDim, 0, 40, 15),
    maxUploadBytes: clampNumber(source.maxUploadBytes, 1048576, Number.MAX_SAFE_INTEGER, DEFAULT_MAX_UPLOAD_BYTES),
    maxLibraryBytes: clampNumber(source.maxLibraryBytes, 1048576, Number.MAX_SAFE_INTEGER, DEFAULT_MAX_LIBRARY_BYTES)
  };
}

/** Public JSON projection of one library entry (never leaks the absolute path). */
export function entryToJson(entry) {
  const out = {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    ext: entry.ext,
    mime: entry.mime,
    size: Number(entry.size ?? 0),
    createdAt: Number(entry.createdAt ?? 0),
    url: `${API_PREFIX}/media/${entry.id}`
  };
  if (entry.width !== undefined) out.width = entry.width;
  if (entry.height !== undefined) out.height = entry.height;
  if (entry.durationMs !== undefined) out.durationMs = entry.durationMs;
  if (entry.adopted === true) out.adopted = true;
  return out;
}

/** Shallow-merge a patch onto the current settings, then normalize. */
export function mergeSettings(current, patch) {
  const base = normalizeSettings(current);
  if (patch === null || typeof patch !== "object") return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key in MURAL_SETTINGS_SCHEMA.properties) merged[key] = value;
  }
  return normalizeSettings(merged);
}

/** Read the request URL relative to the local origin. */
function requestUrl(req) {
  return new URL(typeof req.url === "string" && req.url !== "" ? req.url : "/", "http://localhost");
}

/** Decode one segment of a path, tolerating malformed percent escapes. */
function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The trailing path segment of a request, decoded.
 *
 * The webserver may or may not strip a prefix route's path before dispatching,
 * so the id is read from the end of the path instead of by offset: ids never
 * contain a slash, which makes this stable under either dispatch style.
 */
function lastSegment(req) {
  const segments = requestUrl(req).pathname.split("/").filter((part) => part !== "");
  return decodeSegment(segments[segments.length - 1] ?? "");
}

/** Decode a base64url header/query value into a UTF-8 string. */
function decodeBase64Url(value) {
  if (typeof value !== "string" || value === "") return "";
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Build the route family.
 * @param deps - `{ store, baseConfig, onRetain, getConfig, logger }`.
 */
export function makeMuralRoutes(deps) {
  const store = deps.store;
  const baseConfig = deps.baseConfig ?? {};
  const readConfig = () => normalizeSettings(typeof deps.getConfig === "function" ? deps.getConfig() : baseConfig);
  const onRetain = typeof deps.onRetain === "function" ? deps.onRetain : () => {};
  const log = typeof deps.logger === "function" ? deps.logger : () => {};
  // Runtime compatibility, decided by the host half. Reported on every read so
  // the panel can refuse to paint instead of guessing at a shell that moved.
  const runtime = deps.runtime ?? { supported: true, version: "", reason: "" };

  /** Drop an active id whose entry no longer exists, so the UI cannot wedge. */
  const reconcileActive = (config) => {
    if (config.activeId === "") return config;
    if (store.get(config.activeId) !== null) return config;
    onRetain({ ...config, activeId: "" });
    return { ...config, activeId: "" };
  };

  const overviewHandler = (req, res) => {
    if (req.method !== "GET") {
      json(res, 405, { ok: false, error: "method-not-allowed" });
      return;
    }
    if (!requireSameOrigin(req, res)) return;
    const config = reconcileActive(readConfig());
    json(res, 200, {
      ok: true,
      config,
      runtime,
      accept: ACCEPT_ATTRIBUTE,
      capabilities: { rangeRequests: true, video: true, images: true, serverSideTranscode: false },
      library: { ...store.describe(), maxBytes: config.maxLibraryBytes },
      items: store.list().map(entryToJson)
    });
  };

  const configHandler = async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    if (req.method === "GET") {
      json(res, 200, { ok: true, config: reconcileActive(readConfig()) });
      return;
    }
    if (req.method !== "PATCH" && req.method !== "POST") {
      json(res, 405, { ok: false, error: "method-not-allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const next = mergeSettings(readConfig(), body);
      onRetain(next);
      json(res, 200, { ok: true, config: next });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, message === "body-too-large" ? 413 : 400, { ok: false, error: message });
    }
  };

  const mediaHandler = (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      json(res, 405, { ok: false, error: "method-not-allowed" });
      return;
    }
    if (!requireSameOrigin(req, res)) return;
    const id = lastSegment(req);
    const entry = store.get(id);
    if (entry === null) {
      json(res, 404, { ok: false, error: "not-found" });
      return;
    }
    const abs = store.absolutePath(entry);
    if (abs === null) {
      json(res, 404, { ok: false, error: "not-found" });
      return;
    }
    serveFile(abs, req, res, entry.mime);
  };

  const uploadHandler = async (req, res) => {
    if (req.method !== "POST") {
      json(res, 405, { ok: false, error: "method-not-allowed" });
      return;
    }
    if (!requireSameOrigin(req, res)) return;
    if (runtime.supported === false) {
      // Refuse to paint on an unverified runtime rather than risk hiding a
      // control the user needs. The panel shows the reason instead.
      json(res, 503, { ok: false, error: "dsh-runtime-unsupported", runtime });
      return;
    }
    const config = readConfig();
    const fileName = decodeBase64Url(req.headers["x-mural-name"]);
    const resolved = resolveMediaType(req.headers["content-type"], fileName);
    if (resolved === null) {
      json(res, 415, { ok: false, error: "unsupported-media-type" });
      return;
    }
    if (store.totalBytes() >= config.maxLibraryBytes) {
      json(res, 413, { ok: false, error: "library-full" });
      return;
    }
    const query = requestUrl(req).searchParams;
    let displayName = baseNameOf(decodeBase64Url(query.get("name") ?? ""));
    if (displayName === "") displayName = baseNameOf(fileName);
    let result;
    try {
      result = await store.acceptUpload(req, {
        kind: resolved.kind,
        ext: resolved.ext,
        mime: resolved.mime,
        name: displayName,
        maxBytes: config.maxUploadBytes,
        meta: parseUploadMeta(req.headers["x-mural-meta"])
      });
    } catch (error) {
      // Never let a storage fault escape as an unhandled rejection: the client
      // would sit on a progress bar that never resolves.
      log(`upload failed: ${error instanceof Error ? error.message : String(error)}`);
      json(res, 500, { ok: false, error: "store-failed" });
      return;
    }
    if (!result.ok) {
      log(`upload rejected: ${result.error}`);
      json(res, result.status, { ok: false, error: result.error });
      return;
    }
    json(res, 201, { ok: true, item: entryToJson(result.entry), library: store.describe() });
  };

  const itemHandler = (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const id = lastSegment(req);
    if (req.method === "DELETE") {
      if (!store.remove(id)) {
        json(res, 404, { ok: false, error: "not-found" });
        return;
      }
      const config = readConfig();
      if (config.activeId === id) onRetain({ ...config, activeId: "" });
      json(res, 200, { ok: true, library: store.describe() });
      return;
    }
    json(res, 405, { ok: false, error: "method-not-allowed" });
  };

  const orphansHandler = (req, res) => {
    if (req.method !== "POST") {
      json(res, 405, { ok: false, error: "method-not-allowed" });
      return;
    }
    if (!requireSameOrigin(req, res)) return;
    const before = store.totalBytes();
    store.reconcile();
    store.save();
    const config = reconcileActive(readConfig());
    json(res, 200, {
      ok: true,
      config,
      library: { ...store.describe(), reclaimedBytes: Math.max(0, before - store.totalBytes()) }
    });
  };

  return [
    { kind: "exact", path: `${API_PREFIX}/overview`, handler: overviewHandler },
    { kind: "exact", path: `${API_PREFIX}/config`, handler: configHandler },
    { kind: "exact", path: `${API_PREFIX}/upload`, handler: uploadHandler },
    { kind: "exact", path: `${API_PREFIX}/orphans`, handler: orphansHandler },
    { kind: "prefix", path: `${API_PREFIX}/media`, handler: mediaHandler },
    { kind: "prefix", path: `${API_PREFIX}/item`, handler: itemHandler }
  ];
}
