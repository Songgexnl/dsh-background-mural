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
  assert.match(hostSource, /background:transparent/);
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

test("an unsupported runtime stops the renderer before it paints", () => {
  // The guard has to run before renderer.start(); otherwise the tokens are
  // already repainted by the time the verdict arrives.
  const guard = clientSource.indexOf("body.runtime.supported === false");
  assert.notEqual(guard, -1, "the runtime verdict must gate the renderer");
  const start = clientSource.indexOf("renderer.start();", guard);
  assert.ok(start > guard, "renderer.start() must come after the runtime check");
  assert.match(clientSource, /dshMuralUnsupported/);
});
