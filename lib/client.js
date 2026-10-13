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

    /** The changelog next to it, so a notice can say what actually changed. */
    const CHANGELOG_URL = "https://raw.githubusercontent.com/Songgexnl/dsh-background-mural/main/CHANGELOG.md";

    /** Where a user goes to read more, and where the release history lives. */
    const REPO_URL = "https://github.com/Songgexnl/dsh-background-mural";
    const RELEASE_URL = `${REPO_URL}/releases`;

    /**
     * The one command that reinstalls this plugin from the repository.
     *
     * The profile name has to match the profile the user actually runs, which is
     * why it is also spelled out in the panel and in the copied note instead of
     * being run by the plugin itself: the client half has no shell access.
     */
    const REINSTALL_COMMAND = "dsh plugin --profile desktop add github:Songgexnl/dsh-background-mural";

    /** Installed version, so the panel can show what is running. */
    const INSTALLED_VERSION = "0.1.17";

    /** Update checks are cached this long, so reopening the panel does not refetch. */
    const UPDATE_CACHE_MS = 6 * 60 * 60 * 1000;

    /** How long after mounting the notice check runs, so boot is never blocked. */
    const UPDATE_NOTICE_DELAY_MS = 2500;

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
      // The sidebar, the composer and the menus are all re-glazed by
      // `clearShellBackdrop` from their own measured fill, so they must not also
      // keep a token fill of their own: two translucent layers stacked on the same
      // box compound into something indistinguishable from the opaque shell the
      // plugin exists to get away from. A bubble is small enough to fall outside
      // that pass and keeps its own fill.
      { token: "--dsw-specific-sidebar-fill", keep: 0 },
      { token: "--dsw-specific-input-major", keep: 0 },
      { token: "--dsw-specific-menu", keep: 0 },
      { token: "--dsw-specific-bubble", keep: 0.75 },
      { token: "--dsw-specific-bubble-highlight", keep: 0.75 }
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
      panel: "dsh-mural-panel-css",
      skin: "dsh-mural-skin-css",
      notice: "dsh-mural-notice-css"
    };

    /**
     * Skins that paint the whole shell themselves.
     *
     * A skin's backdrop is opaque on purpose, and it lives inside `#root` — that
     * is, above this plugin's layer. Repainting `--dsw-*` tokens cannot reach it,
     * because the skin hard-codes the fills in its own stylesheet rather than
     * reading a token. Without the rules below the wallpaper is simply never
     * visible, which reads exactly like "the plugin does nothing".
     *
     * Each adapter names the skin's `<body>` marker and the regions that have to
     * step aside. Only the *fill* steps aside: borders, shadows, ornaments and
     * the character art stay, and the regions keep a fill — the very value this
     * plugin already computes for the sidebar, so the 「界面底色」slider still
     * governs them and light/dark both stay correct.
     */
    const SKIN_ADAPTERS = [
      {
        id: "maid-atelier",
        label: "ui-skin-maid-atelier",
        /** Stamped on `<body>` by the skin while it is loaded. */
        marker: "data-dsh-maid-atelier",
        /** Regions the skin fills with a hard-coded opaque color. */
        fills: [
          "[class*='sidebarCol']",
          "[class*='sidebarCol']>div",
          "[class*='logoRow']",
          "[data-slot='conversation.header']>header",
          "[data-shell-leading]",
          "[data-slot='sidebar.footer.action']"
        ],
        /** The skin's full-bleed backdrop painting; the wallpaper takes this seat. */
        artwork: "[data-skin-chrome='character-stage']"
      }
    ];

    /**
     * The override sheet one adapter needs.
     *
     * Every rule is scoped by this plugin's own body marker as well as the skin's,
     * so the skin goes back to being untouched the moment the wallpaper is off,
     * the shell is unsupported, or the plugin unloads.
     */
    function skinCompatCss(adapter) {
      const scope = `body[${BODY_ATTR}][${adapter.marker}]`;
      const rows = adapter.fills.map(
        (selector) => `${scope} ${selector}{background:var(--dsw-specific-sidebar-fill) !important}`
      );
      rows.push(`${scope} ${adapter.artwork}{background:none !important}`);
      return rows.join("\n");
    }

    /** The skin adapter whose rules are currently needed, or `null`. */
    function detectSkin(doc) {
      if (doc === null || doc === undefined || doc.body === null || doc.body === undefined) return null;
      for (const adapter of SKIN_ADAPTERS) {
        if (doc.body.hasAttribute(adapter.marker)) return adapter;
      }
      return null;
    }

    /**
     * What is actually painted on top of the wallpaper.
     *
     * "The picture never shows up" has one honest answer and a dozen plausible
     * ones — a layer that failed to mount, a media element that failed to load,
     * an opaque box in the way — and the cheap guesses all look identical from
     * the outside. So instead of guessing, the report asks the document: walk up
     * from the element under the centre of the viewport and print every box that
     * could be covering the mural layer, then look for the element that
     * re-declared the shell's own base fill, because a re-declaration on any
     * intermediate box puts an opaque colour back over the whole frame no matter
     * what the plugin does to `body`.
     */
    function paintProbe(doc, win) {
      if (doc === null || doc === undefined || win === null || win === undefined) return "paint probe: (unavailable)";
      const lines = [];
      const describe = (node) => {
        const style = win.getComputedStyle(node);
        const id = node.id === "" ? "" : `#${node.id}`;
        const first = typeof node.className === "string" ? node.className.trim().split(/\s+/)[0] : "";
        const cls = first === undefined || first === "" ? "" : `.${first}`;
        const image = style.backgroundImage === "none" ? "" : " +image";
        return `${node.tagName.toLowerCase()}${id}${cls} pos=${style.position} z=${style.zIndex} bg=${style.backgroundColor}${image} op=${style.opacity}`;
      };
      const size = (element) => {
        const rect = element.getBoundingClientRect();
        return `${String(Math.round(rect.width))}x${String(Math.round(rect.height))}`;
      };
      const hit = doc.elementFromPoint(Math.round(win.innerWidth / 2), Math.round(win.innerHeight / 2));
      lines.push(`  hit: ${hit === null ? "(none)" : describe(hit)}`);
      let node = hit === null ? null : hit;
      for (let depth = 0; node !== null && depth < 6; depth += 1) {
        lines.push(`  ^${String(depth)}: ${describe(node)}`);
        node = node.parentElement;
      }
      const mural = doc.getElementById(ID.root);
      lines.push(`  mural: ${mural === null ? "(missing)" : `${size(mural)} z=${win.getComputedStyle(mural).zIndex}`}`);
      const media = doc.querySelector(`#${ID.media} img, #${ID.media} video`);
      if (media === null) {
        lines.push("  media: (missing)");
      } else {
        const style = win.getComputedStyle(media);
        const natural = media.tagName === "VIDEO" ? media.videoWidth : media.naturalWidth;
        lines.push(
          `  media: ${media.tagName} ${size(media)} natural=${String(natural)} complete=${String(
            media.complete
          )} vis=${style.visibility} op=${style.opacity} fit=${style.objectFit}`
        );
      }
      const shell = doc.getElementById("root");
      if (shell !== null) {
        const style = win.getComputedStyle(shell);
        const read = (token) => style.getPropertyValue(token).trim();
        lines.push(
          `  #root: pos=${style.position} z=${style.zIndex} bg=${style.backgroundColor} base=${read(
            "--dsw-alias-bg-base"
          )} layer1=${read("--dsw-alias-bg-layer-1")} layer2=${read("--dsw-alias-bg-layer-2")}`
        );
      }
      // Area is what identifies a wallpaper's cover: only a box spanning a large
      // share of the viewport can hide a full-screen picture. One sample point
      // cannot do this job — the report is always copied from the settings
      // panel, which is opaque by design and covers the middle of the screen, so
      // a single sample always measures the panel itself. Every large box is
      // listed in document order instead, so the first opaque one is the culprit.
      const slabs = [];
      const all = doc.querySelectorAll("body *");
      for (let index = 0; index < all.length && index < 4000 && slabs.length < 14; index += 1) {
        const candidate = all[index];
        if (candidate.closest(`#${ID.root}`) !== null) continue;
        const rect = candidate.getBoundingClientRect();
        const share = (rect.width * rect.height) / (win.innerWidth * win.innerHeight);
        if (share < 0.5) continue;
        const style = win.getComputedStyle(candidate);
        const l1 = style.getPropertyValue("--dsw-alias-bg-layer-1").trim();
        slabs.push(`${describe(candidate)} cover=${String(Math.round(share * 100))}% l1=${l1}`);
      }
      lines.push("  slabs (>=50% viewport, document order):");
      if (slabs.length === 0) lines.push("    (none)");
      for (const entry of slabs) lines.push(`    ${entry}`);

      // The first few boxes that resolve the base fill to an opaque colour. Each
      // one is a candidate for the frame the wallpaper never gets to show
      // through, and the topmost entry is normally the culprit.
      const carriers = [];
      for (let index = 0; index < all.length && index < 4000 && carriers.length < 3; index += 1) {
        const candidate = all[index];
        const value = win.getComputedStyle(candidate).getPropertyValue("--dsw-alias-bg-base").trim();
        if (value === "" || value === "transparent") continue;
        carriers.push(`${candidate.tagName.toLowerCase()}${candidate.id === "" ? "" : `#${candidate.id}`}=${value}`);
      }
      lines.push(`  base carriers: ${carriers.length === 0 ? "(none)" : carriers.join(" ")}`);
      return `paint probe:\n${lines.join("\n")}`;
    }

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
      autoCheckUpdate: true,
      skipUpdateVersion: "",
      surfaceStrength: 100,
      surfaceBlur: 14,
      lightThemeDim: 15,
      maxUploadBytes: 512 * 1024 * 1024,
      maxLibraryBytes: 8 * 1024 * 1024 * 1024
    };

    /**
     * What "reset appearance" puts back, and the values it puts back.
     *
     * Deliberately excludes the library, the active item and the sound/window
     * switches: someone resetting the look is not asking to lose their wallpaper.
     */
    const APPEARANCE_DEFAULTS = {
      fit: "cover",
      dim: 30,
      blur: 0,
      opacity: 100,
      focusX: 50,
      focusY: 50,
      vignette: true,
      surfaceStrength: 100,
      surfaceBlur: 14,
      lightThemeDim: 15
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
        blurHint:
          "只模糊壁纸本身，界面不受影响。0 = 画面清晰（默认）；调高会把整张壁纸糊成一片色块，很容易被误认为「图片没出来」。想让侧栏、输入栏变磨砂请用下面的「界面磨砂」。",
        resetAppearance: "恢复默认外观",
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
        soundHint:
          "视频声音受浏览器自动播放限制：画面会先静音起播，若被拦下，点一下界面即可出声。素材本身没有音轨时则永远不会有声音。",
        soundBlocked: "浏览器拦下了带声自动播放，画面正在静音播放——点一下界面即可听到声音。",
        pauseOnHidden: "窗口隐藏时暂停",
        diagnostics: "诊断",
        libraryPath: "素材库位置",
        apiHealth: "接口连通性",
        codecSupport: "视频编码支持",
        refresh: "重新检测",
        versionLabel: "版本",
        layerOk: "背景图层已挂载",
        layerMissing: "背景图层未挂载——请看控制台里 background-mural 的报错",
        layerHidden: "背景图层已挂载但被隐藏：当前素材没取到或加载失败",
        surfaces: "界面重绘",
        backdrop: "外壳背景",
        copyReport: "复制诊断报告",
        reportCopied: "报告已复制",
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
        rangeLabel: "Range 请求",
        autoCheck: "自动检查新版本",
        autoCheckHint:
          "挂载后静默读一次仓库清单（结果缓存 6 小时），发现新版在右下角提示。「不再提醒」只跳过当前这个版本。",
        skinCompat: "皮肤共存",
        skinNone: "未检测到需要让位的皮肤",
        skinCovered: "已让位给 {label}",
        updateFound: "发现新版本：{version}",
        updateBehind: "当前 {current} · 最新 {latest} · 落后 {count} 个版本",
        updateBehindOne: "当前 {current} · 最新 {latest} · 落后 1 个版本",
        updateNotes: "更新内容",
        updateNoNotes: "（仓库里没有可读的更新说明）",
        updateRunning: "当前 {current} · 最新 {latest}",
        updateAgentNote:
          "请把 DSH 插件 dsh-background-mural 更新到最新版。\n仓库：{repo}\n当前版本：{current}\n最新版本：{latest}\n重装命令：{command}\n升级完成后请完全退出并重启 DSH。",
        updateRepoHintPrefix: "请打开",
        updateRepoHintSuffix:
          "查看最新版本，并按项目 README 把插件更新到当前使用的 DSH profile（不同 profile 的安装命令不同）。升级完成后请完全退出并重启 DSH。",
        updateMute: "不再提醒",
        updateRecheck: "重新检查",
        updateCopyAgent: "复制给 Agent",
        updateCopiedAgent: "已复制，粘给 DSH 里的 AI",
        updateRelease: "打开 Release 页面"
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
        blurHint:
          "Blurs the wallpaper itself, not the interface. 0 keeps the picture crisp (the default); a high value smears the image into flat colour, which is easy to mistake for \"the picture never loaded\". For frosted chrome, use \"Chrome frosted blur\" below.",
        resetAppearance: "Reset appearance",
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
        soundHint:
          "Video sound is subject to the browser's autoplay policy: playback starts muted and the first click restores the sound. A clip with no audio track never has any.",
        soundBlocked: "The browser blocked autoplay with sound, so the clip is playing muted — click anywhere to hear it.",
        pauseOnHidden: "Pause while hidden",
        diagnostics: "Diagnostics",
        libraryPath: "Library location",
        apiHealth: "API health",
        codecSupport: "Video codec support",
        refresh: "Re-check",
        versionLabel: "Version",
        layerOk: "Background layer mounted",
        layerMissing: "Background layer NOT mounted - check the console for a background-mural error",
        layerHidden: "Layer mounted but hidden: the active item is missing or failed to load",
        surfaces: "Chrome repaint",
        backdrop: "Shell backdrop",
        copyReport: "Copy diagnostic report",
        reportCopied: "Report copied",
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
        rangeLabel: "Range requests",
        autoCheck: "Check for new versions automatically",
        autoCheckHint:
          "Reads the repository manifest once after mounting (cached for 6 hours) and shows a notice in the bottom-right corner when a newer build exists. \"Do not remind me again\" only skips the current version.",
        skinCompat: "Skin coexistence",
        skinNone: "No shell-painting skin detected",
        skinCovered: "Stepped aside for {label}",
        updateFound: "New version: {version}",
        updateBehind: "Running {current} · latest {latest} · {count} versions behind",
        updateBehindOne: "Running {current} · latest {latest} · 1 version behind",
        updateNotes: "What changed",
        updateNoNotes: "(the repository has no readable release notes)",
        updateRunning: "Running {current} · latest {latest}",
        updateAgentNote:
          "Please update the DSH plugin dsh-background-mural to the latest version.\nRepository: {repo}\nRunning: {current}\nLatest: {latest}\nReinstall: {command}\nFully quit and restart DSH afterwards.",
        updateRepoHintPrefix: "Open",
        updateRepoHintSuffix:
          "for the latest release, then update the plugin in the DSH profile you actually run (the command differs per profile). Fully quit and restart DSH afterwards.",
        updateMute: "Do not remind me again",
        updateRecheck: "Check again",
        updateCopyAgent: "Copy for the agent",
        updateCopiedAgent: "Copied — paste it to the DSH agent",
        updateRelease: "Open the release page"
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

    /** Fill `{name}` placeholders in a translated string. */
    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        Object.hasOwn(values, key) ? String(values[key]) : match
      );
    }

    /** Strip the light markdown a changelog line carries. */
    function stripMarkdown(text) {
      return String(text ?? "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "")
        .trim();
    }

    /**
     * Read the changelog into `[{ version, summary, body }]`, in file order.
     *
     * The file is hand-written, so this stays deliberately shallow: a `## x.y.z`
     * heading opens a section, the first prose line becomes the one-line summary,
     * and the remaining lines are kept verbatim for the expandable detail. It never
     * throws — a notice without notes beats a notice that fails to render.
     */
    function parseChangelog(markdown) {
      const versions = [];
      let current = null;
      for (const rawLine of String(markdown ?? "").split(/\r?\n/)) {
        const heading = /^##\s+(\d+(?:\.\d+)*)\s*$/.exec(rawLine.trim());
        if (heading !== null) {
          current = { version: heading[1], summary: "", body: [] };
          versions.push(current);
          continue;
        }
        if (current === null) continue;
        const line = rawLine.trim();
        if (line === "" || line.startsWith("#")) continue;
        current.body.push(line);
        if (current.summary === "" && !line.startsWith("-") && !line.startsWith("|")) {
          current.summary = stripMarkdown(line).slice(0, 140);
        }
      }
      return versions;
    }

    /**
     * Read the live manifest and the changelog beside it.
     *
     * @returns `{ latest, notes, error }` — `latest` is `""` when the manifest
     *   could not be read at all. The notes are best effort: a changelog that
     *   fails to load downgrades the notice, it does not fail the check.
     */
    async function fetchUpdateInfo(force) {
      if (!force && updateCache !== null && Date.now() - updateCache.at < UPDATE_CACHE_MS) return updateCache.value;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller === null ? null : setTimeout(() => controller.abort(), 12000);
      const signal = controller === null ? undefined : controller.signal;
      let value;
      try {
        const stamp = `?t=${String(Date.now())}`;
        const [manifestResponse, changelogResponse] = await Promise.all([
          fetch(`${MANIFEST_URL}${stamp}`, { headers: { accept: "application/json" }, signal }),
          fetch(`${CHANGELOG_URL}${stamp}`, { headers: { accept: "text/plain" }, signal }).catch(() => null)
        ]);
        if (!manifestResponse.ok) throw new Error(`http-${String(manifestResponse.status)}`);
        const body = await manifestResponse.json();
        if (body === null || typeof body.version !== "string" || body.version === "") throw new Error("no-version");
        let markdown = "";
        if (changelogResponse !== null && changelogResponse.ok === true) {
          markdown = await changelogResponse.text().catch(() => "");
        }
        value = { latest: body.version, notes: parseChangelog(markdown), error: "" };
      } catch (error) {
        value = { latest: "", notes: [], error: error instanceof Error ? error.message : String(error) };
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
      updateCache = { at: Date.now(), value };
      return value;
    }

    /** The changelog entries newer than the running build, newest first. */
    function newerNotes(info) {
      return (Array.isArray(info?.notes) ? info.notes : []).filter(
        (note) => compareVersions(note.version, INSTALLED_VERSION) === 1
      );
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
        /** Set by apply() when the direct-mount fallback had to take over. */
        this.mountNote = "";
        /** Live renderer read-out, refreshed on every sync. */
        this.status = null;
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
     * Restate a color at a different alpha, keeping its channels.
     *
     * The chrome token is repainted with the *current* theme color at a lowered
     * alpha rather than cleared outright: a sidebar exactly as transparent as the
     * conversation area stops reading as a panel, and the official shell relies on
     * the fill to separate the two.
     */
    const withAlpha = (color, alpha) => {
      const parsed = readColor(color);
      if (parsed === null) return `rgba(0, 0, 0, ${String(alpha)})`;
      return `rgba(${String(parsed.r)}, ${String(parsed.g)}, ${String(parsed.b)}, ${String(alpha)})`;
    };

    /**
     * Parse a resolved color — `rgb()`, `rgba()`, `#rgb`, `#rrggbb` or the 8-digit
     * hex form — or `null` when the value is something else (`transparent`,
     * `currentColor`, an unevaluated `var()`).
     *
     * The hex branches are load-bearing, not a convenience: the shell declares
     * nearly every one of its tokens as hex. A parser that understood only
     * `rgba()` returned `null` for all of them, and every caller reads `null` as
     * "leave this one alone" — so the sidebar, the composer, the menus and the
     * bubbles were never repainted at all, while the wallpaper showed straight
     * through them. That is the "the chrome has no fill and the text is
     * unreadable" report.
     */
    function readColor(color) {
      const text = String(color ?? "").trim();
      const hex = /^#([\da-f]{6}|[\da-f]{3})([\da-f]{2})?$/i.exec(text);
      if (hex !== null) {
        const digits = hex[1];
        const step = digits.length / 3;
        const channel = (index) => {
          const part = digits.slice(index * step, index * step + step);
          return Number.parseInt(part.length === 1 ? part + part : part, 16);
        };
        return {
          r: channel(0),
          g: channel(1),
          b: channel(2),
          a: hex[2] === undefined ? 1 : Number((Number.parseInt(hex[2], 16) / 255).toFixed(3))
        };
      }
      const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/i.exec(text);
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
        // Set when the host half declares this shell unsupported: nothing paints.
        this.halted = false;
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
        /** Style tag carrying the skin overrides, plus the adapter id behind it. */
        this.skinTag = null;
        this.skinKey = null;
        /**
         * Set once the browser refuses an unmuted autoplay, until the next user
         * gesture clears it. Re-running the same rejected `play()` on every
         * settings change would only stutter, so it is remembered instead.
         */
        this.autoplayBlocked = false;
        /** Teardown for the one-shot listeners that give the sound back. */
        this.gestureCleanup = null;
        /**
         * Shell boxes whose own opaque fill this plugin cleared, mapped to the
         * inline value that was there before, so teardown can put it back.
         */
        this.cleared = new Map();
        /** Re-scans the shell after a navigation rebuilds its frame. */
        this.domObserver = null;
        this.domTimer = null;
        /** The translucent fill and frost written onto the application backdrop. */
        this.frameAlpha = 0;
        this.frameBlur = "";
      }

      /** Mount the layers and subscribe to the store. */
      start() {
        if (this.document === null || this.root !== null) return;
        this.mountStyle();
        this.mountLayers();
        this.unsubscribe = this.store.subscribe(() => this.sync());
        // Two things outside this plugin change the right answer: the palette
        // switch (which repaints the light-theme scrim) and a skin being mounted
        // or retracted (which decides whether the skin overrides are needed at
        // all). Both land as attributes on `<html>` or `<body>`, so one observer
        // watching those two elements covers them.
        if (typeof MutationObserver === "function") {
          this.themeObserver = new MutationObserver(() => this.sync());
          this.themeObserver.observe(this.document.documentElement, { attributes: true });
          if (this.document.body !== null) {
            this.themeObserver.observe(this.document.body, { attributes: true });
          }
        }
        // Navigation rebuilds the shell's frame, and a rebuilt frame arrives
        // opaque again. Watching for child-list changes catches that without a
        // poll loop; attributes are deliberately not watched, so the styles this
        // plugin writes below can never retrigger the observer.
        if (typeof MutationObserver === "function" && this.document.body !== null) {
          this.domObserver = new MutationObserver(() => this.scheduleBackdropClear());
          this.domObserver.observe(this.document.body, { childList: true, subtree: true });
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
        if (this.gestureCleanup !== null) this.gestureCleanup();
        this.autoplayBlocked = false;
        if (this.domObserver !== null) {
          this.domObserver.disconnect();
          this.domObserver = null;
        }
        if (this.domTimer !== null) {
          clearTimeout(this.domTimer);
          this.domTimer = null;
        }
        this.restoreShellBackdrop();
        this.releaseMedia();
        if (this.styleTag !== null) this.styleTag.remove();
        this.styleTag = null;
        if (this.skinTag !== null) this.skinTag.remove();
        this.skinTag = null;
        this.skinKey = null;
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
            "--dsw-alias-bg-layer-1",
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
        const body = this.document.body;
        // Snapshot the shell's real layer-1 before the wildcard rule below takes
        // it transparent. The hover/raised blends mix toward this opaque value,
        // and reading it after the override would return the plugin's own
        // translucency, fading the chrome out on the light theme.
        this.originalTokens["--dsw-alias-bg-layer-1"] = this.token(body, "--dsw-alias-bg-layer-1");
        const tag = this.document.createElement("style");
        tag.id = ID.layers;
        tag.setAttribute(OWNED, "");
        tag.textContent = [
          `body[${BODY_ATTR}]{background:transparent !important}`,
          // The shell's root and its outermost frame are cleared as *boxes*, not
          // by repainting a token. Two reasons, both learned the hard way:
          // `--dsw-alias-bg-base` is inherited by every box in the tree, so
          // taking it transparent also emptied the sidebar, the composer and
          // every popover and left their text on bare picture; and the frame
          // resolves a fill no token override reaches at all. Clearing the two
          // boxes that actually stand between the wallpaper and the content
          // leaves the chrome its own fill.
          `body[${BODY_ATTR}] #root,body[${BODY_ATTR}] #root>*{background-color:transparent !important}`,
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
      /** Queue one backdrop re-scan, coalescing bursts of DOM churn. */
      scheduleBackdropClear() {
        if (this.domTimer !== null) return;
        this.domTimer = setTimeout(() => {
          this.domTimer = null;
          this.clearShellBackdrop();
        }, 120);
      }

      /**
       * Clear the shell's own opaque backdrop boxes.
       *
       * The frame covering the viewport is not painted from any `--dsw-*` token
       * this plugin can repaint: it resolves a fill the shell hard-codes, or one
       * declared on a hashed class name no selector can name. Repainting tokens
       * therefore leaves it solid and the wallpaper invisible — which reads
       * exactly like "the picture never loaded". Reading the box's computed
       * colour and clearing it directly is the only thing that reaches it.
       *
       * Two guards keep this off the chrome: only a fully opaque colour is
       * eligible (the scrim is 50% black), and only a box covering most of the
       * viewport is (the settings sheet and the sidebar are both smaller). Fixed
       * boxes are skipped outright — those are intentional overlays stacked above
       * the shell's frame.
       */
      clearShellBackdrop() {
        if (this.disposed || this.document === null) return;
        const win = this.document.defaultView;
        const shell = this.document.getElementById("root");
        if (win === null || shell === null) return;
        const area = win.innerWidth * win.innerHeight;
        if (area <= 0) return;
        for (const element of Array.from(this.cleared.keys())) {
          // A rebuilt shell drops the old boxes; their inline styles went with
          // them, so a stale entry only leaks memory.
          if (!element.isConnected) this.cleared.delete(element);
        }
        const all = shell.querySelectorAll("*");
        for (let index = 0; index < all.length && index < 400; index += 1) {
          const candidate = all[index];
          const style = win.getComputedStyle(candidate);
          // Fixed and absolutely positioned boxes are overlays the shell stacks
          // above its own frame — sheets, drawers, menus. Taking those out
          // changes what the user sees inside them.
          if (style.position === "fixed" || style.position === "absolute") continue;
          const entry = this.cleared.get(candidate);
          const parsed = readColor(style.backgroundColor);
          // An already-repainted box is revisited rather than skipped: its fill
          // has since gone translucent, and a slider move has to be able to reach
          // it again.
          if (entry === undefined && parsed === null) continue;
          const rect = candidate.getBoundingClientRect();
          const width = rect.width;
          const height = rect.height;
          if (width * height < area * 0.25) continue;
          // Three shapes carry the shell's own opaque fill, and each needs the
          // same glass for a different reason. The application backdrop spans the
          // window and everything else takes its fill from it. The sidebar hugs
          // the left edge and never spans the window — it is the panel that stays
          // dead black while the rest turns to glass. A sheet — the settings
          // panel, the composer, a centred popover — is centred and shorter than
          // the window. Anything else is page content and stays clear, so the
          // wallpaper shows through the conversation.
          const isBackdrop = width * height >= area * 0.95;
          const isSidebar = rect.left <= 4 && width < win.innerWidth * 0.35 && height > win.innerHeight * 0.5;
          const isSheet =
            Math.abs(rect.left + width / 2 - win.innerWidth / 2) <= 8 &&
            height < win.innerHeight * 0.95 &&
            width > win.innerWidth * 0.2;
          if (entry === undefined) {
            const background = candidate.style.backgroundColor;
            const filter = candidate.style.backdropFilter;
            this.cleared.set(candidate, {
              background: background === "" ? null : background,
              filter: filter === "" ? null : filter,
              fill: parsed
            });
          }
          const known = this.cleared.get(candidate);
          if (known === undefined || known.fill === null) continue;
          const { fill } = known;
          if (isBackdrop === false && isSidebar === false && isSheet === false) {
            // Page content: cleared outright, because this is where the wallpaper
            // is supposed to be visible.
            candidate.style.setProperty("background-color", "transparent", "important");
            continue;
          }
          candidate.style.setProperty(
            "background-color",
            `rgba(${String(fill.r)}, ${String(fill.g)}, ${String(fill.b)}, ${String(this.frameAlpha)})`,
            "important"
          );
          candidate.style.setProperty(
            "backdrop-filter",
            this.frameBlur === "" ? "none" : this.frameBlur,
            "important"
          );
        }
      }

      /** Put every repainted shell box back the way the shell left it. */
      restoreShellBackdrop() {
        for (const [element, entry] of this.cleared) {
          if (entry.background === null) element.style.removeProperty("background-color");
          else element.style.backgroundColor = entry.background;
          if (entry.filter === null) element.style.removeProperty("backdrop-filter");
          else element.style.backdropFilter = entry.filter;
        }
        this.cleared.clear();
      }

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

        // The content column — the chat history, the page behind this very panel,
        // the whole centre of the app — is painted from the same layer token the
        // chrome uses. Left alone it is an opaque slab that hides the wallpaper
        // completely, which is the report this plugin exists to answer; taken
        // fully transparent it leaves the text sitting on bare picture, which is
        // how the previous release shipped. It is brought down to a translucent
        // fill instead: enough of the picture shows through to read as a
        // wallpaper, enough fill remains for the text to sit on. Its real value
        // was captured by `original()` above, so the hover and raised blends
        // built from it below keep the correct tone.
        const layer1 = original("--dsw-alias-bg-layer-1");
        const parsedLayer1 = readColor(layer1);
        if (parsedLayer1 !== null) {
          const alpha = Number(clamp(parsedLayer1.a * surfaces * 0.6, 0, 0.6).toFixed(3));
          body.style.setProperty(
            "--dsw-alias-bg-layer-1",
            alpha <= 0 ? "transparent" : withAlpha(layer1, alpha),
            "important"
          );
        }

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
        // moment the pointer moves. The two layer tokens additionally follow the
        // chrome-opacity slider: a raised surface is chrome too, and while it
        // stayed opaque that slider did nothing at all on any region the shell
        // builds from a layer token — which is most of the page, including the
        // slab that hides the wallpaper.
        const panel = original("--dsw-specific-menu");
        for (const [token, amount, follows] of [
          ["--dsw-alias-interactive-bg-hover", 0.06, false],
          ["--dsw-alias-interactive-bg-hover-accent", 0.12, false],
          ["--dsw-alias-bg-layer-2", 0.05, true],
          ["--dsw-alias-bg-layer-3", 0.09, true]
        ]) {
          const base = original(token);
          if (readColor(base) === null) continue;
          const mixed = mixColor(base, solidTarget, amount);
          if (follows === false) {
            body.style.setProperty(token, mixed, "important");
            continue;
          }
          const parsed = readColor(mixed);
          const alpha = surfaces <= 0.001 ? 0 : Number(clamp((parsed === null ? 1 : parsed.a) * surfaces, 0, 1).toFixed(3));
          body.style.setProperty(token, alpha <= 0 ? "transparent" : withAlpha(mixed, alpha), "important");
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
        // The application backdrop gets the same treatment, and it is the one that
        // matters most: the sidebar and the top bar have no fill of their own, so
        // the glass they sit on is this box's fill. `clearShellBackdrop` reads
        // these two to restate it, which is why a slider move has to be able to
        // reach that box again after it has already been repainted once.
        this.frameAlpha = Number(clamp(surfaces * 0.85, 0, 0.85).toFixed(3));
        this.frameBlur = filter;
      }

      /**
       * Hand the live state to the panel, so a report is a read-out instead of a
       * guess. Everything here is observable from the page without devtools.
       */
      publishStatus() {
        this.store.status = this.diagnose();
      }

      /** One snapshot of what the renderer believes is on screen right now. */
      diagnose() {
        const config = this.store.get();
        const root = this.root;
        const media = this.mediaElement;
        return {
          layerMounted: root !== null && root.isConnected,
          layerDisplay: root === null ? "none" : root.style.display || "block",
          mediaKind: media === null ? "none" : media.tagName.toLowerCase(),
          mediaSrc: media === null ? "" : String(media.currentSrc || media.src || "").slice(0, 160),
          mediaComplete: media === null || media.tagName !== "IMG" ? null : media.complete && media.naturalWidth > 0,
          // The sound path is the one thing a user cannot see, and a muted element
          // and a blocked autoplay look identical from the outside, so it is
          // reported rather than guessed at.
          sound: config.sound === true,
          volume: config.volume,
          dim: config.dim,
          opacity: config.opacity,
          mediaMuted: media === null || media.tagName !== "VIDEO" ? null : media.muted,
          mediaPaused: media === null || media.tagName !== "VIDEO" ? null : media.paused,
          autoplayBlocked: this.autoplayBlocked === true,
          activeId: config.activeId,
          hasItem: this.store.item(config.activeId) !== null,
          surfacesPainted: this.surfaceKey !== null,
          backdrop: this.document === null ? "" : this.token(this.document.body, "--dsw-alias-bg-base"),
          mountNote: this.store.mountNote ?? "",
          bodyAttr: this.document === null ? "" : this.document.body.dataset.dshMural ?? "",
          skin: this.document === null ? "" : detectSkin(this.document)?.id ?? "",
          skinCovered: this.skinTag !== null,
          failed: [...this.failed]
        };
      }

      /**
       * Let the wallpaper through a skin that paints the whole shell itself.
       *
       * Idempotent and cheap: the work is keyed on the adapter id, so the store
       * notifications that fire on every slider drag do not rewrite the sheet.
       * `null` means no adapter applies and any existing sheet is retracted,
       * which is what happens when the wallpaper is switched off, when the shell
       * is declared unsupported, and when the skin is unloaded.
       */
      applySkinCompat() {
        if (this.document === null) return;
        const adapter = this.halted || this.store.get().enabled === false ? null : detectSkin(this.document);
        const key = adapter === null ? "" : adapter.id;
        if (this.skinKey === key) return;
        this.skinKey = key;
        if (this.skinTag !== null) {
          this.skinTag.remove();
          this.skinTag = null;
        }
        if (adapter === null) return;
        const tag = this.document.createElement("style");
        tag.id = ID.skin;
        tag.setAttribute(OWNED, "");
        tag.textContent = skinCompatCss(adapter);
        this.document.head.appendChild(tag);
        this.skinTag = tag;
      }

      /**
       * Stop painting and hand every surface back.
       *
       * Used when the host half reports a shell this build was not written
       * against: the layers come down and the tokens return to the shell's own
       * values, so the stock interface survives intact.
       */
      halt() {
        this.halted = true;
        if (this.root !== null) {
          this.releaseMedia();
          this.root.remove();
          this.root = null;
          this.mediaHost = null;
          this.scrim = null;
          this.vignette = null;
        }
        this.applySkinCompat();
        this.applySurface(this.store.get());
        this.publishStatus();
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
        if (this.disposed) return;
        // Deliberately ahead of the guards below: a halted or not-yet-mounted
        // renderer is exactly when the skin overrides must be retracted.
        this.applySkinCompat();
        if (this.root === null || this.halted) return;
        const config = this.store.get();
        const item = config.enabled === false ? null : this.store.item(config.activeId);
        this.applyFrame(config);
        this.applySurface(config);
        if (config.enabled !== false) this.clearShellBackdrop();
        else this.restoreShellBackdrop();
        this.publishStatus();
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
        // Sound, volume and looping are element properties rather than styles, so
        // they belong here and not in the CSS. Without this a video mounted while
        // the switch was off stays silent for good: the element is only rebuilt
        // when the *item* changes, and flipping the switch is not a change of item.
        if (element.tagName === "VIDEO") {
          const volume = clamp(config.volume, 0, 100) / 100;
          const wantsSound = config.sound === true && volume > 0;
          const shouldBeMuted = wantsSound === false;
          element.loop = config.playback !== "once";
          if (Math.abs(element.volume - volume) > 0.001) element.volume = volume;
          if (element.muted !== shouldBeMuted && this.autoplayBlocked !== true) this.startMedia();
        }
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

      /**
       * Start the mounted element, falling back to a muted start when the browser
       * refuses to autoplay with sound.
       *
       * Chromium only allows an unmuted `play()` after the document has been
       * interacted with, and a wallpaper has no gesture of its own to offer. An
       * unmuted play can therefore reject outright — and a rejected play leaves
       * the frame unpainted, which reads as "the plugin is broken" rather than
       * "the sound was blocked". Muted autoplay is always allowed, so the picture
       * starts either way and the sound comes back on the first real interaction.
       */
      startMedia() {
        const element = this.mediaElement;
        if (element === null || typeof element.play !== "function") return;
        const config = this.store.get();
        const volume = clamp(config.volume, 0, 100) / 100;
        element.volume = volume;
        element.muted = config.sound !== true || volume <= 0 || this.autoplayBlocked === true;
        const started = element.play();
        if (started === null || started === undefined || typeof started.catch !== "function") return;
        started.catch(() => {
          if (this.disposed || element !== this.mediaElement) return;
          // Refused. Silence beats a frozen wallpaper, so start muted and hand the
          // sound to the next click.
          this.autoplayBlocked = true;
          element.muted = true;
          const retry = element.play();
          if (retry !== null && retry !== undefined && typeof retry.catch === "function") retry.catch(() => {});
          this.unmuteOnGesture();
        });
      }

      /**
       * Unmute the playing element once the user touches the page.
       *
       * A refused autoplay is not the end of it: the restriction is lifted by the
       * first interaction, so the element is unmuted in place — no reload, the
       * picture never stops. Armed at most once at a time, and disarmed by the
       * first event that arrives.
       */
      unmuteOnGesture() {
        if (this.gestureCleanup !== null || this.document === null) return;
        const resume = () => {
          if (this.gestureCleanup !== null) this.gestureCleanup();
          this.autoplayBlocked = false;
          const element = this.mediaElement;
          if (this.disposed || element === null || element.tagName !== "VIDEO") return;
          const config = this.store.get();
          if (config.sound !== true || element.paused) return;
          element.muted = false;
          element.volume = clamp(config.volume, 0, 100) / 100;
          const started = element.play();
          if (started !== null && started !== undefined && typeof started.catch === "function") started.catch(() => {});
        };
        const options = { capture: true };
        this.document.addEventListener("pointerdown", resume, options);
        this.document.addEventListener("keydown", resume, options);
        this.gestureCleanup = () => {
          if (this.gestureCleanup === null) return;
          this.document.removeEventListener("pointerdown", resume, options);
          this.document.removeEventListener("keydown", resume, options);
          this.gestureCleanup = null;
        };
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
          video.loop = config.playback !== "once";
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
          // Started through `startMedia`, which knows about the autoplay policy:
          // an unmuted `play()` may reject, and a rejected play leaves the frame
          // unpainted before any fallback could run.
          this.startMedia();
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
          // Back through `startMedia`, so a restore can neither end up louder than
          // the autoplay policy allows nor stay muted after the switch changed.
          this.startMedia();
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
      const [updateState, setUpdateState] = React.useState({ status: "idle", latest: "", notes: [], error: "" });
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

      /**
       * Put every appearance field back to the shipped default.
       *
       * The settings interact — a blurred wallpaper behind opaque chrome looks
       * like nothing loaded at all — so "I turned some knobs and now it looks
       * broken" needs one way back that does not require knowing which knob.
       */
      const resetAppearance = React.useCallback(() => {
        for (const [key, value] of Object.entries(APPEARANCE_DEFAULTS)) update(key, value);
      }, [update]);

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
        setUpdateState({ status: "checking", latest: "", notes: [], error: "" });
        setCopyState("");
        const result = await fetchUpdateInfo(force === true);
        if (result.latest === "") {
          setUpdateState({ status: "error", latest: "", notes: [], error: result.error });
          return;
        }
        const order = compareVersions(result.latest, INSTALLED_VERSION);
        const notes = newerNotes(result);
        if (order === null) {
          setUpdateState({ status: "unknown", latest: result.latest, notes, error: "" });
          return;
        }
        setUpdateState({ status: order > 0 ? "available" : "current", latest: result.latest, notes, error: "" });
      }, []);

      /** Copy the exact reinstall command, with a short confirmation. */
      const copyUpdateCommand = React.useCallback(async () => {
        try {
          await navigator.clipboard.writeText(REINSTALL_COMMAND);
          setCopyState(tr("updateCopied"));
        } catch {
          setCopyState("");
        }
      }, []);

      // Probe once on mount, without a spinner flash: the badge simply fills in.
      // Honours the same switch as the corner notice, so a user who turned the
      // automatic check off does not get phoned home just by opening the panel.
      React.useEffect(() => {
        if (store.get().autoCheckUpdate === false) return;
        void checkForUpdate(false);
      }, [checkForUpdate, store]);

      /** Copy a plain-text report, so a "nothing shows up" report is one paste. */
      const copyReport = React.useCallback(async () => {
        const live = store.status;
        const lines = [
          `mural version: ${INSTALLED_VERSION}`,
          `page: ${typeof location === "undefined" ? "" : location.href}`,
          `body attr: ${typeof document === "undefined" ? "" : String(document.body.dataset.dshMural ?? "(none)")}`,
          `unsupported attr: ${
            typeof document === "undefined" ? "" : String(document.body.dataset.dshMuralUnsupported ?? "(none)")
          }`,
          `skin: ${
            typeof document === "undefined"
              ? ""
              : `${detectSkin(document)?.id ?? "(none)"} · stepped aside: ${String(
                  document.getElementById("dsh-mural-skin-css") !== null
                )}`
          }`,
          `layer element: ${
            typeof document === "undefined" ? "" : String(document.getElementById("dsh-mural-root") !== null)
          }`,
          `layer style tag: ${
            typeof document === "undefined" ? "" : String(document.getElementById("dsh-mural-layers-css") !== null)
          }`,
          `live status: ${live === null || live === undefined ? "(none)" : JSON.stringify(live)}`,
          `mount note: ${store.mountNote === "" ? "(effect ran)" : store.mountNote}`,
          `overview error: ${error === "" ? "(none)" : error}`,
          `library items: ${String(library.items.length)}`,
          `library root: ${library.root}`,
          `api health: ${String(diagnostics?.api ?? "(not probed)")}`,
          paintProbe(typeof document === "undefined" ? null : document, typeof window === "undefined" ? null : window)
        ];
        try {
          await navigator.clipboard.writeText(lines.join("\n"));
          setCopyState(tr("reportCopied"));
        } catch {
          setCopyState("");
        }
      }, [diagnostics, error, library.items.length, library.root, store]);

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
          h("p", { className: "dsh-mural-hint" }, tr("blurHint")),
          h(Slider, { label: tr("opacity"), value: config.opacity, onChange: (value) => update("opacity", value) }),
          h(Toggle, { label: tr("vignette"), checked: config.vignette !== false, onChange: (value) => update("vignette", value) }),
          h(Slider, { label: tr("surfaceStrength"), value: config.surfaceStrength, min: 0, max: 100, onChange: (value) => update("surfaceStrength", value) }),
          h(Slider, { label: tr("surfaceBlur"), value: config.surfaceBlur, min: 0, max: 40, onChange: (value) => update("surfaceBlur", value) }),
          h("p", { className: "dsh-mural-hint" }, tr("surfaceHint")),
          h(Slider, { label: tr("lightThemeDim"), value: config.lightThemeDim, min: 0, max: 40, onChange: (value) => update("lightThemeDim", value) }),
          h("p", { className: "dsh-mural-hint" }, tr("lightThemeDimHint")),
          h(
            "button",
            { type: "button", className: "dsh-mural-btn dsh-mural-btn-ghost", onClick: resetAppearance },
            tr("resetAppearance")
          )
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
          config.sound === true && store.status?.autoplayBlocked === true
            ? h("p", { className: "dsh-mural-hint" }, tr("soundBlocked"))
            : h("p", { className: "dsh-mural-hint" }, tr("soundHint")),
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
              (() => {
                const live = store.status;
                if (live === null || live === undefined) return tr("layerMissing");
                if (!live.layerMounted) return tr("layerMissing");
                if (live.layerDisplay === "none") return tr("layerHidden");
                return `${tr("layerOk")} · ${live.mediaKind}`;
              })()
            ),
            h(
              "span",
              { className: "dsh-mural-hint" },
              `${tr("surfaces")}: ${store.status?.surfacesPainted === true ? tr("ok") : tr("bad")} · ${
                tr("backdrop")
              }: ${store.status?.backdrop || "—"}`
            ),
            h(
              "span",
              { className: "dsh-mural-hint" },
              (() => {
                const adapter = typeof document === "undefined" ? null : detectSkin(document);
                if (adapter === null) return `${tr("skinCompat")}: ${tr("skinNone")}`;
                const active = document.getElementById("dsh-mural-skin-css") !== null;
                return `${tr("skinCompat")}: ${format(tr("skinCovered"), { label: adapter.label })}${
                  active ? "" : ` · ${tr("bad")}`
                }`;
              })()
            ),
            h(
              "button",
              { type: "button", className: "dsh-mural-btn dsh-mural-btn-ghost", onClick: () => void copyReport() },
              copyState !== "" ? copyState : tr("copyReport")
            )
          ),
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
                  h(
                    "span",
                    { className: "dsh-mural-hint" },
                    updateState.notes.length === 0
                      ? format(tr("updateRunning"), { current: INSTALLED_VERSION, latest: updateState.latest })
                      : format(tr(updateState.notes.length === 1 ? "updateBehindOne" : "updateBehind"), {
                          current: INSTALLED_VERSION,
                          latest: updateState.latest,
                          count: updateState.notes.length
                        })
                  ),
                  updateState.notes.length === 0
                    ? null
                    : h(
                        "div",
                        { className: "dsh-mural-noticeNotes" },
                        h("div", { className: "dsh-mural-noticeNotesTitle" }, tr("updateNotes")),
                        updateState.notes.map((note) =>
                          h(
                            "details",
                            { key: note.version, className: "dsh-mural-noticeNote" },
                            h(
                              "summary",
                              null,
                              note.summary === "" ? `v${note.version}` : `v${note.version} — ${note.summary}`
                            ),
                            note.body.length === 0
                              ? null
                              : h(
                                  "div",
                                  { className: "dsh-mural-noticeBody" },
                                  note.body.slice(0, UPDATE_BODY_MAX_LINES).join("\n")
                                )
                          )
                        )
                      ),
                  h("span", { className: "dsh-mural-hint" }, tr("updateHint")),
                  h("code", { className: "dsh-mural-cmd" }, REINSTALL_COMMAND),
                  h(
                    "button",
                    { type: "button", className: "dsh-mural-btn", onClick: () => void copyUpdateCommand() },
                    copyState !== "" ? copyState : tr("updateCopy")
                  )
                )
              : null,
            h(Toggle, {
              label: tr("autoCheck"),
              checked: config.autoCheckUpdate !== false,
              onChange: (value) => update("autoCheckUpdate", value, true)
            }),
            h("p", { className: "dsh-mural-hint" }, tr("autoCheckHint"))
          )
        )
      );
    }

    //#endregion

    //#region update notice

    /** Expandable note bodies are clipped here, so one long release stays readable. */
    const UPDATE_BODY_MAX_LINES = 40;

    /**
     * The bottom-right "a newer build exists" notice.
     *
     * Plain DOM rather than React on purpose: it has to appear whether or not the
     * settings page was ever opened, and it must survive that slot remounting.
     * Everything that comes off the network is written with `textContent` — the
     * changelog is remote content and must never become markup.
     */
    class UpdateNotice {
      constructor(store) {
        this.store = store;
        this.document = typeof document === "undefined" ? null : document;
        this.element = null;
        this.styleTag = null;
        this.timer = null;
        this.disposed = false;
      }

      /** Insert the sheet this component needs, once. */
      mountStyle() {
        if (this.document === null || this.document.getElementById(ID.notice) !== null) return;
        const tag = this.document.createElement("style");
        tag.id = ID.notice;
        tag.setAttribute(OWNED, "");
        tag.textContent = NOTICE_CSS;
        this.document.head.appendChild(tag);
        this.styleTag = tag;
      }

      /** One deferred check, so mounting never waits on the network. */
      start() {
        if (this.document === null || this.timer !== null) return;
        this.mountStyle();
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.check(false);
        }, UPDATE_NOTICE_DELAY_MS);
      }

      /**
       * Read the repository and show the notice when a newer build exists.
       *
       * Silence is the default on every failure path: a user who is offline, rate
       * limited or behind a proxy should never be told the plugin is broken. The
       * panel keeps the explicit button for a check the user actually asked for.
       */
      async check(force) {
        if (this.disposed || this.document === null) return null;
        if (this.store.get().autoCheckUpdate === false) return null;
        const info = await fetchUpdateInfo(force === true);
        if (this.disposed) return null;
        if (info.latest === "") return null;
        if (compareVersions(info.latest, INSTALLED_VERSION) !== 1) {
          this.hide();
          return info;
        }
        if (info.latest === this.store.get().skipUpdateVersion) {
          this.hide();
          return info;
        }
        this.show(info);
        return info;
      }

      /** Detach the notice without touching the stored preference. */
      hide() {
        if (this.element !== null) {
          this.element.remove();
          this.element = null;
        }
      }

      /** A plain text node, the only way remote strings enter this DOM. */
      text(tag, className, value) {
        const node = this.document.createElement(tag);
        if (className !== undefined && className !== "") node.className = className;
        node.textContent = value;
        return node;
      }

      /** A button wired to one handler. */
      button(label, handler, primary) {
        const node = this.text("button", `dsh-mural-btn${primary === true ? " dsh-mural-btn-primary" : " dsh-mural-btn-ghost"}`, label);
        node.type = "button";
        node.addEventListener("click", handler);
        return node;
      }

      /** An external link, opened by the OS browser in the desktop app. */
      link(label, href) {
        const node = this.text("a", "dsh-mural-btn dsh-mural-btn-ghost dsh-mural-noticeLink", label);
        node.href = href;
        node.target = "_blank";
        node.rel = "noreferrer noopener";
        return node;
      }

      /** Build and attach the notice for one update payload. */
      show(info) {
        if (this.document === null || this.document.body === null) return;
        this.hide();
        const notes = newerNotes(info);
        const root = this.text("div", "dsh-mural-notice", "");
        root.setAttribute(OWNED, "");
        root.setAttribute("role", "status");

        const head = this.text("div", "dsh-mural-noticeHead", "");
        head.append(
          this.text("strong", "dsh-mural-noticeTitle", format(tr("updateFound"), { version: info.latest })),
          this.button(tr("updateMute"), () => {
            this.store.set("skipUpdateVersion", info.latest, true);
            this.hide();
          })
        );

        const behind =
          notes.length === 0
            ? format(tr("updateRunning"), { current: INSTALLED_VERSION, latest: info.latest })
            : format(tr(notes.length === 1 ? "updateBehindOne" : "updateBehind"), {
                current: INSTALLED_VERSION,
                latest: info.latest,
                count: notes.length
              });

        const notesBox = this.text("div", "dsh-mural-noticeNotes", "");
        notesBox.appendChild(this.text("div", "dsh-mural-noticeNotesTitle", tr("updateNotes")));
        if (notes.length === 0) {
          notesBox.appendChild(this.text("div", "dsh-mural-hint", tr("updateNoNotes")));
        } else {
          for (const note of notes) {
            const details = this.document.createElement("details");
            details.className = "dsh-mural-noticeNote";
            details.appendChild(
              this.text(
                "summary",
                "",
                note.summary === "" ? `v${note.version}` : `v${note.version} — ${note.summary}`
              )
            );
            if (note.body.length > 0) {
              details.appendChild(
                this.text("div", "dsh-mural-noticeBody", note.body.slice(0, UPDATE_BODY_MAX_LINES).join("\n"))
              );
            }
            notesBox.appendChild(details);
          }
        }

        const hint = this.text("div", "dsh-mural-hint", `${tr("updateRepoHintPrefix")} `);
        hint.appendChild(this.link(REPO_URL, REPO_URL));
        hint.appendChild(this.document.createTextNode(` ${tr("updateRepoHintSuffix")}`));
        hint.appendChild(this.text("code", "dsh-mural-cmd", REINSTALL_COMMAND));

        const copyAgent = this.button(tr("updateCopyAgent"), () => {
          void (async () => {
            try {
              await navigator.clipboard.writeText(this.agentNote(info, notes));
              copyAgent.textContent = tr("updateCopiedAgent");
            } catch {
              /* clipboard denied: leave the label alone rather than lie */
            }
          })();
        });

        const recheck = this.button(tr("updateRecheck"), () => {
          recheck.disabled = true;
          recheck.textContent = tr("checkingUpdate");
          void (async () => {
            const next = await this.check(true);
            if (this.disposed) return;
            recheck.disabled = false;
            if (next === null || next.latest === "") {
              recheck.textContent = tr("updateFailed");
              return;
            }
            recheck.textContent =
              compareVersions(next.latest, INSTALLED_VERSION) === 1 ? tr("updateRecheck") : tr("upToDate");
          })();
        });

        root.append(
          head,
          this.text("div", "dsh-mural-hint", behind),
          notesBox,
          hint,
          (() => {
            const actions = this.text("div", "dsh-mural-noticeActions", "");
            actions.append(copyAgent, recheck, this.link(tr("updateRelease"), RELEASE_URL));
            return actions;
          })()
        );
        this.document.body.appendChild(root);
        this.element = root;
      }

      /** The note a user pastes back into DSH to have the upgrade done for them. */
      agentNote(info, notes) {
        const lines = [
          format(tr("updateAgentNote"), {
            repo: REPO_URL,
            current: INSTALLED_VERSION,
            latest: info.latest,
            command: REINSTALL_COMMAND
          })
        ];
        if (notes.length > 0) {
          lines.push("", tr("updateNotes"));
          for (const note of notes) lines.push(`- v${note.version}${note.summary === "" ? "" : ` — ${note.summary}`}`);
        }
        return lines.join("\n");
      }

      /** Retract everything this component owns. */
      dispose() {
        this.disposed = true;
        if (this.timer !== null) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        this.hide();
        if (this.styleTag !== null) this.styleTag.remove();
        this.styleTag = null;
      }
    }

    //#endregion

    //#region styles

    const NOTICE_CSS = `
body[data-dsh-mural] .dsh-mural-notice{--dsh-mural-surface:var(--dsw-static-neutral-100,#f5f5f5);--dsh-mural-control:var(--dsw-static-neutral-200,#e5e5e5);--dsh-mural-text:var(--dsw-alias-label-primary,#172a45);--dsh-mural-muted:var(--dsw-alias-label-secondary,#4b5563);--dsh-mural-faint:var(--dsw-alias-label-tertiary,#6b7280);--dsh-mural-border:var(--dsw-alias-border-l3,#cbd5e1);position:fixed;right:20px;bottom:20px;z-index:2147483000;width:min(392px,calc(100vw - 40px));max-height:min(70vh,560px);overflow:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:14px;border:1px solid var(--dsh-mural-border);background:var(--dsh-mural-surface);color:var(--dsh-mural-text);box-shadow:0 20px 52px rgba(0,0,0,.3);font-size:12.5px;line-height:1.5;text-align:left}
body[data-dsh-mural][data-ds-dark-theme] .dsh-mural-notice{--dsh-mural-surface:var(--dsw-static-neutral-850,#212123);--dsh-mural-control:var(--dsw-static-neutral-800,#292929);--dsh-mural-text:var(--dsw-alias-label-primary,#f9fafb);--dsh-mural-muted:var(--dsw-alias-label-secondary,#cfd3d6);--dsh-mural-faint:var(--dsw-alias-label-tertiary,#adb2b8);--dsh-mural-border:var(--dsw-alias-border-l3,#3c3c3d)}
html[data-ds-dark-theme] body[data-dsh-mural] .dsh-mural-notice{--dsh-mural-surface:var(--dsw-static-neutral-850,#212123);--dsh-mural-control:var(--dsw-static-neutral-800,#292929);--dsh-mural-text:var(--dsw-alias-label-primary,#f9fafb);--dsh-mural-muted:var(--dsw-alias-label-secondary,#cfd3d6);--dsh-mural-faint:var(--dsw-alias-label-tertiary,#adb2b8);--dsh-mural-border:var(--dsw-alias-border-l3,#3c3c3d)}
body[data-dsh-mural] .dsh-mural-noticeHead{display:flex;align-items:center;justify-content:space-between;gap:10px}
body[data-dsh-mural] .dsh-mural-noticeTitle{font-size:13.5px;font-weight:600}
body[data-dsh-mural] .dsh-mural-noticeNotes{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:10px;background:var(--dsh-mural-control)}
body[data-dsh-mural] .dsh-mural-noticeNotesTitle{font-size:12px;font-weight:600;color:var(--dsh-mural-muted)}
body[data-dsh-mural] .dsh-mural-noticeNote summary{cursor:pointer;font-size:12px;color:var(--dsh-mural-text)}
body[data-dsh-mural] .dsh-mural-noticeBody{margin:6px 0 0;white-space:pre-wrap;font-size:11.5px;line-height:1.6;color:var(--dsh-mural-faint);max-height:190px;overflow:auto}
body[data-dsh-mural] .dsh-mural-noticeActions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
body[data-dsh-mural] .dsh-mural-noticeLink{color:var(--dsw-alias-brand-primary,#3b82f6);text-decoration:none;word-break:break-all}
body[data-dsh-mural] .dsh-mural-noticeLink:hover{text-decoration:underline}
`;

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
        // The layers mount immediately. Only the *surface repaint* waits for the
        // host half's runtime verdict: a misplaced await here once left the
        // wallpaper unmounted behind a perfectly healthy settings panel, which is
        // a far harder failure to read than a background that simply stays opaque.
        renderer.start();
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
              renderer.halt();
            }
          })
          .catch((error) => {
            console.warn("[background-mural] initial load failed:", error);
          });
        return () => {
          stopped = true;
          renderer.dispose();
          store.status = null;
          delete document.body.dataset.dshMuralUnsupported;
        };
      }, "background-mural: renderer");
      if (typeof disposeRenderer === "function") disposers.push(disposeRenderer);

      // The corner notice deliberately does not live in the settings slot: most
      // users never open it, and a notice they have to go looking for is not a
      // notice. It shares the store, so the panel switch silences it too.
      const notice = new UpdateNotice(store);
      const disposeNotice = ctx.effect(() => {
        notice.start();
        return () => notice.dispose();
      }, "background-mural: update notice");
      if (typeof disposeNotice === "function") disposers.push(disposeNotice);

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

      // Belt and braces. Everything above assumes `ctx.effect` runs its callback.
      // If it ever does not, the layers never mount while the settings panel keeps
      // working - a failure that reads as "the plugin does nothing". One deferred
      // check catches it. `start()` is idempotent, so on the normal path this is a
      // no-op.
      window.setTimeout(() => {
        if (typeof document === "undefined") return;
        if (document.getElementById(ID.layers) !== null) return;
        store.mountNote = "effect-not-run";
        console.warn("[background-mural] ctx.effect did not run; mounting the layers directly");
        renderer.start();
      }, 1200);
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.ConfigStore = ConfigStore;
    exports.MuralRenderer = MuralRenderer;
    return module.exports;
  }
});
