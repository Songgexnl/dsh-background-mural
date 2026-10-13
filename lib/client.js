window.__ModuleLoader__.load({
  id: "dsh-background-mural",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // Only `react` is required directly: elements are built with
    // `React.createElement`, so no JSX runtime dependency is needed.
    var React = require("react");

    /**
     * Mural — browser half.
     *
     * Two halves live in this bundle, sharing one settings store:
     *
     * 1. A renderer that owns the background layers. Pure DOM (no React in the
     *    paint path), so a playing video never re-renders the GUI.
     * 2. A settings panel that talks to the host routes and drives the store.
     *
     * Both are written against the same HTTP contract, which is why the plugin
     * behaves identically in the DSH desktop app and in a browser: neither half
     * touches the filesystem or Node APIs.
     */

    //#region constants

    /** Route prefix owned by the host half. */
    const API = "/api/background-mural";

    /**
     * Where the live manifest is read from, for the in-panel update check.
     *
     * DSH's plugin manager does have a "check for updates" flow, but it resolves
     * the latest version through an npm registry. This plugin is installed from a
     * git spec (and will be unregistered while it is unpublished), so that check
     * cannot see new commits — GitHub is the only place that knows. A raw manifest
     * read is therefore the honest source here, and the button tells the user the
     * exact command instead of pretending it can reinstall itself.
     */
    const MANIFEST_URL = "https://raw.githubusercontent.com/Songgexnl/dsh-background-mural/main/package.json";

    /** Installed version, so the panel can show what is running. */
    const INSTALLED_VERSION = "0.1.4";

    /** Update checks are cached this long, so reopening the panel does not refetch. */
    const UPDATE_CACHE_MS = 6 * 60 * 60 * 1000;

    /**
     * The chrome surfaces this plugin repaints, one row per shell region.
     *
     * Every token here is one the official stylesheet actually paints, and all of
     * them are declared on `body` or simply inherited, which is what makes
     * repainting them inline reliable:
     *
     *   sidebar      `.BynINW_sidebarCol` and the sidebar component root
     *   composer     `.RlGAzG_card` — the input card
     *   menu         elevated panels, `backdrop-filter: var(--dsw-menu-backdrop-filter)`
     *   user bubble  `.cJsG2q_bubble`
     *
     * `keep` is the share of the shell's own opacity that survives at full
     * strength. The composer and the sidebar keep more than the rest because they
     * hold type the user reads constantly; a bubble can afford to be lighter.
     */
    const SURFACE_TOKENS = [
      { token: "--dsw-specific-sidebar-fill", keep: 1 },
      { token: "--dsw-specific-input-major", keep: 1 },
      { token: "--dsw-specific-menu", keep: 1 },
      { token: "--dsw-specific-bubble", keep: 0.9 },
      { token: "--dsw-specific-bubble-highlight", keep: 0.9 }
    ];

    /** Attribute stamped on <body> while the plugin is mounted. */
    const BODY_ATTR = "data-dsh-mural";

    /** Marker attribute on every element this plugin creates. */
    const OWNED = "data-dsh-mural-owned";

    /** Element ids, one place to read the layer stack from. */
    const ID = {
      root: "dsh-mural-root",
      media: "dsh-mural-media",
      scrim: "dsh-mural-scrim",
      vignette: "dsh-mural-vignette",
      layers: "dsh-mural-layers-css",
      panel: "dsh-mural-panel-css"
    };

    /** Defaults mirror `MURAL_SETTINGS_SCHEMA` in the host half. */
    const DEFAULT_CONFIG = {
      enabled: true,
      activeId: "",
      fit: "cover",
      playback: "loop",
      dim: 30,
      blur: 0,
      opacity: 100,
      focusX: 50,
      focusY: 50,
      sound: false,
      volume: 40,
      pauseOnHidden: true,
      vignette: true,
      surfaceStrength: 100,
      surfaceBlur: 14,
      lightThemeDim: 15,
      maxUploadBytes: 512 * 1024 * 1024,
      maxLibraryBytes: 8 * 1024 * 1024 * 1024
    };

    const FIT_OPTIONS = ["cover", "contain", "fill", "tile"];
    const PLAYBACK_OPTIONS = ["loop", "once", "static"];

    /** How long the first video frame is awaited before falling back to playback. */
    const POSTER_TIMEOUT_MS = 4000;

    //#endregion

    //#region i18n

    const DICTIONARIES = {
      zh: {
        title: "背景壁画",
        tagline: "上传图片或视频，作为整个界面的背景",
        master: "启用背景",
        masterHint: "关闭后立即停止绘制，也不再请求任何媒体",
        library: "素材库",
        empty: "素材库还是空的，先上传一张图片或一段视频吧",
        upload: "上传图片 / 视频",
        uploading: "上传中…",
        dropHint: "点击选择，或把文件拖到这里",
        acceptHint: "支持 JPG / PNG / GIF / WebP / AVIF / BMP / SVG 与 MP4 / WebM / OGV / MOV",
        use: "设为背景",
        inUse: "使用中",
        clear: "清除背景",
        remove: "删除",
        removeConfirm: "再点一次确认",
        appearance: "外观",
        fit: "填充方式",
        fitCover: "裁切铺满",
        fitContain: "完整显示",
        fitFill: "拉伸铺满",
        fitTile: "平铺",
        dim: "压暗程度",
        blur: "背景模糊",
        opacity: "不透明度",
        focusX: "水平焦点",
        focusY: "垂直焦点",
        vignette: "边缘暗角",
        surfaceStrength: "界面底色",
        surfaceBlur: "界面磨砂",
        surfaceHint: "同时作用于侧边栏、输入栏、消息气泡和弹出面板：底色越浓、磨砂越强，文字越清楚，画面透出的越少。0 = 完全透明（画面最完整，也最考验可读性）。",
        incompatible: "当前 DSH 版本不在本插件声明支持的范围内，已暂停绘制以保住原生界面。更新插件后再试。",
        lightThemeDim: "浅色主题额外压暗",
        lightThemeDimHint: "只用浅色主题时生效。浅色界面比深色更容易被画面淹没，这里额外加深一层黑纱。",
        video: "视频",
        playback: "播放方式",
        playbackLoop: "循环播放",
        playbackOnce: "播放一次",
        playbackStatic: "只显示首帧",
        sound: "开启声音",
        volume: "音量",
        pauseOnHidden: "窗口隐藏时暂停",
        diagnostics: "诊断",
        libraryPath: "素材库位置",
        apiHealth: "接口连通性",
        codecSupport: "视频编码支持",
        refresh: "重新检测",
        versionLabel: "版本",
        checkUpdate: "检查更新",
        checkingUpdate: "检查中…",
        upToDate: "已是最新版本",
        updateAvailable: "有新版 {version}",
        updateHint: "从仓库拉取并重装：",
        updateCopied: "命令已复制",
        updateCopy: "复制更新命令",
        updateFailed: "无法读取仓库版本（可能是网络问题）",
        files: "个文件",
        reload: "重新载入素材库",
        uploadFailed: "上传失败",
        loadFailed: "无法读取素材库，请检查后台日志",
        tooLarge: "文件超过上限",
        unsupported: "不支持的文件类型",
        full: "素材库空间不足",
        ok: "正常",
        bad: "不可用",
        kindImage: "图片",
        kindVideo: "视频",
        rangeLabel: "Range 请求"
      },
      en: {
        title: "Mural",
        tagline: "Upload an image or video and paint it behind the whole interface",
        master: "Enable background",
        masterHint: "Turns off painting and stops every media request immediately",
        library: "Library",
        empty: "The library is empty — upload an image or a video to begin",
        upload: "Upload image / video",
        uploading: "Uploading…",
        dropHint: "Click to choose, or drop a file here",
        acceptHint: "JPG / PNG / GIF / WebP / AVIF / BMP / SVG and MP4 / WebM / OGV / MOV",
        use: "Use as background",
        inUse: "In use",
        clear: "Clear background",
        remove: "Delete",
        removeConfirm: "Click again to confirm",
        appearance: "Appearance",
        fit: "Fit",
        fitCover: "Cover",
        fitContain: "Contain",
        fitFill: "Stretch",
        fitTile: "Tile",
        dim: "Dim",
        blur: "Background blur",
        opacity: "Opacity",
        focusX: "Focus X",
        focusY: "Focus Y",
        vignette: "Edge vignette",
        surfaceStrength: "Chrome opacity",
        surfaceBlur: "Chrome frosted blur",
        surfaceHint: "Applies to the sidebar, the composer, message bubbles and pop-up panels at once. More opacity and blur means clearer text and less wallpaper showing through. 0 is fully transparent - the most picture, and the hardest to read.",
        incompatible: "This DSH version is outside the range this build declares support for, so painting is paused to keep the stock interface intact. Update the plugin and try again.",
        lightThemeDim: "Extra dim in light theme",
        lightThemeDimHint: "Applies only while the light theme is active. Light chrome is swallowed by a picture far more easily than dark chrome, so this adds an extra scrim on top.",
        video: "Video",
        playback: "Playback",
        playbackLoop: "Loop",
        playbackOnce: "Play once",
        playbackStatic: "First frame only",
        sound: "Sound on",
        volume: "Volume",
        pauseOnHidden: "Pause while hidden",
        diagnostics: "Diagnostics",
        libraryPath: "Library location",
        apiHealth: "API health",
        codecSupport: "Video codec support",
        refresh: "Re-check",
        versionLabel: "Version",
        checkUpdate: "Check for updates",
        checkingUpdate: "Checking…",
        upToDate: "Up to date",
        updateAvailable: "New version {version}",
        updateHint: "Pull and reinstall from the repository:",
        updateCopied: "Command copied",
        updateCopy: "Copy update command",
        updateFailed: "Could not read the repository version (network?)",
        files: "file(s)",
        reload: "Reload library",
        uploadFailed: "Upload failed",
        loadFailed: "Could not read the library — check the host logs",
        tooLarge: "File exceeds the size limit",
        unsupported: "Unsupported file type",
        full: "Library capacity reached",
        ok: "ok",
        bad: "unavailable",
        kindImage: "image",
        kindVideo: "video",
        rangeLabel: "Range requests"
      }
    };

    /** Resolved dictionary, keyed off the browser locale once. */
    let activeDictionary = null;
    /** Translate one key. */
    function tr(key) {
      if (activeDictionary === null) {
        const language = String(
          (typeof navigator !== "undefined" && (navigator.language || navigator.userLanguage)) || "en"
        ).toLowerCase();
        activeDictionary = language.startsWith("zh") ? DICTIONARIES.zh : DICTIONARIES.en;
      }
      return activeDictionary[key] ?? key;
    }

    //#endregion

    //#region helpers

    /**
     * Compare two dotted numeric versions.
     * @returns `1` when `a` is newer, `-1` when older, `0` when equal, `null`
     *   when either side is not a plain numeric version. `null` must be treated
     *   as "cannot tell", never as "up to date" — a prerelease tag would
     *   otherwise silently report the plugin as current.
     */
    function compareVersions(a, b) {
      const left = String(a ?? "").split(".").map((part) => Number.parseInt(part, 10));
      const right = String(b ?? "").split(".").map((part) => Number.parseInt(part, 10));
      if (left.length === 0 || right.length === 0) return null;
      if (left.some((part) => !Number.isFinite(part)) || right.some((part) => !Number.isFinite(part))) return null;
      for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        const l = left[index] ?? 0;
        const r = right[index] ?? 0;
        if (l > r) return 1;
        if (l < r) return -1;
      }
      return 0;
    }

    /** Memoized remote version lookup, so reopening the panel does not refetch. */
    let updateCache = null;

    /**
     * Read the live version from the repository.
     * @returns `{ latest, error }` — `latest` is `""` when it could not be read.
     */
    async function fetchLatestVersion(force) {
      if (!force && updateCache !== null && Date.now() - updateCache.at < UPDATE_CACHE_MS) return updateCache.value;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller === null ? null : setTimeout(() => controller.abort(), 12000);
      let value;
      try {
        const response = await fetch(`${MANIFEST_URL}?t=${String(Date.now())}`, {
          headers: { accept: "application/json" },
          signal: controller === null ? undefined : controller.signal
        });
        if (!response.ok) throw new Error(`http-${String(response.status)}`);
        const body = await response.json();
        if (body === null || typeof body.version !== "string" || body.version === "") throw new Error("no-version");
        value = { latest: body.version, error: "" };
      } catch (error) {
        value = { latest: "", error: error instanceof Error ? error.message : String(error) };
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
      updateCache = { at: Date.now(), value };
      return value;
    }

    /** Human-readable byte size. */
    function formatBytes(bytes) {
      const value = Number(bytes ?? 0);
      if (!Number.isFinite(value) || value <= 0) return "0 B";
      const units = ["B", "KB", "MB", "GB", "TB"];
      let index = 0;
      let scaled = value;
      while (scaled >= 1024 && index < units.length - 1) {
        scaled /= 1024;
        index += 1;
      }
      const digits = scaled >= 100 || index === 0 ? 0 : 1;
      return `${scaled.toFixed(digits)} ${units[index]}`;
    }

    /** Human-readable duration. */
    function formatDuration(ms) {
      const total = Math.round(Number(ms ?? 0) / 1000);
      if (!Number.isFinite(total) || total <= 0) return "";
      return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;
    }

    /** Clamp a number into range. */
    function clamp(value, min, max) {      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return min;
      return Math.min(max, Math.max(min, numeric));
    }

    /** base64url of a UTF-8 string, for carrying a file name in a header. */
    function encodeBase64Url(text) {
      const bytes = new TextEncoder().encode(String(text ?? ""));
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    /**
     * Resolve a relative route against this document.
     *
     * `document.baseURI` is the correct base: it is the document's own URL, and
     * it honours a `<base>` tag if the shell installs one. That keeps a DSH web
     * GUI served under a sub-path (a reverse proxy, a tunnel) able to reach the
     * host routes, which a plain relative fetch would miss.
     */
    function absoluteUrl(relative) {
      const route = String(relative ?? "");
      if (typeof document !== "undefined" && typeof document.baseURI === "string" && document.baseURI !== "") {
        try {
          return new URL(route.replace(/^\//, ""), document.baseURI).toString();
        } catch {
          /* fall through to the origin form */
        }
      }
      const path = new URL(route, "http://mural.local").pathname;
      const origin = typeof location !== "undefined" && location.origin ? location.origin : "";
      return `${origin}${path}`;
    }

    /** GET one JSON route with a bounded wait. */
    async function getJson(path, timeoutMs = 15000) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(absoluteUrl(path), {
          method: "GET",
          credentials: "same-origin",
          signal: controller === null ? undefined : controller.signal
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || body === null || body.ok !== true) {
          throw new Error((body && body.error) || `http-${String(response.status)}`);
        }
        return body;
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    }

    /** Send one JSON body. */
    async function sendJson(path, method, payload) {
      const response = await fetch(absoluteUrl(path), {
        method,
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload ?? {})
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body === null || body.ok !== true) {
        throw new Error((body && body.error) || `http-${String(response.status)}`);
      }
      return body;
    }

    /** Upload one File through XHR, so progress is observable and the body streams. */
    function uploadFile(file, onProgress) {
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", absoluteUrl(`${API}/upload`), true);
        request.setRequestHeader("content-type", file.type || "application/octet-stream");
        request.setRequestHeader("x-mural-name", encodeBase64Url(file.name || ""));
        request.upload.addEventListener("progress", (event) => {
          if (typeof onProgress !== "function") return;
          if (typeof event.total === "number" && event.total > 0) onProgress(event.loaded / event.total);
        });
        request.addEventListener("error", () => reject(new Error("network-error")));
        request.addEventListener("abort", () => reject(new Error("aborted")));
        request.addEventListener("load", () => {
          let body = null;
          try {
            body = JSON.parse(request.responseText);
          } catch {
            body = null;
          }
          if (request.status >= 200 && request.status < 300 && body !== null && body.ok === true) {
            resolve(body);
            return;
          }
          reject(new Error((body && body.error) || `http-${String(request.status)}`));
        });
        request.send(file);
      });
    }

    /** Map a transport error onto a localized message. */
    function uploadErrorMessage(error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code === "payload-too-large") return tr("tooLarge");
      if (code === "unsupported-media-type" || code === "content-type-mismatch") return tr("unsupported");
      if (code === "library-full") return tr("full");
      return `${tr("uploadFailed")}：${code}`;
    }

    //#endregion

    //#region config store

    /**
     * The single settings store, shared by the renderer and the panel.
     *
     * It also owns the media metadata map, because the renderer's paint path
     * resolves the active id to an item and must never touch React state.
     */
    class ConfigStore {
      constructor() {
        this.value = { ...DEFAULT_CONFIG };
        this.items = new Map();
        this.listeners = new Set();
        this.pending = new Map();
        this.flushScheduled = false;
        this.revision = 0;
      }

      /** Current settings snapshot. */
      get() {
        return this.value;
      }

      /** Metadata for one library id, or `null`. */
      item(id) {
        if (typeof id !== "string" || id === "") return null;
        return this.items.get(id) ?? null;
      }

      /** Bump the revision so the panel can recompute derived views. */
      bump() {
        this.revision += 1;
      }

      /** Subscribe to changes; returns the unsubscribe function. */
      subscribe(listener) {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      }

      /** Adopt a settings record coming from the host. */
      hydrate(next) {
        this.value = { ...DEFAULT_CONFIG, ...(next ?? {}) };
        this.bump();
        this.emit();
      }

      /** Adopt a library listing coming from the host. */
      hydrateItems(items) {
        this.items = new Map((Array.isArray(items) ? items : []).map((item) => [item.id, item]));
        this.bump();
        this.emit();
      }

      /**
       * Apply one field optimistically, then persist it.
       * @param key - settings field.
       * @param value - new value.
       * @param immediate - write now instead of debouncing.
       */
      set(key, value, immediate = false) {
        if (!(key in DEFAULT_CONFIG)) return;
        this.value = { ...this.value, [key]: value };
        this.bump();
        this.emit();
        this.pending.set(key, value);
        this.schedule(immediate ? 0 : 350);
      }

      /** Coalesce rapid edits (slider drags) into one request. */
      schedule(delay) {
        if (this.flushScheduled) return;
        this.flushScheduled = true;
        setTimeout(() => {
          this.flushScheduled = false;
          void this.flush();
        }, delay);
      }

      /** Persist every pending field in a single PATCH. */
      async flush() {
        if (this.pending.size === 0) return;
        const payload = Object.fromEntries(this.pending);
        const inFlight = new Set(this.pending.keys());
        this.pending.clear();
        try {
          const body = await sendJson(`${API}/config`, "PATCH", payload);
          if (body === null || body.config === null || body.config === undefined) return;
          // Adopt server-normalized values, except for any field the user has
          // edited since this request left: a late response must never fight
          // the slider that is being dragged right now.
          const merged = { ...this.value };
          for (const [key, value] of Object.entries(body.config)) {
            if (inFlight.has(key) && this.pending.has(key)) continue;
            merged[key] = value;
          }
          this.value = { ...DEFAULT_CONFIG, ...merged };
          this.bump();
          this.emit();
        } catch (error) {
          console.warn("[background-mural] settings write failed:", error);
        }
      }

      /** Notify every subscriber, isolating listener failures. */
      emit() {
        for (const listener of [...this.listeners]) {
          try {
            listener(this.value);
          } catch (error) {
            console.error("[background-mural] listener failed:", error);
          }
        }
      }
    }

    //#endregion

    //#region renderer
    /* Mural background layers. */

    /**
     * Convert a resolved `rgb()` / `rgba()` color into an rgba() string.
     *
     * The sidebar token is repainted with the *current* theme color at a lowish
     * alpha rather than cleared outright: a sidebar exactly as transparent as the
     * conversation area stops reading as a panel, and the official shell relies on
     * the fill to separate the two.
     */
    const withAlpha = (color, alpha) => {
      const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(String(color ?? "").trim());
      if (match === null) return "rgba(0, 0, 0, 0.42)";
      return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${String(alpha)})`;
    };

    /** Parse a resolved `rgb()` / `rgba()` string, or `null`. */
    function readColor(color) {
      const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/i.exec(
        String(color ?? "").trim()
      );
      if (match === null) return null;
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
        a: match[4] === undefined ? 1 : Number(match[4])
      };
    }

    /**
     * Blend one resolved color toward another by `amount` (0..1).
     *
     * Used to rebuild a surface's hover / raised variants: the shell writes those
     * as opaque colors, and re-deriving them from the surface's own base keeps a
     * translucent chrome coherent in both palettes instead of snapping back to the
     * stock tone on hover.
     */
    function mixColor(color, target, amount) {
      const from = readColor(color);
      const to = readColor(target);
      if (from === null || to === null) return color;
      const t = clamp(amount, 0, 1);
      const blend = (a, b) => Math.round(a + (b - a) * t);
      const alpha = Number((from.a + (to.a - from.a) * t).toFixed(3));
      return `rgba(${String(blend(from.r, to.r))}, ${String(blend(from.g, to.g))}, ${String(blend(from.b, to.b))}, ${String(alpha)})`;
    }

    /**
     * Owns the background layers.
     *
     * Layers are created once and only restyled afterwards, so switching between
     * two images never churns the DOM the GUI itself lives in.
     */
    class MuralRenderer {
      constructor(store) {
        this.store = store;
        this.document = typeof document === "undefined" ? null : document;
        // The shell's own token values, snapshotted before the first repaint.
        this.originalTokens = Object.create(null);
        this.root = null;
        this.mediaHost = null;
        this.scrim = null;
        this.vignette = null;
        this.styleTag = null;
        this.currentId = null;
        this.mediaElement = null;
        this.posterUrl = null;
        this.posterPending = false;
        this.posterFailed = false;
        this.surfaceKey = null;
        this.unsubscribe = null;
        this.themeObserver = null;
        this.visibilityHandler = null;
        this.pausedForVisibility = false;
        this.disposed = false;
        this.failed = new Set();
      }

      /** Mount the layers and subscribe to the store. */
      start() {
        if (this.document === null || this.root !== null) return;
        this.mountStyle();
        this.mountLayers();
        this.unsubscribe = this.store.subscribe(() => this.sync());
        // The light-theme extra scrim depends on the shell's current palette, and
        // the user can switch themes without touching this plugin, so the scrim is
        // repainted when the attribute the theme presenter toggles changes.
        if (typeof MutationObserver === "function") {
          this.themeObserver = new MutationObserver(() => this.sync());
          this.themeObserver.observe(this.document.documentElement, {
            attributes: true,
            attributeFilter: ["data-ds-dark-theme"]
          });
          if (this.document.body !== null) {
            this.themeObserver.observe(this.document.body, {
              attributes: true,
              attributeFilter: ["data-ds-dark-theme"]
            });
          }
        }
        this.visibilityHandler = () => this.onVisibilityChange();
        this.document.addEventListener("visibilitychange", this.visibilityHandler);
        this.sync();
      }

      /** Tear everything down; the GUI must look untouched afterwards. */
      dispose() {
        this.disposed = true;
        if (this.themeObserver !== null) {
          this.themeObserver.disconnect();
          this.themeObserver = null;
        }
        if (this.unsubscribe !== null) this.unsubscribe();
        this.unsubscribe = null;
        if (this.visibilityHandler !== null && this.document !== null) {
          this.document.removeEventListener("visibilitychange", this.visibilityHandler);
        }
        this.visibilityHandler = null;
        this.releaseMedia();
        if (this.styleTag !== null) this.styleTag.remove();
        this.styleTag = null;
        if (this.root !== null) this.root.remove();
        this.root = null;
        this.mediaHost = null;
        this.scrim = null;
        this.vignette = null;
        if (this.document !== null) {
          // Hand the shell back its own inline styling verbatim.
          this.document.body.style.removeProperty("background");
          if (this.previousBodyBackground !== undefined && this.previousBodyBackground !== "") {
            this.document.body.style.background = this.previousBodyBackground;
          }
          // Every repainted token goes back to the shell's own declaration.
          for (const entry of SURFACE_TOKENS) this.document.body.style.removeProperty(entry.token);
          for (const token of [
            "--dsw-alias-interactive-bg-hover",
            "--dsw-alias-interactive-bg-hover-accent",
            "--dsw-alias-interactive-bg-hover-solid",
            "--dsw-alias-interactive-bg-active",
            "--dsw-alias-bg-layer-2",
            "--dsw-alias-bg-layer-3",
            "--dsw-menu-backdrop-filter"
          ]) {
            this.document.body.style.removeProperty(token);
          }
          delete this.document.body.dataset.dshMural;
        }
      }

      /**
       * The rules this plugin needs above its layers.
       *
       * Transparency is done at the design-token level, not by guessing internal
       * class names. The official shell paints `--dsw-alias-bg-base` on its frame
       * and center column and `--dsw-specific-sidebar-fill` on the sidebar and its
       * nested column, so while those hold opaque colors the wallpaper is simply
       * never visible — the shell covers it. Both tokens are part of the official
       * `--dsw-*` registry, and remapping them is exactly how community skins make
       * a background show through, so this stays on the supported surface.
       *
       * The body itself is cleared too: `--dsw-alias-bg-base` is declared ON
       * `body`, so an element rule alone would lose to the declaration on the body
       * for anything inheriting it.
       */
      mountStyle() {
        const existing = this.document.getElementById(ID.layers);
        if (existing !== null) existing.remove();
        const tag = this.document.createElement("style");
        tag.id = ID.layers;
        tag.setAttribute(OWNED, "");
        tag.textContent = [
          `body[${BODY_ATTR}]{background:transparent !important}`,
          `body[${BODY_ATTR}],body[${BODY_ATTR}] #root{--dsw-alias-bg-base:transparent}`,
          `body[${BODY_ATTR}] #${ID.root}{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;contain:strict}`,
          `body[${BODY_ATTR}] #${ID.media}{position:absolute;inset:0;overflow:hidden}`,
          `body[${BODY_ATTR}] #${ID.scrim}{position:absolute;inset:0}`,
          `body[${BODY_ATTR}] #${ID.vignette}{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.42),rgba(0,0,0,0) 18%,rgba(0,0,0,0) 76%,rgba(0,0,0,.5))}`,
          `body[${BODY_ATTR}] .dsh-mural-media-el{width:100%;height:100%;display:block;border:0}`
        ].join("\n");
        this.document.head.appendChild(tag);
        this.styleTag = tag;
        // `background` is set inline by the shell's boot/theme code, so it has to
        // be overridden inline as well; the previous value is kept for teardown.
        this.previousBodyBackground = this.document.body.style.background;
        this.document.body.style.setProperty("background", "transparent", "important");
      }

      /**
       * Repaint the shell's chrome surfaces against the live palette.
       *
       * The shell paints each region from its own `--dsw-*` token, so the plugin
       * reaches every region the same way: read the token's real value, put the
       * same color back at a lower alpha, and let the wallpaper read through. Only
       * tokens the shell itself paints on `body` are touched, and each is re-read
       * from the live palette first, so light and dark both stay correct without
       * any hard-coded colors.
       *
       * The values are applied inline on `body` because that is where the shell
       * declares them; an element rule of equal specificity would otherwise lose.
       */
      applySurface(config) {
        if (this.document === null) return;
        const body = this.document.body;

        if (config.enabled === false) {
          // Master switch off: hand every surface straight back, so "disabled"
          // really means the GUI as it shipped.
          for (const entry of SURFACE_TOKENS) body.style.removeProperty(entry.token);
          body.style.removeProperty("background");
          this.surfaceKey = null;
          return;
        }

        body.style.setProperty("background", "transparent", "important");

        const surfaces = clamp(config.surfaceStrength, 0, 100) / 100;
        const blur = clamp(config.surfaceBlur, 0, 40);
        const key = `${String(surfaces)}|${String(blur)}|${this.isDarkTheme() ? "dark" : "light"}`;
        // Skip the work when nothing changed: sync() runs on every store
        // notification, including slider drags on unrelated fields.
        if (this.surfaceKey === key) return;
        this.surfaceKey = key;

        // The shell's own value for every token is read once, before anything is
        // repainted. Reading it again later would return this plugin's own
        // translucency, and each repaint would multiply the alpha down again until
        // the chrome faded out entirely.
        const original = (token) => {
          if (!(token in this.originalTokens)) this.originalTokens[token] = this.token(body, token);
          return this.originalTokens[token];
        };

        // The opaque fallback a `-solid` hover variant mixes toward.
        const solid = readColor(original("--dsw-alias-bg-layer-1")) ?? { r: 20, g: 22, b: 26, a: 1 };
        const solidTarget = `rgba(${String(solid.r)}, ${String(solid.g)}, ${String(solid.b)}, 1)`;

        for (const entry of SURFACE_TOKENS) {
          const base = original(entry.token);
          const parsed = readColor(base);
          if (parsed === null) continue;
          if (surfaces <= 0.001) {
            // Fully transparent: nothing of the shell's own fill is kept.
            body.style.setProperty(entry.token, "transparent", "important");
          } else {
            // `entry.keep` is the share of the shell's own opacity that survives.
            const alpha = Number(clamp(parsed.a * entry.keep * surfaces, 0, 1).toFixed(3));
            body.style.setProperty(entry.token, withAlpha(base, alpha), "important");
          }
        }

        // Hover and raised variants have to be rebuilt from the surface's own
        // base, or a translucent chrome snaps back to an opaque stock tone the
        // moment the pointer moves.
        const panel = original("--dsw-specific-menu");
        for (const [token, amount] of [
          ["--dsw-alias-interactive-bg-hover", 0.06],
          ["--dsw-alias-interactive-bg-hover-accent", 0.12],
          ["--dsw-alias-bg-layer-2", 0.05],
          ["--dsw-alias-bg-layer-3", 0.09]
        ]) {
          const base = original(token);
          if (readColor(base) === null) continue;
          body.style.setProperty(token, mixColor(base, solidTarget, amount), "important");
        }
        for (const token of ["--dsw-alias-interactive-bg-hover-solid", "--dsw-alias-interactive-bg-active"]) {
          if (readColor(original(token)) === null) continue;
          body.style.setProperty(token, mixColor(panel, solidTarget, 0.25), "important");
        }

        // The shell only blurs a surface that has a `backdrop-filter` set. The
        // empty string means "no filter" rather than "filter: none", so a zero
        // setting removes the declaration entirely and costs no GPU work.
        const filter = blur > 0 ? `blur(${String(blur)}px) saturate(140%)` : "";
        for (const token of ["--dsw-menu-backdrop-filter"]) {
          body.style.setProperty(token, filter === "" ? "none" : filter, "important");
        }
      }

      /** Read one custom property's resolved value, or `""`. */
      token(element, name) {
        const value = getComputedStyle(element).getPropertyValue(name);
        return typeof value === "string" ? value.trim() : "";
      }

      /**
       * Whether the shell is currently in its dark palette.
       *
       * The theme presenter toggles `data-ds-dark-theme` (the shell itself watches
       * that attribute with a MutationObserver), and it may sit on either `<html>`
       * or `<body>`, so both are checked.
       */
      isDarkTheme() {
        if (this.document === null) return true;
        const root = this.document.documentElement;
        const body = this.document.body;
        return (
          (root !== null && root.hasAttribute("data-ds-dark-theme")) ||
          (body !== null && body.hasAttribute("data-ds-dark-theme"))
        );
      }

      /** Create the layer skeleton as the first child of <body>. */
      mountLayers() {
        this.document.body.dataset.dshMural = "";
        const root = this.document.createElement("div");
        root.id = ID.root;
        root.setAttribute(OWNED, "");
        root.setAttribute("aria-hidden", "true");
        const media = this.document.createElement("div");
        media.id = ID.media;
        media.setAttribute(OWNED, "");
        const scrim = this.document.createElement("div");
        scrim.id = ID.scrim;
        scrim.setAttribute(OWNED, "");
        const vignette = this.document.createElement("div");
        vignette.id = ID.vignette;
        vignette.setAttribute(OWNED, "");
        root.append(media, scrim, vignette);
        this.document.body.insertBefore(root, this.document.body.firstChild);
        this.root = root;
        this.mediaHost = media;
        this.scrim = scrim;
        this.vignette = vignette;
      }

      /** Reconcile the DOM with the current settings. */
      sync() {
        if (this.disposed || this.root === null) return;
        const config = this.store.get();
        const item = config.enabled === false ? null : this.store.item(config.activeId);
        this.applyFrame(config);
        this.applySurface(config);
        if (item === null) {
          this.releaseMedia();
          this.root.style.display = "none";
          return;
        }
        this.root.style.display = "block";
        if (this.currentId !== item.id) {
          this.releaseMedia();
          this.currentId = item.id;
          this.buildMedia(item, config);
        }
        this.applyMediaSettings(item, config);
      }

      /** Apply the settings that never require rebuilding the media element. */
      applyFrame(config) {
        if (this.mediaHost !== null) {
          this.mediaHost.style.opacity = String(clamp(config.opacity, 0, 100) / 100);
        }
        if (this.scrim !== null) {
          // Light themes need more separation from a wallpaper than dark ones:
          // dark chrome already reads over most images, while light chrome is the
          // first thing a busy or bright picture swallows.
          const isDark = this.isDarkTheme();
          const base = clamp(config.dim, 0, 90);
          const extra = isDark ? 0 : clamp(config.lightThemeDim, 0, 40);
          const strength = clamp(base + extra, 0, 90) / 100;
          this.scrim.style.background = strength <= 0.001 ? "transparent" : `rgba(0,0,0,${strength.toFixed(3)})`;
          const blur = clamp(config.blur, 0, 60);
          this.scrim.style.backdropFilter = blur > 0 ? `blur(${String(blur)}px)` : "";
          this.scrim.style.webkitBackdropFilter = this.scrim.style.backdropFilter;
        }
        if (this.vignette !== null) {
          this.vignette.style.display = config.vignette === false ? "none" : "block";
        }
      }

      /** Fit and focal point for whatever element is mounted. */
      applyMediaSettings(item, config) {
        const element = this.mediaElement;
        if (element === null || this.mediaHost === null) return;
        const fit = FIT_OPTIONS.includes(config.fit) ? config.fit : "cover";
        if (fit === "tile") {
          // Tiling is a background-image job; the element itself steps aside.
          element.style.visibility = "hidden";
          this.mediaHost.style.backgroundImage = `url("${absoluteUrl(item.url)}")`;
          this.mediaHost.style.backgroundRepeat = "repeat";
          this.mediaHost.style.backgroundSize = "auto";
          return;
        }
        this.mediaHost.style.backgroundImage = "";
        element.style.visibility = "visible";
        element.style.objectFit = fit === "fill" ? "fill" : fit;
        element.style.objectPosition = `${String(clamp(config.focusX, 0, 100))}% ${String(clamp(config.focusY, 0, 100))}%`;
      }

      /** Build the <video> or <img> for one library entry. */
      buildMedia(item, config) {
        if (this.mediaHost === null) return;
        // `posterFailed` means this video gave us no decodable first frame: asking
        // again would spin, so it is played instead even in "first frame" mode.
        const wantsPoster = item.kind === "video" && config.playback === "static" && !this.posterFailed;
        if (wantsPoster) {
          const still = this.document.createElement("img");
          still.className = "dsh-mural-media-el";
          still.setAttribute(OWNED, "");
          still.setAttribute("aria-hidden", "true");
          still.alt = "";
          this.mediaHost.append(still);
          this.mediaElement = still;
          this.attachPoster(still, item);
          return;
        }
        if (item.kind === "video") {
          const video = this.document.createElement("video");
          video.className = "dsh-mural-media-el";
          video.setAttribute(OWNED, "");
          video.setAttribute("aria-hidden", "true");
          video.muted = config.sound !== true;
          video.volume = clamp(config.volume, 0, 100) / 100;
          video.loop = config.playback !== "once";
          video.autoplay = true;
          video.playsInline = true;
          video.preload = "auto";
          video.disablePictureInPicture = true;
          video.src = absoluteUrl(item.url);
          video.addEventListener("error", () => this.onMediaError(item), { once: true });
          video.addEventListener("ended", () => {
            // "Play once" parks on the last frame rather than flashing the
            // shell's own color, which is what a background should do.
            if (!video.loop) video.pause();
          });
          this.mediaHost.append(video);
          this.mediaElement = video;
          const started = video.play();
          if (started && typeof started.catch === "function") started.catch(() => {});
          return;
        }
        const image = this.document.createElement("img");
        image.className = "dsh-mural-media-el";
        image.setAttribute(OWNED, "");
        image.setAttribute("aria-hidden", "true");
        image.alt = "";
        image.decoding = "async";
        image.src = absoluteUrl(item.url);
        image.addEventListener("error", () => this.onMediaError(item), { once: true });
        this.mediaHost.append(image);
        this.mediaElement = image;
      }

      /** Grab the first video frame into an object URL, for static mode. */
      attachPoster(image, item) {
        if (this.posterUrl !== null) {
          image.src = this.posterUrl;
          return;
        }
        if (this.posterPending) return;
        this.posterPending = true;
        const video = this.document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.src = absoluteUrl(item.url);
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            video.removeAttribute("src");
            video.load();
          } catch {
            /* nothing to release */
          }
          this.posterPending = false;
          if (this.disposed) {
            if (result !== null) URL.revokeObjectURL(result);
            return;
          }
          if (result === null) {
            // No decodable frame anywhere in the first few seconds: play the
            // video instead, so the user still sees their background rather than
            // an empty rectangle. The flag keeps this from retrying forever.
            this.posterFailed = true;
            this.releaseMedia();
            this.sync();
            return;
          }
          this.posterUrl = result;
          if (this.mediaElement !== null && this.mediaElement.tagName === "IMG") image.src = result;
        };
        const timer = setTimeout(() => finish(null), POSTER_TIMEOUT_MS);
        video.addEventListener("error", () => finish(null), { once: true });
        video.addEventListener(
          "loadeddata",
          () => {
            try {
              const width = video.videoWidth;
              const height = video.videoHeight;
              if (width === 0 || height === 0) {
                finish(null);
                return;
              }
              const canvas = this.document.createElement("canvas");
              canvas.width = width;
              canvas.height = height;
              const context = canvas.getContext("2d");
              if (context === null) {
                finish(null);
                return;
              }
              context.drawImage(video, 0, 0, width, height);
              canvas.toBlob((blob) => finish(blob === null ? null : URL.createObjectURL(blob)), "image/webp", 0.92);
            } catch {
              finish(null);
            }
          },
          { once: true }
        );
      }

      /** A media element failed: remember it and stop claiming to paint it. */
      onMediaError(item) {
        this.failed.add(item.id);
        console.warn(`[background-mural] failed to load media ${item.id}`);
        this.releaseMedia();
        if (this.root !== null) this.root.style.display = "none";
      }

      /** Release the mounted media element and any object URL of ours. */
      releaseMedia() {
        if (this.mediaElement !== null) {
          if (this.mediaElement.tagName === "VIDEO") {
            try {
              this.mediaElement.pause();
              this.mediaElement.removeAttribute("src");
              this.mediaElement.load();
            } catch {
              /* already detached */
            }
          }
          this.mediaElement.remove();
        }
        this.mediaElement = null;
        this.currentId = null;
        if (this.posterUrl !== null) {
          URL.revokeObjectURL(this.posterUrl);
          this.posterUrl = null;
        }
        if (this.mediaHost !== null) this.mediaHost.style.backgroundImage = "";
      }

      /** Pause a playing video while the window is hidden, per settings. */
      onVisibilityChange() {
        if (this.mediaElement === null || this.mediaElement.tagName !== "VIDEO") return;
        if (this.store.get().pauseOnHidden === false) return;
        if (this.document.hidden) {
          if (!this.mediaElement.paused) {
            this.mediaElement.pause();
            this.pausedForVisibility = true;
          }
          return;
        }
        if (this.pausedForVisibility) {
          this.pausedForVisibility = false;
          const started = this.mediaElement.play();
          if (started && typeof started.catch === "function") started.catch(() => {});
        }
      }
    }

    //#endregion

    //#region panel

    const h = React.createElement;

    /** Labelled slider with a value readout. */
    function Slider(props) {
      return h(
        "label",
        { className: "dsh-mural-row" },
        h("span", { className: "dsh-mural-label" }, props.label),
        h("input", {
          className: "dsh-mural-range",
          type: "range",
          min: props.min ?? 0,
          max: props.max ?? 100,
          step: props.step ?? 1,
          value: props.value,
          disabled: props.disabled === true,
          "aria-label": props.label,
          onChange: (event) => props.onChange(Number(event.target.value))
        }),
        h("span", { className: "dsh-mural-value" }, props.format ? props.format(props.value) : String(props.value))
      );
    }

    /** Labelled checkbox. */
    function Toggle(props) {
      return h(
        "label",
        { className: "dsh-mural-row dsh-mural-row-inline" },
        h("input", {
          type: "checkbox",
          checked: props.checked,
          disabled: props.disabled === true,
          "aria-label": props.label,
          onChange: (event) => props.onChange(event.target.checked)
        }),
        h("span", { className: "dsh-mural-label" }, props.label)
      );
    }

    /** Labelled select. */
    function Select(props) {
      return h(
        "label",
        { className: "dsh-mural-row" },
        h("span", { className: "dsh-mural-label" }, props.label),
        h(
          "select",
          {
            className: "dsh-mural-select",
            value: props.value,
            disabled: props.disabled === true,
            "aria-label": props.label,
            onChange: (event) => props.onChange(event.target.value)
          },
          props.options.map((option) => h("option", { key: option.value, value: option.value }, option.label))
        )
      );
    }

    /** One library card. */
    function LibraryCard(props) {
      const [confirming, setConfirming] = React.useState(false);
      const item = props.item;
      const isActive = props.activeId === item.id;
      React.useEffect(() => {
        if (!confirming) return undefined;
        const timer = setTimeout(() => setConfirming(false), 4000);
        return () => clearTimeout(timer);
      }, [confirming]);
      const media =
        item.kind === "video"
          ? h("video", {
              className: "dsh-mural-thumb",
              src: absoluteUrl(item.url),
              muted: true,
              loop: true,
              playsInline: true,
              preload: "metadata",
              onMouseEnter: (event) => {
                const started = event.currentTarget.play();
                if (started && typeof started.catch === "function") started.catch(() => {});
              },
              onMouseLeave: (event) => event.currentTarget.pause()
            })
          : h("img", { className: "dsh-mural-thumb", src: absoluteUrl(item.url), alt: "", loading: "lazy" });
      const meta = [
        item.kind === "video" ? tr("kindVideo") : tr("kindImage"),
        formatBytes(item.size),
        item.durationMs ? formatDuration(item.durationMs) : "",
        item.width && item.height ? `${String(item.width)}×${String(item.height)}` : ""
      ]
        .filter((part) => part !== "")
        .join(" · ");
      return h(
        "li",
        { className: isActive ? "dsh-mural-card dsh-mural-card-active" : "dsh-mural-card" },
        h(
          "div",
          { className: "dsh-mural-thumbBox" },
          media,
          isActive ? h("span", { className: "dsh-mural-badge" }, tr("inUse")) : null
        ),
        h(
          "div",
          { className: "dsh-mural-cardMeta" },
          h("span", { className: "dsh-mural-cardName", title: item.name }, item.name),
          h("span", { className: "dsh-mural-cardSub" }, meta)
        ),
        h(
          "div",
          { className: "dsh-mural-cardActions" },
          h(
            "button",
            {
              type: "button",
              className: isActive ? "dsh-mural-btn dsh-mural-btn-ghost" : "dsh-mural-btn dsh-mural-btn-primary",
              onClick: () => props.onUse(item)
            },
            isActive ? tr("clear") : tr("use")
          ),
          h(
            "button",
            {
              type: "button",
              className: confirming ? "dsh-mural-btn dsh-mural-btn-danger" : "dsh-mural-btn dsh-mural-btn-ghost",
              onClick: () => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                setConfirming(false);
                props.onRemove(item);
              }
            },
            confirming ? tr("removeConfirm") : tr("remove")
          )
        )
      );
    }

    /**
     * The settings panel: library management plus the appearance controls.
     * @param props - slot props; `store` is injected by the plugin.
     */
    function MuralPanel(props) {
      const store = props.store;
      const [config, setConfig] = React.useState(() => store.get());
      const [library, setLibrary] = React.useState({ items: [], root: "", totalBytes: 0, maxBytes: 0 });
      const [status, setStatus] = React.useState("loading");
      const [error, setError] = React.useState("");
      const [upload, setUpload] = React.useState(null);
      const [diagnostics, setDiagnostics] = React.useState(null);
      const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
      const [dropActive, setDropActive] = React.useState(false);
      const [updateState, setUpdateState] = React.useState({ status: "idle", latest: "", error: "" });
      const [copyState, setCopyState] = React.useState("");
      const inputRef = React.useRef(null);

      /** Reload settings and library from the host. */
      const refresh = React.useCallback(
        async (options) => {
          if (!options || options.spinner !== false) setStatus("loading");
          try {
            const body = await getJson(`${API}/overview`);
            store.hydrateItems(body.items);
            store.hydrate(body.config);
            setLibrary({
              items: Array.isArray(body.items) ? body.items : [],
              root: body.library?.root ?? "",
              totalBytes: body.library?.totalBytes ?? 0,
              maxBytes: body.library?.maxBytes ?? 0
            });
            setConfig(store.get());
            setError("");
            setStatus("ready");
          } catch (failure) {
            setError(`${tr("loadFailed")}（${failure instanceof Error ? failure.message : String(failure)}）`);
            setStatus("error");
          }
        },
        [store]
      );

      React.useEffect(() => {
        const unsubscribe = store.subscribe((next) => setConfig({ ...next }));
        void refresh();
        return unsubscribe;
      }, [refresh, store]);

      /** Persist one field and repaint. */
      const update = React.useCallback(
        (key, value, immediate = false) => {
          store.set(key, value, immediate);
          setConfig(store.get());
        },
        [store]
      );

      /** Upload files, then select the last one. */
      const handleFiles = React.useCallback(
        async (fileList) => {
          const files = Array.from(fileList ?? []);
          if (files.length === 0) return;
          let last = null;
          for (const file of files) {
            setUpload({ name: file.name, progress: 0 });
            try {
              const body = await uploadFile(file, (progress) => setUpload({ name: file.name, progress }));
              last = body.item ?? null;
            } catch (failure) {
              setError(uploadErrorMessage(failure));
            }
          }
          setUpload(null);
          await refresh({ spinner: false });
          if (last !== null) update("activeId", last.id, true);
        },
        [refresh, update]
      );

      /** Delete one entry. */
      const handleRemove = React.useCallback(
        async (item) => {
          try {
            const response = await fetch(absoluteUrl(`${API}/item/${encodeURIComponent(item.id)}`), {
              method: "DELETE",
              credentials: "same-origin"
            });
            if (!response.ok) throw new Error(`http-${String(response.status)}`);
            if (store.get().activeId === item.id) update("activeId", "", true);
            await refresh({ spinner: false });
          } catch (failure) {
            setError(uploadErrorMessage(failure));
          }
        },
        [refresh, store, update]
      );

      /** Re-run the capability probe. */
      const runDiagnostics = React.useCallback(async () => {
        const probe = { api: tr("bad"), range: tr("bad"), library: "", codecs: {} };
        try {
          const body = await getJson(`${API}/overview`, 8000);
          probe.api = tr("ok");
          probe.library = body.library?.root ?? "";
          probe.range = body.capabilities?.rangeRequests === true ? tr("ok") : tr("bad");
        } catch {
          probe.api = tr("bad");
        }
        for (const [label, type] of [
          ["mp4 / H.264", 'video/mp4; codecs="avc1.42E01E"'],
          ["webm / VP9", 'video/webm; codecs="vp9"'],
          ["webm / AV1", 'video/webm; codecs="av01"'],
          ["webp", "image/webp"],
          ["avif", "image/avif"]
        ]) {
          try {
            probe.codecs[label] = document.createElement("video").canPlayType(type) || "—";
          } catch {
            probe.codecs[label] = "—";
          }
        }
        setDiagnostics(probe);
      }, []);

      /**
       * Check the repository for a newer version.
       *
       * The in-GUI plugin manager cannot see new commits for a git-installed
       * package, so this reads the live manifest directly. It reports and offers
       * the command; it deliberately does not try to reinstall by itself.
       */
      const checkForUpdate = React.useCallback(async (force) => {
        setUpdateState({ status: "checking", latest: "", error: "" });
        setCopyState("");
        const result = await fetchLatestVersion(force === true);
        if (result.latest === "") {
          setUpdateState({ status: "error", latest: "", error: result.error });
          return;
        }
        const order = compareVersions(result.latest, INSTALLED_VERSION);
        if (order === null) {
          setUpdateState({ status: "unknown", latest: result.latest, error: "" });
          return;
        }
        setUpdateState({ status: order > 0 ? "available" : "current", latest: result.latest, error: "" });
      }, []);

      /** Copy the exact reinstall command, with a short confirmation. */
      const copyUpdateCommand = React.useCallback(async () => {
        const command = "dsh plugin --profile desktop add github:Songgexnl/dsh-background-mural";
        try {
          await navigator.clipboard.writeText(command);
          setCopyState(tr("updateCopied"));
        } catch {
          setCopyState("");
        }
      }, []);

      // Probe once on mount, without a spinner flash: the badge simply fills in.
      React.useEffect(() => {
        void checkForUpdate(false);
      }, [checkForUpdate]);

      const items = library.items;
      const activeItem = items.find((item) => item.id === config.activeId) ?? null;
      const busy = upload !== null;
      const fitOptions = FIT_OPTIONS.map((value) => ({
        value,
        label: tr(`fit${value.charAt(0).toUpperCase()}${value.slice(1)}`)
      }));
      const playbackOptions = PLAYBACK_OPTIONS.map((value) => ({
        value,
        label: tr(`playback${value.charAt(0).toUpperCase()}${value.slice(1)}`)
      }));
      const showFocus = config.fit === "cover" || config.fit === "contain";

      return h(
        "ul",
        { className: "dsh-mural-panel" },
        h(
          "li",
          { className: "dsh-mural-head" },
          h("h3", { className: "dsh-mural-title" }, `${tr("title")} · ${INSTALLED_VERSION}`),
          h("p", { className: "dsh-mural-tagline" }, tr("tagline"))
        ),
        h(
          "li",
          { className: "dsh-mural-block" },
          h(Toggle, {
            label: tr("master"),
            checked: config.enabled !== false,
            onChange: (value) => update("enabled", value, true)
          }),
          h("p", { className: "dsh-mural-hint" }, tr("masterHint"))
        ),
        error !== "" ? h("li", { className: "dsh-mural-error" }, error) : null,
        typeof document !== "undefined" && document.body.dataset.dshMuralUnsupported !== undefined
          ? h("li", { className: "dsh-mural-error" }, tr("incompatible"))
          : null,

        h(
          "li",
          { className: "dsh-mural-section" },
          h("h4", { className: "dsh-mural-sectionTitle" }, tr("library")),
          h(
            "div",
            {
              className: dropActive ? "dsh-mural-drop dsh-mural-drop-active" : "dsh-mural-drop",
              onClick: () => {
                if (inputRef.current !== null) inputRef.current.click();
              },
              onDragOver: (event) => {
                event.preventDefault();
                setDropActive(true);
              },
              onDragLeave: () => setDropActive(false),
              onDrop: (event) => {
                event.preventDefault();
                setDropActive(false);
                void handleFiles(event.dataTransfer ? event.dataTransfer.files : null);
              }
            },
            h(
              "button",
              {
                type: "button",
                className: "dsh-mural-btn dsh-mural-btn-primary",
                disabled: busy,
                onClick: (event) => {
                  event.stopPropagation();
                  if (inputRef.current !== null) inputRef.current.click();
                }
              },
              busy ? tr("uploading") : tr("upload")
            ),
            h("span", { className: "dsh-mural-hint dsh-mural-hint-center" }, tr("dropHint")),
            h("span", { className: "dsh-mural-hint dsh-mural-hint-muted" }, tr("acceptHint")),
            upload !== null
              ? h(
                  "div",
                  { className: "dsh-mural-progress" },
                  h("div", {
                    className: "dsh-mural-progressBar",
                    style: { width: `${String(Math.round(upload.progress * 100))}%` }
                  }),
                  h(
                    "span",
                    { className: "dsh-mural-progressText" },
                    `${upload.name} · ${String(Math.round(upload.progress * 100))}%`
                  )
                )
              : null,
            h("input", {
              ref: inputRef,
              className: "dsh-mural-file",
              type: "file",
              accept: "image/*,video/*",
              multiple: true,
              onChange: (event) => {
                void handleFiles(event.target.files);
                event.target.value = "";
              }
            })
          ),
          status === "loading"
            ? h("p", { className: "dsh-mural-hint" }, "…")
            : items.length === 0
              ? h("p", { className: "dsh-mural-hint" }, tr("empty"))
              : h(
                  "ul",
                  { className: "dsh-mural-grid" },
                  items.map((item) =>
                    h(LibraryCard, {
                      key: item.id,
                      item,
                      activeId: config.activeId,
                      onUse: (target) => update("activeId", target.id === config.activeId ? "" : target.id, true),
                      onRemove: (target) => void handleRemove(target)
                    })
                  )
                ),
          h(
            "div",
            { className: "dsh-mural-actionsRow" },
            h(
              "span",
              { className: "dsh-mural-hint" },
              `${String(items.length)} ${tr("files")} · ${formatBytes(library.totalBytes)}${
                library.maxBytes > 0 ? ` / ${formatBytes(library.maxBytes)}` : ""
              }`
            ),
            activeItem !== null
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "dsh-mural-btn dsh-mural-btn-ghost",
                    onClick: () => update("activeId", "", true)
                  },
                  tr("clear")
                )
              : null,
            h(
              "button",
              { type: "button", className: "dsh-mural-btn dsh-mural-btn-ghost", onClick: () => void refresh() },
              tr("reload")
            )
          )
        ),

        h(
          "li",
          { className: "dsh-mural-section" },
          h("h4", { className: "dsh-mural-sectionTitle" }, tr("appearance")),
          h(Select, { label: tr("fit"), value: config.fit, options: fitOptions, onChange: (value) => update("fit", value) }),
          showFocus ? h(Slider, { label: tr("focusX"), value: config.focusX, onChange: (value) => update("focusX", value) }) : null,
          showFocus ? h(Slider, { label: tr("focusY"), value: config.focusY, onChange: (value) => update("focusY", value) }) : null,
          h(Slider, { label: tr("dim"), value: config.dim, max: 90, onChange: (value) => update("dim", value) }),
          h(Slider, { label: tr("blur"), value: config.blur, max: 60, onChange: (value) => update("blur", value) }),
          h(Slider, { label: tr("opacity"), value: config.opacity, onChange: (value) => update("opacity", value) }),
          h(Toggle, { label: tr("vignette"), checked: config.vignette !== false, onChange: (value) => update("vignette", value) }),
          h(Slider, { label: tr("surfaceStrength"), value: config.surfaceStrength, min: 0, max: 100, onChange: (value) => update("surfaceStrength", value) }),
          h(Slider, { label: tr("surfaceBlur"), value: config.surfaceBlur, min: 0, max: 40, onChange: (value) => update("surfaceBlur", value) }),
          h("p", { className: "dsh-mural-hint" }, tr("surfaceHint")),
          h(Slider, { label: tr("lightThemeDim"), value: config.lightThemeDim, min: 0, max: 40, onChange: (value) => update("lightThemeDim", value) }),
          h("p", { className: "dsh-mural-hint" }, tr("lightThemeDimHint"))
        ),

        h(
          "li",
          { className: "dsh-mural-section" },
          h("h4", { className: "dsh-mural-sectionTitle" }, tr("video")),
          h(Select, {
            label: tr("playback"),
            value: config.playback,
            options: playbackOptions,
            onChange: (value) => update("playback", value, true)
          }),
          h(Toggle, { label: tr("sound"), checked: config.sound === true, onChange: (value) => update("sound", value, true) }),
          h(Slider, { label: tr("volume"), value: config.volume, onChange: (value) => update("volume", value) }),
          h(Toggle, {
            label: tr("pauseOnHidden"),
            checked: config.pauseOnHidden !== false,
            onChange: (value) => update("pauseOnHidden", value)
          })
        ),

        h(
          "li",
          { className: "dsh-mural-section" },
          h(
            "button",
            {
              type: "button",
              className: "dsh-mural-btn dsh-mural-btn-ghost",
              "aria-expanded": diagnosticsOpen,
              onClick: () => {
                const next = !diagnosticsOpen;
                setDiagnosticsOpen(next);
                if (next) void runDiagnostics();
              }
            },
            `${diagnosticsOpen ? "▾" : "▸"} ${tr("diagnostics")}`
          ),
          diagnosticsOpen
            ? h(
                "div",
                { className: "dsh-mural-diag" },
                h("div", null, `${tr("apiHealth")}: ${(diagnostics && diagnostics.api) || "…"}`),
                h("div", null, `${tr("libraryPath")}: ${(diagnostics && diagnostics.library) || library.root || "—"}`),
                h("div", null, `${tr("rangeLabel")}: ${(diagnostics && diagnostics.range) || "…"}`),
                h(
                  "div",
                  null,
                  `${tr("codecSupport")}: ${Object.entries((diagnostics && diagnostics.codecs) || {})
                    .map(([label, value]) => `${label}=${String(value)}`)
                    .join("  ")}`
                ),
                h(
                  "button",
                  { type: "button", className: "dsh-mural-btn dsh-mural-btn-ghost", onClick: () => void runDiagnostics() },
                  tr("refresh")
                )
              )
            : null,
          h(
            "div",
            { className: "dsh-mural-update" },
            h(
              "span",
              { className: "dsh-mural-hint" },
              `${tr("versionLabel")} ${INSTALLED_VERSION} · ${
                updateState.status === "checking"
                  ? tr("checkingUpdate")
                  : updateState.status === "available"
                    ? tr("updateAvailable").replace("{version}", updateState.latest)
                    : updateState.status === "current"
                      ? tr("upToDate")
                      : updateState.status === "error"
                        ? tr("updateFailed")
                        : tr("checkUpdate")
              }`
            ),
            h(
              "button",
              {
                type: "button",
                className: "dsh-mural-btn dsh-mural-btn-ghost",
                disabled: updateState.status === "checking",
                onClick: () => void checkForUpdate(true)
              },
              tr("checkUpdate")
            ),
            updateState.status === "available"
              ? h(
                  "div",
                  { className: "dsh-mural-updateBox" },
                  h("span", { className: "dsh-mural-hint" }, tr("updateHint")),
                  h("code", { className: "dsh-mural-cmd" }, "dsh plugin --profile desktop add github:Songgexnl/dsh-background-mural"),
                  h(
                    "button",
                    { type: "button", className: "dsh-mural-btn", onClick: () => void copyUpdateCommand() },
                    copyState !== "" ? copyState : tr("updateCopy")
                  )
                )
              : null
          )
        )
      );
    }

    //#endregion

    //#region styles

    const PANEL_CSS = `
body[data-dsh-mural] .dsh-mural-panel{--dsh-mural-surface:var(--dsw-static-neutral-100,#f5f5f5);--dsh-mural-control:var(--dsw-static-neutral-200,#e5e5e5);--dsh-mural-text:var(--dsw-alias-label-primary,#172a45);--dsh-mural-muted:var(--dsw-alias-label-secondary,#4b5563);--dsh-mural-faint:var(--dsw-alias-label-tertiary,#6b7280);--dsh-mural-border:var(--dsw-alias-border-l3,#cbd5e1);list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--dsh-mural-text)}
body[data-dsh-mural][data-ds-dark-theme] .dsh-mural-panel{--dsh-mural-surface:var(--dsw-static-neutral-850,#212123);--dsh-mural-control:var(--dsw-static-neutral-800,#292929);--dsh-mural-text:var(--dsw-alias-label-primary,#f9fafb);--dsh-mural-muted:var(--dsw-alias-label-secondary,#cfd3d6);--dsh-mural-faint:var(--dsw-alias-label-tertiary,#adb2b8);--dsh-mural-border:var(--dsw-alias-border-l3,#3c3c3d)}
html[data-ds-dark-theme] body[data-dsh-mural] .dsh-mural-panel{--dsh-mural-surface:var(--dsw-static-neutral-850,#212123);--dsh-mural-control:var(--dsw-static-neutral-800,#292929);--dsh-mural-text:var(--dsw-alias-label-primary,#f9fafb);--dsh-mural-muted:var(--dsw-alias-label-secondary,#cfd3d6);--dsh-mural-faint:var(--dsw-alias-label-tertiary,#adb2b8);--dsh-mural-border:var(--dsw-alias-border-l3,#3c3c3d)}
body[data-dsh-mural] .dsh-mural-head{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border-radius:12px;background:var(--dsh-mural-surface)}
body[data-dsh-mural] .dsh-mural-title{margin:0;font-size:15px;font-weight:600;line-height:1.4}
body[data-dsh-mural] .dsh-mural-tagline{margin:0;font-size:12.5px;line-height:1.55;color:var(--dsh-mural-faint)}
body[data-dsh-mural] .dsh-mural-block{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border-radius:12px;background:var(--dsh-mural-surface)}
body[data-dsh-mural] .dsh-mural-section{display:flex;flex-direction:column;gap:9px;padding:12px 14px;border-radius:12px;background:var(--dsh-mural-surface)}
body[data-dsh-mural] .dsh-mural-sectionTitle{margin:0;font-size:13px;font-weight:600;color:var(--dsh-mural-muted)}
body[data-dsh-mural] .dsh-mural-row{display:grid;grid-template-columns:116px 1fr 54px;align-items:center;gap:10px}
body[data-dsh-mural] .dsh-mural-row-inline{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
body[data-dsh-mural] .dsh-mural-label{font-size:12.5px;color:var(--dsh-mural-muted)}
body[data-dsh-mural] .dsh-mural-value{font-size:12px;text-align:right;color:var(--dsh-mural-faint);font-variant-numeric:tabular-nums}
body[data-dsh-mural] .dsh-mural-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsh-mural-faint)}
body[data-dsh-mural] .dsh-mural-hint-center{text-align:center}
body[data-dsh-mural] .dsh-mural-hint-muted{text-align:center;font-size:11px;opacity:.85}
body[data-dsh-mural] .dsh-mural-error{margin:0;padding:10px 14px;border-radius:10px;background:var(--dsh-mural-surface);font-size:12.5px;color:var(--dsw-alias-state-error-primary,#d14343)}
body[data-dsh-mural] .dsh-mural-range{width:100%}
body[data-dsh-mural] .dsh-mural-select{width:100%;padding:5px 8px;border-radius:6px;font-size:12.5px;border:1px solid var(--dsh-mural-border);background:var(--dsh-mural-control);color:var(--dsh-mural-text)}
body[data-dsh-mural] .dsh-mural-select option{background:var(--dsh-mural-control);color:var(--dsh-mural-text)}
body[data-dsh-mural] .dsh-mural-drop{display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 12px;border:1px dashed var(--dsh-mural-border);border-radius:12px;background:var(--dsh-mural-control);cursor:pointer;transition:border-color .16s,background .16s}
body[data-dsh-mural] .dsh-mural-drop-active{border-color:var(--dsw-alias-brand-primary,#3b82f6);background:var(--dsh-mural-surface)}
body[data-dsh-mural] .dsh-mural-file{display:none}
body[data-dsh-mural] .dsh-mural-progress{position:relative;width:100%;height:18px;border-radius:9px;overflow:hidden;background:var(--dsh-mural-control)}
body[data-dsh-mural] .dsh-mural-progressBar{height:100%;background:var(--dsw-alias-button-primary-fill,#3b82f6);transition:width .12s}
body[data-dsh-mural] .dsh-mural-progressText{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px}
body[data-dsh-mural] .dsh-mural-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
body[data-dsh-mural] .dsh-mural-card{display:flex;flex-direction:column;gap:8px;padding:8px;border:1px solid var(--dsh-mural-border);border-radius:10px;background:var(--dsh-mural-control);min-width:0}
body[data-dsh-mural] .dsh-mural-card-active{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,#3b82f6)}
body[data-dsh-mural] .dsh-mural-thumbBox{position:relative;width:100%;aspect-ratio:16/10;border-radius:6px;overflow:hidden;background:var(--dsh-mural-surface)}
body[data-dsh-mural] .dsh-mural-thumb{width:100%;height:100%;object-fit:cover;display:block}
body[data-dsh-mural] .dsh-mural-badge{position:absolute;top:6px;left:6px;padding:2px 6px;border-radius:5px;font-size:10.5px;background:var(--dsw-alias-button-primary-fill,#3b82f6);color:var(--dsw-alias-label-primary-foreground,#fff)}
body[data-dsh-mural] .dsh-mural-cardMeta{display:flex;flex-direction:column;gap:2px;min-width:0}
body[data-dsh-mural] .dsh-mural-cardName{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body[data-dsh-mural] .dsh-mural-cardSub{font-size:11px;color:var(--dsh-mural-faint)}
body[data-dsh-mural] .dsh-mural-cardActions{display:flex;gap:6px;flex-wrap:wrap}
body[data-dsh-mural] .dsh-mural-actionsRow{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
body[data-dsh-mural] .dsh-mural-update{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid var(--dsh-mural-border)}
body[data-dsh-mural] .dsh-mural-updateBox{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex-basis:100%}
body[data-dsh-mural] .dsh-mural-cmd{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11.5px;padding:5px 8px;border-radius:6px;background:var(--dsh-mural-control);color:var(--dsh-mural-text);word-break:break-all}
body[data-dsh-mural] .dsh-mural-btn{border:1px solid var(--dsh-mural-border);background:var(--dsh-mural-surface);color:var(--dsh-mural-text);border-radius:6px;padding:5px 10px;font-size:12px;line-height:1.2;cursor:pointer;transition:background .12s,border-color .12s}
body[data-dsh-mural] .dsh-mural-btn:hover{border-color:var(--dsw-alias-label-dimmed,#94a3b8)}
body[data-dsh-mural] .dsh-mural-btn:disabled{opacity:.6;cursor:default}
body[data-dsh-mural] .dsh-mural-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,#172a45);color:var(--dsw-alias-label-primary-foreground,#fff)}
body[data-dsh-mural] .dsh-mural-btn-danger{border-color:transparent;background:var(--dsw-alias-state-error-primary,#d14343);color:var(--dsw-alias-label-primary-foreground,#fff)}
body[data-dsh-mural] .dsh-mural-btn-ghost{background:transparent;color:var(--dsh-mural-text)}
body[data-dsh-mural] .dsh-mural-diag{display:flex;flex-direction:column;gap:6px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#6b7280);word-break:break-all}
`;

    //#endregion

    //#region plugin

    /**
     * Services this bundle uses.
     *
     * Only `slots` is listed because the renderer needs nothing else: settings
     * persistence and the media library are plain same-origin HTTP, which is also
     * why the plugin needs no desktop-specific code path.
     */
    const inject = ["slots"];

    /** Mount the background renderer and the settings panel. */
    function apply(ctx) {
      if (typeof document === "undefined") return;

      if (document.getElementById(ID.panel) === null) {
        const tag = document.createElement("style");
        tag.id = ID.panel;
        tag.dataset.plugin = "dsh-background-mural";
        tag.textContent = PANEL_CSS;
        document.head.appendChild(tag);
      }

      // One store for the whole plugin: the panel writes to it, the renderer
      // paints from it, and neither needs to know about the other.
      const store = new ConfigStore();
      const renderer = new MuralRenderer(store);
      const disposers = [];

      const disposeRenderer = ctx.effect(() => {
        let stopped = false;
        // The runtime verdict gates everything: if the host half reports a shell
        // this build was not written against, nothing is painted and no token is
        // repainted, so the stock interface survives untouched.
        void getJson(`${API}/overview`)
          .then((body) => {
            if (stopped) return;
            store.hydrateItems(body.items);
            store.hydrate(body.config);
            if (body.runtime !== undefined && body.runtime.supported === false) {
              console.warn(
                `[background-mural] paused: DSH ${String(body.runtime.version)} is outside the supported range`
              );
              document.body.dataset.dshMuralUnsupported = "";
              return;
            }
            renderer.start();
          })
          .catch((error) => {
            console.warn("[background-mural] initial load failed:", error);
          });
        return () => {
          stopped = true;
          renderer.dispose();
          delete document.body.dataset.dshMuralUnsupported;
        };
      }, "background-mural: renderer");
      if (typeof disposeRenderer === "function") disposers.push(disposeRenderer);

      if (ctx.slots === undefined || typeof ctx.slots.inject !== "function") return;
      const unmountPanel = ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "background-mural",
            order: 130,
            label: () => tr("title"),
            inject: () => ({ store })
          },
          MuralPanel
        )
      );
      if (typeof unmountPanel === "function") disposers.push(unmountPanel);

      ctx.effect(
        () => () => {
          for (const dispose of disposers) {
            try {
              dispose();
            } catch (error) {
              console.warn("[background-mural] teardown step failed:", error);
            }
          }
        },
        "background-mural: panel"
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.ConfigStore = ConfigStore;
    exports.MuralRenderer = MuralRenderer;
    return module.exports;
  }
});
