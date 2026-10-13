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
import { dirname, join } from "node:path";
import { MURAL_SETTINGS_SCHEMA, makeMuralRoutes, normalizeSettings } from "./routes.js";
import { MuralStore, defaultStoreRoot } from "./store.js";

/** Stable cordis plugin name (matches the `cordis.patch.yml` insert id). */
export const name = "background-mural";

/** Services required before the routes can mount. */
export const inject = ["webServer"];

/** Settings namespace owned by this plugin. */
export const SETTINGS_NAMESPACE = "background-mural";

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

  const routes = makeMuralRoutes({
    store,
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
