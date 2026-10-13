/**
 * Mural host half.
 *
 * Registers the media routes and persists the background settings. Route
 * registration failures are logged, never thrown: a broken plugin must not be
 * able to take the whole GUI down at boot.
 *
 * Settings persistence has two layers. When the official settings service is
 * available the record is registered there (so it lives in the DSH settings
 * store like every other plugin). When it is not — a trimmed runtime, or a DSH
 * version that moved the service — the same record is written to
 * `<DSH_HOME>/background-mural/settings.json` instead, which keeps the plugin
 * fully functional rather than silently forgetting the user's background.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { MURAL_SETTINGS_SCHEMA, makeMuralRoutes, normalizeSettings } from "./routes.js";
import { MuralStore, defaultStoreRoot } from "./store.js";

/** Stable cordis plugin name (matches the `cordis.patch.yml` insert id). */
export const name = "background-mural";

/** Services required before the routes can mount. */
export const inject = ["webServer"];

/** Settings namespace owned by this plugin. */
export const SETTINGS_NAMESPACE = "background-mural";

/**
 * The DSH runtime range this build was written against.
 *
 * Kept in sync with `dsh.engines.dsh` in package.json. The plugin reaches into
 * the shell's design tokens and paints over its chrome, so a runtime that moved
 * those tokens could leave the interface harder to read instead of prettier —
 * which is exactly the class of bug this plugin has already shipped once. When
 * the runtime falls outside the range the host half says so on every route and
 * the panel refuses to paint, rather than guessing.
 */
export const SUPPORTED_DSH_RANGE = ">=0.1.1-rc.1 <0.3.0-0";

/** The runtime version, read from the installed package without importing it. */
function readDshVersion() {
  try {
    const require = createRequire(import.meta.url);
    const manifest = require("@deepseek-ai/dsh/package.json");
    return typeof manifest?.version === "string" ? manifest.version : "";
  } catch {
    return "";
  }
}

/** Split a version into comparable numeric parts, ignoring any prerelease tag. */
function versionParts(value) {
  const core = String(value ?? "").trim().split("-")[0];
  const parts = core.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts;
}

/** Compare two dotted versions: `1`, `-1`, `0`, or `null` when unparsable. */
function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  if (left === null || right === null) return null;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

/**
 * Check one `>=x <y` style range.
 *
 * Deliberately minimal: this plugin only needs to express "these major.minor
 * lines", and an unparsable bound is treated as satisfied so a future range
 * syntax can never lock a user out of their own background.
 */
export function satisfiesRange(version, range) {
  const parts = String(range ?? "").trim().split(/\s+/).filter((part) => part !== "");
  if (parts.length === 0) return true;
  for (const part of parts) {
    const match = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(part);
    if (match === null) continue;
    const operator = match[1] ?? "=";
    const order = compareVersions(version, match[2]);
    if (order === null) continue;
    if (operator === ">=" && order < 0) return false;
    if (operator === ">" && order <= 0) return false;
    if (operator === "<=" && order > 0) return false;
    if (operator === "<" && order >= 0) return false;
    if (operator === "=" && order !== 0) return false;
  }
  return true;
}

/** Whether this build may paint over the running shell. */
export function isRuntimeSupported() {
  const version = readDshVersion();
  // An unreadable runtime is not evidence of an incompatible one.
  if (version === "") return { supported: true, version: "", reason: "unknown-runtime" };
  return { supported: satisfiesRange(version, SUPPORTED_DSH_RANGE), version, reason: "" };
}

/** Persist the settings record by hand, atomically. */
function writeSettingsFile(file, value) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** Read the hand-persisted settings record, tolerating any corruption. */
function readSettingsFile(file) {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return raw !== null && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/**
 * Try to hand persistence to the official settings service.
 * @returns `true` when the service took ownership of the record.
 */
async function tryInstallOfficialSettings(ctx) {
  let ns;
  let installSettingsSection;
  try {
    const mod = await import("@deepseek-ai/dsh-settings");
    installSettingsSection = mod.installSettingsSection;
    ns = mod.settingsNamespace(SETTINGS_NAMESPACE);
  } catch {
    return false;
  }
  if (typeof installSettingsSection !== "function") return false;
  try {
    installSettingsSection(ctx, ns, MURAL_SETTINGS_SCHEMA, {}, { setSource: () => {}, onChange: () => {} });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mount Mural's routes.
 * @param ctx - the host plugin context.
 */
export function apply(ctx) {
  const store = new MuralStore(defaultStoreRoot());
  try {
    store.load();
  } catch (error) {
    console.error("[background-mural] media library load failed:", error);
  }

  const settingsFile = join(store.root, "settings.json");
  /** Single source of truth for the settings record. */
  let settings = normalizeSettings(readSettingsFile(settingsFile));
  const retain = (next) => {
    settings = normalizeSettings(next);
    writeSettingsFile(settingsFile, settings);
  };

  // Upgrade to the official settings store when it is present; the file stays
  // the fallback and keeps holding the last known value.
  tryInstallOfficialSettings(ctx)
    .then((installed) => {
      if (installed) console.info("[background-mural] settings registered with the DSH settings service");
    })
    .catch(() => {});

  const runtime = isRuntimeSupported();
  if (runtime.supported === false) {
    console.warn(
      `[background-mural] DSH ${runtime.version} is outside the supported range ${SUPPORTED_DSH_RANGE}; ` +
        "painting stays off so the stock interface is preserved. Update the plugin, or pick a background again after it declares this runtime."
    );
  }

  const routes = makeMuralRoutes({
    store,
    runtime,
    getConfig: () => settings,
    onRetain: retain,
    logger: (message) => console.warn(`[background-mural] ${message}`)
  });

  try {
    ctx.effect(() => {
      const disposers = [];
      try {
        for (const route of routes) disposers.push(ctx.webServer.register(route));
      } catch (error) {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {
            /* nothing left to release */
          }
        }
        throw error;
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {
            /* nothing left to release */
          }
        }
      };
    }, "background-mural: routes");
  } catch (error) {
    console.error("[background-mural] route registration failed:", error);
  }

  if (existsSync(store.root)) {
    console.info(`[background-mural] media library ready at ${store.root} (${String(store.list().length)} item(s))`);
  }
}

export { MURAL_SETTINGS_SCHEMA, makeMuralRoutes, normalizeSettings } from "./routes.js";
export { MuralStore, defaultStoreRoot, resolveDshHome } from "./store.js";
