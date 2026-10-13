# Mural · a DSH background plugin

English | [中文](README.zh.md)

Put your own background behind the whole DSH interface: **upload an image or a video** and Mural paints it behind the GUI. The desktop app and the web GUI run the same code — there is nothing separate to configure.

- **Images and videos.** JPG / PNG / GIF / WebP / AVIF / BMP / SVG, plus MP4 / WebM / OGV / MOV.
- **Upload, not "paste a path".** Media lives in DSH's own directory. No Wallpaper Engine, no dropping files into a magic folder first.
- **Video that actually plays.** The host half implements HTTP Range (206) streaming, so clips loop, seek, and never need to be downloaded whole.
- **Desktop + web, one code path.** Both halves speak plain same-origin HTTP and touch no Node APIs, so there is no Electron-only branch.
- **Off means off.** The master switch stops painting and stops every media request; unloading the plugin restores the shell's DOM exactly.

---

## The name

**Mural** — a mural is the big painting on the wall: the whole wall, your picture, your framing. The package is `dsh-background-mural`.

Why this name: it is short and pronounceable in both English and Chinese (背景壁画), the package name explains itself in a marketplace listing, and it collides with nothing — `dsh-skin-center` owns theme palettes and the Wallpaper Engine bridge, while Mural owns "upload my own image or video and lay it under everything".

---

## Install

### 0. Requirements

| Item | Requirement |
| --- | --- |
| DSH | `>= 0.1.1-rc.1` |
| Node | `^22.19.0 \|\| >= 24.0.0` (only needed to run the tests) |
| Dependencies | **None.** Zero third-party deps, no build step — the files in `lib/` are the shipped artifact |

### 1. From a local checkout (recommended while you evaluate it)

`link:` wires your working directory straight into the profile, so edits take effect without reinstalling:

```sh
# Web GUI
dsh plugin --profile web add link:D:\dss\dsh-code\demo1\dsh-background-mural

# Desktop profile, if you keep one
dsh plugin --profile desktop add link:D:\dss\dsh-code\demo1\dsh-background-mural
```

On macOS/Linux use `/path/to/dsh-background-mural`. If `dsh` is not on your PATH, call the executable directly or use `npx @deepseek-ai/dsh`.

### 2. From npm (once published)

```sh
dsh plugin --profile web add dsh-background-mural
```

### 3. From git

```sh
dsh plugin --profile web add github:<you>/dsh-background-mural
```

There is no `prepare` build step, so pnpm needs no `allowBuilds` authorization.

### 4. Restart and confirm it loaded

```sh
dsh web          # or just launch the desktop app
```

The boot log should show:

```
[background-mural] media library ready at <DSH_HOME>/background-mural (0 item(s))
```

Then open **Settings → Mural**.

> Installing by hand works too: append the `insert` block from `cordis.patch.yml` to `$DSH_HOME/profiles/<profile>/cordis.patch.yml` and drop the package into that profile's `node_modules/`.

### 5. Uninstall

```sh
dsh plugin --profile web remove dsh-background-mural
```

Removing the plugin only removes the loader row. **Your uploads are kept** in `<DSH_HOME>/background-mural/` and come back if you reinstall.

---

## Where your data lives

```
<DSH_HOME>/background-mural/
  index.json            library metadata (never the bytes)
  settings.json         settings (also mirrored into the settings service when available)
  media/<id>.<ext>      your uploaded originals
  tmp/                  in-flight uploads, atomically renamed into media/
```

`<DSH_HOME>` resolves from `$DSH_HOME`, falling back to `~/.dsh`.

---

## Using it

1. Open **Settings → Mural**.
2. Press **Upload image / video**, or drop files onto the dashed area. Multi-select works.
3. The last uploaded file becomes active automatically; press **Use as background** on any card to switch, and press it again on the active card to clear.
4. Tune the appearance with the sliders below.

### Settings

| Setting | What it does |
| --- | --- |
| Enable background | Master switch. Off stops painting and issues no media requests |
| Fit | Cover / Contain / Stretch / Tile |
| Focus X, Focus Y | Cover and contain only — which part of the frame survives the crop |
| Dim | 0–90, a black scrim over the media so the chrome above stays readable |
| Background blur | 0–60 px, applied to the media, not to the interface |
| Opacity | 0–100, media transparency |
| Edge vignette | Soft darkening at the top and bottom edges |
| Chrome opacity | How much of each region's own fill survives (sidebar, composer, bubbles, panels), 0 = fully transparent |
| Chrome frosted blur | Frosts those regions, 0–40 px; more blur means clearer text |
| Extra dim in light theme | Adds an extra scrim only while the light theme is active, 0–40 |
| Playback | Loop / Play once (parks on the last frame) / First frame only |
| Sound on | Muted by default; browsers may require a click before audio starts |
| Volume | 0–100 |
| Pause while hidden | Pauses video when the window is backgrounded |

### Diagnostics

The bottom of the panel expands into a self-check: API reachability, the library's absolute path, whether Range requests are answered, and which video/image codecs this browser reports (H.264 / VP9 / AV1 / WebP / AVIF). Start there when a video refuses to play.

---

## How it works

```
lib/index.js       host entry: registers routes, loads the library, persists settings
lib/routes.js      the six /api/background-mural/* routes
lib/store.js       on-disk library: index, atomic writes, path-escape fence
lib/media-types.js MIME/extension allowlists + magic-byte sniffing
lib/http-utils.js  same-origin fence, bounded JSON reader, Range parsing, streaming
lib/client.js      browser half: background layers + settings panel (one file, no build)
```

- **Host half** uses Node built-ins only. It registers six routes, bounds uploads by both `content-length` and counted bytes, writes through temp-file-plus-rename, and logs rather than throws on any route failure — a broken plugin must not take the GUI down at boot.
- **Browser half** is a pure-DOM renderer plus one React settings card. The layers are the first child of `<body>`, `z-index: 0`, `pointer-events: none`, and are accompanied by exactly one stylesheet rule that makes the shell background transparent. That rule is scoped to `data-dsh-mural`, so unloading restores everything.
- **The two halves talk over same-origin HTTP**, which is why desktop and web behave identically: no `file://` special case, no Electron IPC.

### How the wallpaper actually shows through

This is the part that is easy to get wrong, so it is written down.

**The official shell paints its own opaque background.** Its CSS reads:

```css
.BynINW_frame      { background: var(--dsw-alias-bg-base); ... }
.BynINW_sidebarCol { background: var(--dsw-specific-sidebar-fill); ... }
[data-windows-titlebar] .BynINW_centerCol { background: var(--dsw-alias-bg-base); ... }
```

So no matter what you append behind the body, as long as those tokens hold solid
colors the wallpaper is covered — which reads to the user as "the plugin does
nothing at all". Worse, `--dsw-alias-bg-base` is declared *on* `body`, so an
element-only rule loses to that declaration.

Mural therefore works at the **design-token level**, the same way community skins
do: `--dsw-alias-bg-base` is set to transparent so the wallpaper shows, and each
region's fill token is repainted from the live palette at a low alpha (see "How the
chrome regions are handled"). Every one of them is in the official `--dsw-*`
registry (278 tokens, sourced from the shipped frontend CSS), so this stays on a
supported surface instead of guessing internal class names.

Three supporting details:

- `body`'s `background` must be overridden **inline**, because the shell sets it
  inline at boot; teardown restores the previous value verbatim.
- The layers are the first child of `<body>`, `position: fixed`, `z-index: 0`,
  `pointer-events: none`. The already-positioned shell frame (`z-index: auto`)
  paints after them, so the interface is never covered — while the layers still
  sit above the html/body backdrop, which is where the wallpaper needs to be.
- Turning the master switch off **hands both tokens straight back**: "disabled"
  really does mean the GUI as it shipped, not "stopped painting but still
  transparent".

### How the chrome regions are handled

Once the wallpaper shows through, the shell's own panels sit on top of a photo, so
Mural takes over each region's fill as well. Every anchor comes from the official
stylesheet:

| Region | Official token | Where the shell paints it |
| --- | --- | --- |
| Sidebar | `--dsw-specific-sidebar-fill` | `.BynINW_sidebarCol`, the sidebar component root |
| Composer | `--dsw-specific-input-major` | `.RlGAzG_card` (the input card) |
| Message bubble | `--dsw-specific-bubble` | `.cJsG2q_bubble` |
| Pop-up panels | `--dsw-specific-menu` | several panels plus `backdrop-filter: var(--dsw-menu-backdrop-filter)` |

The method is to **read each token's real value in the live palette and write the
same color back at a lower alpha**. Light and dark both stay correct with no
hard-coded colors and no reliance on internal class names. Two sliders drive all of
them: **Chrome opacity** (how much of each fill survives) and **Chrome frosted
blur** (0–40 px, the same `backdrop-filter` treatment the official sheet already
gives translucent surfaces).

Hover states are rebuilt too: `--dsw-alias-interactive-bg-hover*` and `bg-layer-2/3`
are **mixed from the surface's own base**. Without that, moving the pointer over a
translucent panel snaps it back to the stock opaque tone.

> Each token's original value is snapshotted once, before the first repaint.
> Re-reading it on every repaint would return this plugin's own translucent value,
> multiply the alpha down each time, and fade the chrome out — a bug this plugin
> shipped and now tests for.

### Runtime version declaration

`package.json` declares `dsh.engines.dsh: ">=0.1.1-rc.1 <0.3.0-0"`. The host half
reads the real DSH version and compares: **outside that range it repaints nothing**
and explains why in the panel, leaving the stock interface alone.

This is deliberate caution. The plugin repaints the shell's chrome, so if a DSH
upgrade moves those tokens the worst case is unreadable text or a covered control —
and this plugin has already made the window undraggable once through a change of
exactly that character. Refusing to paint beats guessing.

### Why uploads use a raw body instead of multipart

The browser POSTs the original bytes with the file name in an `x-mural-name` header and dimensions/duration in `x-mural-meta` (base64url JSON). Large videos stay streamable, the progress bar is honest, and the host half needs no multipart parser dependency.

### Where the video "first frame" comes from

Static mode needs no server-side transcode: the browser decodes one frame into a canvas and exports a WebP poster. If no decodable frame arrives within four seconds it falls back to playing the video instead of leaving an empty rectangle.

### HTTP surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/background-mural/overview` | settings + capabilities + library + listing in one call |
| `GET` `PATCH` | `/api/background-mural/config` | read / incremental write settings |
| `POST` | `/api/background-mural/upload` | upload (raw body) |
| `GET` `HEAD` | `/api/background-mural/media/<id>` | media, Range-aware (206) |
| `DELETE` | `/api/background-mural/item/<id>` | delete one entry |
| `POST` | `/api/background-mural/orphans` | rescan and drop dead index rows |

Every route is same-origin fenced: `Sec-Fetch-Site: cross-site` gets a 403, and so does an `Origin` that does not match `Host`.

---

## Tests and acceptance

```sh
cd dsh-background-mural
node --test test/
```

Covered: the MIME/extension allowlists and their conflict rejection, magic-byte sniffing, Range parsing (including suffix and unsatisfiable ranges), the same-origin fence, bounded body reading, settings normalization and key allowlisting, library add/list/delete, rejection of oversized and type-mismatched uploads, self-healing after index corruption, dropping rows whose file vanished, and the path-escape fence.

Manual checklist:

- [ ] "Mural" appears in Settings, no console errors
- [ ] Upload a PNG → it fills the interface, chrome text stays readable
- [ ] Upload an MP4 → loops immediately; seeking works (proves Range)
- [ ] Switch to "First frame only" → a still image, with no transcode
- [ ] Turn the master switch off → media disappears and no `/media/` request is made
- [ ] Reload the page → the background is back with no flash of the stock shell
- [ ] Delete the active item → the background clears instead of going black
- [ ] Desktop app and browser behave the same

---

## Security notes and limits

- Upload types go through a **double allowlist**: the declared MIME and the file extension must both match, they must agree on image-vs-video, and the leading bytes must confirm it. Anything ambiguous is refused, never guessed.
- Per-file ceiling defaults to 512 MiB and library capacity to 8 GiB; both are configurable. `content-length` and counted bytes are both enforced.
- The file name is display-only: directories and control characters are stripped, and the on-disk name is a server-generated UUID.
- Media reads pass a path-escape fence — the resolved absolute path must stay inside `media/` or the request 404s.
- This is a local single-user tool, so uploads have no origin review: anyone who can reach your DSH port can already drive your session. The cross-site browser vector is what the origin fence closes.

## Known limitations

- No animated background formats beyond GIF, which the browser plays natively.
- No server-side transcoding: codecs the browser cannot decode (some HEVC/ProRes) cannot be video backgrounds. The diagnostics panel reports what is supported.
- Very large videos stream to disk, but the library capacity cap is still a hard limit.
- If a skin plugin also paints a background, whichever layer mounts later wins; Mural owns only its own layer and does not take over skin palettes.

## Roadmap

- [ ] Fetch media from a URL (with dimension/duration probing)
- [ ] Per-item appearance memory (switching items keeps the values you tuned)
- [ ] Multi-display and per-session backgrounds
- [ ] Poster-frame cache so switching back does not re-decode

## License

MIT. Your uploads are yours: the plugin never sends a file off the machine.
