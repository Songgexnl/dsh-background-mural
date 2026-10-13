/**
 * Shared HTTP helpers for the Mural host half.
 *
 * Deliberately dependency-free: the host half must run inside the DSH process,
 * where no npm dependency of this package is guaranteed to be installed.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { pipeline } from "node:stream";

/** Write one JSON response. */
export function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * Same-origin fence. Browsers send `Sec-Fetch-Site` on every request: a
 * cross-site request is always rejected, and an `Origin` that does not match
 * the request `Host` is rejected. Requests without either header (curl, node
 * http, old browsers) pass — this is a local single-user tool, and the fence
 * only targets the cross-site browser vector.
 */
export function isSameOriginRequest(req) {
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string" && site === "cross-site") return false;
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin !== "" && origin !== "null") {
    const host = req.headers.host;
    if (typeof host !== "string" || host === "") return false;
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Reject cross-site requests with 403. */
export function requireSameOrigin(req, res) {
  if (isSameOriginRequest(req)) return true;
  json(res, 403, { ok: false, error: "cross-site-request-rejected" });
  return false;
}

/** Read a JSON request body (bounded, so a hostile body cannot exhaust memory). */
export function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body-too-large"));
        queueMicrotask(() => req.destroy());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid-json"));
      }
    });
    req.on("error", reject);
  });
}

/** Parse a single `Range: bytes=a-b` header against a known size. */
export function parseRangeHeader(header, size) {
  if (typeof header !== "string" || header === "") return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return { unsatisfiable: true };
  const rawStart = match[1];
  const rawEnd = match[2];
  if (rawStart === "" && rawEnd === "") return { unsatisfiable: true };
  let start;
  let end;
  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const suffix = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return { unsatisfiable: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(rawStart, 10);
    end = rawEnd === "" ? size - 1 : Number.parseInt(rawEnd, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { unsatisfiable: true };
  if (Number.isNaN(start) || Number.isNaN(end)) return { unsatisfiable: true };
  if (end >= size) end = size - 1;
  if (start > end || start < 0) return { unsatisfiable: true };
  return { start, end };
}

/**
 * Stream one file with Range support. Video playback and seeking need 206
 * responses, so this is not optional for the video half of the plugin.
 */
export function serveFile(absPath, req, res, contentType) {
  if (!existsSync(absPath) || !statSync(absPath).isFile()) {
    json(res, 404, { ok: false, error: "not-found" });
    return;
  }
  const size = statSync(absPath).size;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  const range = parseRangeHeader(req.headers.range, size);
  if (range !== null && range.unsatisfiable === true) {
    res.statusCode = 416;
    res.setHeader("Content-Range", `bytes */${String(size)}`);
    res.end();
    return;
  }
  if (range !== null) {
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    pipeFile(absPath, res, { start: range.start, end: range.end });
    return;
  }
  res.setHeader("Content-Length", String(size));
  pipeFile(absPath, res);
}

/** Pipe a file into a response, tearing the stream down when the client leaves. */
function pipeFile(absPath, res, options) {
  const source = options === undefined ? createReadStream(absPath) : createReadStream(absPath, options);
  const closeSource = () => source.destroy();
  res.on("close", closeSource);
  try {
    pipeline(source, res, () => {
      res.off("close", closeSource);
    });
  } catch {
    res.off("close", closeSource);
    source.destroy();
  }
}
