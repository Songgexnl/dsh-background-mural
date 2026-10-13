/**
 * Static checks on the browser bundle.
 *
 * The client half only runs inside the DSH GUI, so it cannot be imported here.
 * What can be checked without a browser is that it still parses, that it keeps
 * the module-loader contract DSH looks for, and that the route paths it calls
 * exist in the host half — the three ways this file can silently rot.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { API_PREFIX } from "../lib/routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, "..", "lib", "client.js"), "utf8");
const hostSource = readFileSync(join(here, "..", "lib", "index.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

test("the client bundle parses as a script", () => {
  // Compiling the body without running it catches a syntax error that would
  // otherwise only show up as a silently missing panel in the GUI.
  assert.doesNotThrow(() => {
    new Function(clientSource);
  });
});

test("the client bundle keeps the module-loader contract", () => {
  assert.match(clientSource, /window\.__ModuleLoader__\.load\(/);
  assert.match(clientSource, /id:\s*"dsh-background-mural"/);
  assert.match(clientSource, /exports\.apply\s*=/);
  assert.match(clientSource, /exports\.inject\s*=/);
  // The id must match what cordis.patch.yml mounts.
  const patch = readFileSync(join(here, "..", "cordis.patch.yml"), "utf8");
  assert.match(patch, /name:\s*dsh-background-mural/);
  assert.equal(manifest.main, "lib/index.js");
  assert.equal(manifest.dsh.client.platform, "web");
});

test("every route the client calls exists in the host half", () => {
  const called = [...clientSource.matchAll(/`?\$\{API\}(\/[a-z-]*)/g)].map((match) => match[1]);
  const unique = [...new Set(called)];
  assert.ok(unique.length >= 3, `expected the client to call several routes, saw ${JSON.stringify(unique)}`);
  const declared = [...readFileSync(join(here, "..", "lib", "routes.js"), "utf8").matchAll(/path: `\$\{API_PREFIX\}(\/[a-z-]*)/g)].map(
    (match) => match[1]
  );
  for (const route of unique) {
    assert.ok(declared.includes(route), `client calls ${route} but the host declares ${JSON.stringify(declared)}`);
  }
  assert.equal(API_PREFIX, "/api/background-mural");
});

test("the host half exports the cordis plugin surface", () => {
  assert.match(hostSource, /export const name\s*=/);
  assert.match(hostSource, /export const inject\s*=\s*\["webServer"\]/);
  assert.match(hostSource, /export function apply\(ctx\)/);
  // The transparent body background is declared by the browser half — the host
  // half injects no CSS at all, so this assertion only ever failed here.
  assert.match(clientSource, /body\[\$\{BODY_ATTR\}\]\{background:transparent !important\}/);
});

test("INSTALLED_VERSION tracks the package version", () => {
  // The panel shows this and the update check compares against it. Forgetting to
  // bump it makes a genuinely newer release report as "up to date", which is the
  // exact failure this plugin already shipped once.
  const declared = /const INSTALLED_VERSION = "([^"]+)"/.exec(clientSource);
  assert.notEqual(declared, null, "client.js must declare INSTALLED_VERSION");
  assert.equal(declared[1], manifest.version, "INSTALLED_VERSION must equal package.json version");
});

test("the update check reads the public manifest and never fakes an install", () => {
  assert.match(clientSource, /raw\.githubusercontent\.com\/Songgexnl\/dsh-background-mural\/main\/package\.json/);
  // It must hand the user the command rather than claim to reinstall by itself.
  assert.match(clientSource, /dsh plugin --profile desktop add github:Songgexnl\/dsh-background-mural/);
});

test("the sound switch reaches an already-mounted video", () => {
  // The element is rebuilt only when the item changes, so the switch has to be
  // re-applied on every sync — reading it once at build time is exactly what made
  // "set as background, then turn the sound on" do nothing.
  assert.match(
    clientSource,
    /if \(element\.muted !== shouldBeMuted && this\.autoplayBlocked !== true\) this\.startMedia\(\);/
  );
  // An unmuted autoplay is allowed to reject, and a rejected play paints nothing,
  // so the muted retry and the gesture hand-off both have to be there.
  assert.match(clientSource, /this\.autoplayBlocked = true;/);
  assert.match(clientSource, /this\.unmuteOnGesture\(\);/);
  assert.match(clientSource, /addEventListener\("pointerdown", resume/);
  // And every start goes through the one function that knows about the policy.
  assert.doesNotMatch(clientSource, /video\.autoplay = true/);
});

test("reset appearance restores the shipped defaults, and only those", () => {
  const block = clientSource.match(/const APPEARANCE_DEFAULTS = \{[\s\S]*?\n    \};/);
  assert.ok(block !== null, "APPEARANCE_DEFAULTS is missing");
  // The two fields behind the "the picture never loaded" report: a blurred
  // wallpaper and a fully opaque chrome both look like nothing rendered.
  assert.match(block[0], /blur: 0,/);
  assert.match(block[0], /opacity: 100,/);
  // A reset is about the look, so the library, the wallpaper and the sound
  // switch have to survive it.
  assert.doesNotMatch(block[0], /activeId/);
  assert.doesNotMatch(block[0], /sound: /);
  assert.doesNotMatch(block[0], /volume: /);
  // And the button has to actually call it.
  assert.match(clientSource, /onClick: resetAppearance/);
});

test("the report probes who is painted over the wallpaper", () => {
  // "The picture never shows up" needs an answer rather than a guess, so the
  // report has to name both the box sitting above the mural layer and the
  // element that handed the shell's own base fill back an opaque colour.
  assert.match(clientSource, /function paintProbe\(/);
  assert.match(clientSource, /elementFromPoint\(/);
  assert.match(clientSource, /base carriers:/);
  assert.match(clientSource, /paintProbe\(\s*typeof document/);
  // The shell may re-declare the base fill inline on #root, and only an
  // important stylesheet declaration beats an inline one.
  assert.match(clientSource, /--dsw-alias-bg-base:transparent !important/);
});

test("the centre column fill is taken transparent so the wallpaper shows through", () => {
  // The shell paints its main column from `--dsw-alias-bg-layer-1`; leaving it
  // opaque is the "picture never shows up" report. It must be overridden after
  // its own real value has been read, so the hover/raised blends stay correct.
  assert.match(clientSource, /--dsw-alias-bg-layer-1", "transparent", "important"/);
  // And handed back on teardown.
  assert.match(clientSource, /"--dsw-alias-bg-layer-1",\s*\n\s*"--dsw-alias-bg-layer-2"/);
});

test("the raised layers follow the chrome-opacity slider", () => {
  // Layer 2 is what the shell paints raised surfaces with — the very slab that
  // hid the wallpaper — so leaving it at full opacity made the chrome-opacity
  // slider a no-op on most of the page.
  assert.match(clientSource, /\["--dsw-alias-bg-layer-2", 0\.05, true\]/);
  assert.match(clientSource, /\["--dsw-alias-bg-layer-3", 0\.09, true\]/);
});

test("the paint probe measures by area, not by a single point", () => {
  // The panel is always open when the report is copied and it covers the middle
  // of the screen, so a single sample point only ever measures the panel.
  assert.match(clientSource, /slabs \(>=50% viewport, document order\)/);
});

test("the shell frame is cleared by measurement, not only through its tokens", () => {
  // The frame resolves a fill no token override reaches, so a plain rule covers
  // the direct-child case from the first paint, and a measured pass clears the
  // box itself wherever it sits.
  assert.match(clientSource, /#root>\*\{background-color:transparent !important\}/);
  assert.match(clientSource, /clearShellBackdrop\(\) \{/);
  // Three gates: opaque fills only, most-of-the-viewport only, non-fixed only.
  assert.match(clientSource, /style\.position === "fixed"/);
  assert.match(clientSource, /rect\.width \* rect\.height < area \* 0\.7/);
  assert.match(clientSource, /background-color", "transparent", "important"/);
  // The cleared fills are remembered, and handed back on teardown.
  assert.match(clientSource, /this\.cleared\.set\(candidate/);
  assert.match(clientSource, /this\.cleared\.clear\(\)/);
});

test("the shell frame fill is overridden on every box via a wildcard important rule", () => {
  // The frame element re-declares --dsw-alias-bg-layer-1 for itself on a hashed
  // class name, so a rule scoped to #root cannot reach it; only a wildcard
  // important declaration beats a class-scoped one.
  assert.match(clientSource, /\*\{--dsw-alias-bg-layer-1:transparent !important\}/);
  // And the real layer-1 is snapshotted before that rule lands, so the hover and
  // raised blends stay correct.
  assert.match(clientSource, /this\.originalTokens\["--dsw-alias-bg-layer-1"\] = this\.token/);
});

test("the update notice reads the changelog and never renders remote markup", () => {
  assert.match(
    clientSource,
    /raw\.githubusercontent\.com\/Songgexnl\/dsh-background-mural\/main\/CHANGELOG\.md/
  );
  assert.match(clientSource, /function parseChangelog\(/);
  // The changelog arrives over the network, so it must only ever be written as
  // text. One `innerHTML` here would turn release notes into an injection vector.
  assert.doesNotMatch(clientSource, /innerHTML/);
  // It reports and hands over a command; it must never try to install by itself,
  // which would need shell access the client half does not have.
  assert.doesNotMatch(clientSource, /child_process|execSync\(/);
  // "Do not remind me again" is a stored preference, so a restart keeps it gone.
  assert.match(clientSource, /set\("skipUpdateVersion", info\.latest, true\)/);
});

test("the skin override only names declared skins and keeps the sliders in charge", () => {
  const table = /const SKIN_ADAPTERS = \[([\s\S]*?)\n    \];/.exec(clientSource);
  assert.notEqual(table, null, "client.js must declare SKIN_ADAPTERS");
  // Without the body marker the adapter is dead code: nothing to detect.
  assert.match(table[1], /marker:\s*"data-dsh-maid-atelier"/);
  // The sheet is scoped by this plugin's own marker as well as the skin's, so
  // switching the wallpaper off retracts it and the skin returns to stock.
  assert.match(clientSource, /const scope = `body\[\$\{BODY_ATTR\}\]\[\$\{adapter\.marker\}\]`/);
  // What steps aside is the fill, handed to the value the plugin already computes
  // for the sidebar. A hard-coded skin color would silently ignore the chrome
  // sliders and break the light/dark split.
  assert.match(clientSource, /background:var\(--dsw-specific-sidebar-fill\) !important/);
  assert.doesNotMatch(clientSource, /background:#0a173b/);
});

test("no blanket -webkit-app-region:no-drag on the shell root", () => {
  // Setting no-drag on body inherits into the shell's titlebar drag region and
  // makes the whole window undraggable. It must never come back.
  assert.doesNotMatch(clientSource, /--dsw-alias-bg-base:transparent;-webkit-app-region/);
});

test("compareVersions compares per segment, not as a string", () => {
  // A string compare would rank "0.1.10" below "0.1.9"; the segment loop is what
  // prevents that, so its presence is the assertion.
  assert.match(clientSource, /for \(let index = 0; index < Math\.max\(left\.length, right\.length\); index \+= 1\)/);
  assert.match(clientSource, /if \(left\.some\(\(part\) => !Number\.isFinite\(part\)\)/);
});

test("the repainted surfaces are the shell's own tokens", () => {
  // Every region the plugin recolors must be a token the official sheet actually
  // paints; an invented token silently does nothing and the region stays opaque
  // (or transparent), which is how this plugin already shipped one broken build.
  const table = /const SURFACE_TOKENS = \[([\s\S]*?)\];/.exec(clientSource);
  assert.notEqual(table, null, "client.js must declare SURFACE_TOKENS");
  const tokens = [...table[1].matchAll(/"(--dsw-[a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tokens.sort(), [
    "--dsw-specific-bubble",
    "--dsw-specific-bubble-highlight",
    "--dsw-specific-input-major",
    "--dsw-specific-menu",
    "--dsw-specific-sidebar-fill"
  ]);
  // The hover variants are derived, never copied from a hard-coded color.
  assert.match(clientSource, /mixColor\(base, solidTarget, amount\)/);
  assert.match(clientSource, /mixColor\(panel, solidTarget, 0\.25\)/);
});

test("the layers mount before the async runtime verdict", () => {
  // The wallpaper must not depend on an awaited round trip: a misplaced await
  // here once left the layer unmounted behind a healthy-looking settings panel.
  // The verdict may only *take the layer back down*, via halt().
  const start = clientSource.indexOf("renderer.start();");
  const guard = clientSource.indexOf("body.runtime.supported === false");
  assert.notEqual(start, -1, "apply() must start the renderer");
  assert.notEqual(guard, -1, "the runtime verdict must still be checked");
  assert.ok(guard > start, "renderer.start() must come before the runtime verdict");
  assert.match(clientSource, /renderer\.halt\(\)/);
});

test("the panel can report the live layer state", () => {
  // A "nothing shows up" report has to be diagnosable from the page itself.
  assert.match(clientSource, /publishStatus\(\)/);
  assert.match(clientSource, /layerMounted/);
  assert.match(clientSource, /surfacesPainted/);
  assert.match(clientSource, /--dsw-alias-bg-base/);
});
