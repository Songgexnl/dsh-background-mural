# Mural · a DSH background plugin

English | [中文](README.zh.md)

Put your own background behind the whole DSH interface: **upload an image or a video** and Mural paints it behind the GUI. The desktop app and the web GUI run the same code — there is nothing separate to configure.

- **Images and videos.** JPG / PNG / GIF / WebP / AVIF / BMP / SVG, plus MP4 / WebM / OGV / MOV.
- **Upload, not "paste a path".** Media lives in DSH's own directory. No Wallpaper Engine, no dropping files into a magic folder first.
- **Video that actually plays.** The host half implements HTTP Range (206) streaming, so clips loop, seek, and never need to be downloaded whole.
- **Desktop + web, one code path.** Both halves speak plain same-origin HTTP and touch no Node APIs, so there is no Electron-only branch.
- **Off means off.** The master switch stops painting and stops every media request; unloading the plugin restores the shell's DOM exactly.
- **Coexists with skin plugins.** A small "skin steps aside" table lets a skin that hard-codes its own full-screen fills (such as Maid Atelier) keep its borders, ornaments and character art while the wallpaper takes the backdrop seat.
- **Tells you when a newer build exists.** One quiet repository read after mounting, then a bottom-right card: how many versions behind, per-version notes, and a one-click note to hand the upgrade to the DSH agent.

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
| Background blur | 0–60 px, applied to the **media only**, never to the interface. Default 0; a high value smears the whole picture into flat colour, which is easy to mistake for "the image never loaded". For frosted chrome use "Chrome frosted blur" below |
| Opacity | 0–100, media transparency |
| Edge vignette | Soft darkening at the top and bottom edges |
| Chrome opacity | How much of each region's own fill survives (sidebar, composer, bubbles, panels), 0 = fully transparent |
| Chrome frosted blur | Frosts those regions, 0–40 px; more blur means clearer text |
| Extra dim in light theme | Adds an extra scrim only while the light theme is active, 0–40 |
| Reset appearance | Puts every appearance slider back to its factory value at once, leaving the library, the current wallpaper and the sound switch alone |
| Playback | Loop / Play once (parks on the last frame) / First frame only |
| Sound on | Muted by default. Playback always starts muted; if the browser blocks an unmuted start, the first click restores the sound in place. The switch, the volume and the playback mode all apply live |
| Volume | 0–100 |
| Pause while hidden | Pauses video when the window is backgrounded |
| Check for new versions | On by default. One quiet repository read after mounting (cached for 6 hours); a newer build shows a bottom-right card. Off also stops the panel's automatic check — the manual button still works |

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

### Coexisting with skin plugins

The token repaint above **does nothing against a skin**, because a skin does not
read tokens — it hard-codes the fill on the element. Maid Atelier
([dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale)) is the worked
example:

| Region | What the skin writes |
| --- | --- |
| Sidebar | `[class*='sidebarCol']{background:#0a173b}`, with a three-layer gradient inside (`rgba(16,36,86,.97)` upward) |
| Sidebar plate | `[class*='logoRow']`, equally opaque |
| Conversation column | `[data-skin-chrome='character-stage']`, filled with one opaque "palace" illustration |

Add that the skin mounts **later** than this plugin (later in the DOM means painted
on top) and the result is a perfectly healthy panel with **no wallpaper at all** —
indistinguishable from "the plugin does nothing".

Mural's answer is to let only the **fill** step aside: borders, shadows, ornaments
and character art all stay, and the fill becomes `var(--dsw-specific-sidebar-fill)` —
the very value this plugin already computes. So it is not "made transparent", it is
**handed to the same slider**, which keeps light and dark correct:

```css
body[data-dsh-mural][data-dsh-maid-atelier] [class*='sidebarCol']{background:var(--dsw-specific-sidebar-fill) !important}
```

The conversation column's illustration is dropped outright, handing that seat back to
the wallpaper. The table is data-driven (`SKIN_ADAPTERS` in `lib/client.js`); another
shell-painting skin is one more entry. Every rule is scoped by `data-dsh-mural` *and*
the skin's own marker, so **switching the wallpaper off, or halting because the DSH
version is unsupported, retracts the sheet and the skin returns to stock**. The
diagnostics row reports which skin was detected and whether it stepped aside.

### Runtime version declaration

`package.json` declares `dsh.engines.dsh: ">=0.1.1-rc.1 <0.3.0-0"`. The host half
reads the real DSH version and compares: **outside that range it repaints nothing**
and explains why in the panel, leaving the stock interface alone.

This is deliberate caution. The plugin repaints the shell's chrome, so if a DSH
upgrade moves those tokens the worst case is unreadable text or a covered control —
and this plugin has already made the window undraggable once through a change of
exactly that character. Refusing to paint beats guessing.

### New-version notice

A git-installed package is invisible to DSH's own plugin manager and `dsh plugin add`
never upgrades anything by itself. So 2.5 seconds after mounting, the client half reads
the repository once (`package.json` plus `CHANGELOG.md`, cached for six hours) and,
when a newer build exists, shows a card in the bottom-right corner:

- the version comparison and **how many versions behind** (counted from the changelog)
- expandable per-version notes
- **Copy for the agent**: repository, versions, reinstall command and the notes, ready
  to paste back into DSH. The plugin deliberately does not run the install itself —
  the client half has no shell access, and adding a Node watcher to get one is not
  worth it
- **Do not remind me again**, which skips only that version (`skipUpdateVersion`)
- **Open the release page**

The card is plain DOM and does not live in the settings slot: someone who never opened
Settings should still see it. Every string that arrives over the network is written with
`textContent` — release notes are remote content and must never be parsed as markup.
Turning **Check for new versions** off silences the card and the panel's automatic check.

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
- [ ] With Maid Atelier enabled → the wallpaper reaches the sidebar and the conversation column, and the skin's borders, ornaments and character art are still there
- [ ] A video background with "Sound on" → audio is audible; if the browser blocks the unmuted start, the first click restores it and the picture never stops
- [ ] With a newer build published → the bottom-right card appears; "Do not remind me again" keeps it gone after a restart
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
- Skin support is **declared per known skin** (Maid Atelier today). An unknown skin that hard-codes full-screen fills still hides the wallpaper; the diagnostics row names the detected skin, and adding its selectors to `SKIN_ADAPTERS` is the fix.
- What steps aside is the **fill**, not the palette: text colors a skin sets for the sidebar and top bar still come from the skin, so contrast in those regions is the skin's call.
- A video background with sound is bound by the browser's **autoplay policy**, which the plugin does not fight. Playback always starts muted — an unmuted `play()` the browser rejects paints nothing at all, which reads as a black screen — and a refused unmuted start is restored in place on your first click. A clip with no audio track never has any: uploads are stored as-is, nothing is transcoded and no audio is dropped.
- "First frame only" parks on a still, so nothing plays and there is no sound.

## Roadmap

- [ ] Fetch media from a URL (with dimension/duration probing)
- [ ] Per-item appearance memory (switching items keeps the values you tuned)
- [ ] Multi-display and per-session backgrounds
- [ ] Poster-frame cache so switching back does not re-decode

## License

MIT. Your uploads are yours: the plugin never sends a file off the machine.
