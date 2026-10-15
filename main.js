const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { getTimetable } = require("./timetable");

const PORT = process.env.PORT || 3000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATA_DIR = path.join(__dirname, "data"); // gitignored, holds the stored cookie
const PUBLIC_DIR = path.join(__dirname, "public"); // the only directory served to browsers
const STORE_PATH = path.join(DATA_DIR, "store.b64");
const MAX_BODY = 16 * 1024;

// CORS: only this app's own origins by default. Add more with
// CORS_ORIGINS="https://example.com,https://other.example" (never "*": the API
// serves a private timetable and holds a login cookie).
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  ...(process.env.CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean),
]);

// Sets CORS headers for allowed origins. Returns false if the request was a
// preflight that has been fully answered.
function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  const allowed = origin && ALLOWED_ORIGINS.has(origin);
  if (allowed) res.setHeader("Access-Control-Allow-Origin", origin);

  if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
    if (allowed) {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
      res.writeHead(204).end();
    } else {
      sendJson(res, 403, { error: "origin not allowed" });
    }
    return false;
  }
  return true;
}

function openBrowser(target) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", target]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [target]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => console.log(`Couldn't open a browser, visit ${target}`));
  child.unref();
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// Read the request body as UTF-8 text; rejects with err.status = 413 if over MAX_BODY.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.resume(); // drain the rest so the 413 response can be delivered
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Decode the value saved by POST /store; null if nothing has been stored yet.
async function readStoredCookie() {
  try {
    const encoded = await fs.readFile(STORE_PATH, "utf8");
    return Buffer.from(encoded, "base64").toString("utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

// GET /timetable?start=2026-10-01&end=2026-11-30&mode=merged
// GET /timetable?start=2026-10-01&end=2026-11-30&mode=split   (JSON: one .ics per module)
async function handleTimetable(url, res) {
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const mode = url.searchParams.get("mode") ?? "merged";

  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return sendJson(res, 400, { error: "start and end must be YYYY-MM-DD" });
  }
  if (start > end) {
    return sendJson(res, 400, { error: "start must be on or before end" });
  }
  if (!["merged", "split"].includes(mode)) {
    return sendJson(res, 400, { error: 'mode must be "merged" or "split"' });
  }

  try {
    const result = await getTimetable(start, end, mode, await readStoredCookie());

    if (mode === "split") return sendJson(res, 200, result);

    res.writeHead(200, {
      "Content-Type": "text/calendar",
      "Content-Disposition": 'attachment; filename="timetable.ics"',
    });
    res.end(result);
  } catch (err) {
    console.error(err);
    const status = err.status ?? 500;
    sendJson(res, status, {
      error: status === 401 ? "Authentication failed, check your saved cookie" : "Failed to fetch timetable",
      detail: err.message,
    });
  }
}

// POST /store  (Content-Type: text/plain, body = value to store)
// Saves the body base64-encoded to STORE_PATH so it survives restarts.
async function handleStore(req, res) {
  let value;
  try {
    value = await readBody(req);
  } catch (err) {
    if (err.status === 413) return sendJson(res, 413, { error: "body too large" });
    console.error(err);
    return sendJson(res, 400, { error: "failed to read body" });
  }
  if (!value) return sendJson(res, 400, { error: "body must be non-empty text" });

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_PATH, Buffer.from(value, "utf8").toString("base64"), {
      mode: 0o600,
    });
    res.writeHead(204).end();
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: "Failed to store value" });
  }
}

// GET /store -> { stored: boolean }  (reports whether a value exists; never returns it)
async function handleStoreStatus(res) {
  try {
    const stat = await fs.stat(STORE_PATH);
    sendJson(res, 200, { stored: stat.size > 0 });
  } catch (err) {
    if (err.code === "ENOENT") return sendJson(res, 200, { stored: false });
    console.error(err);
    sendJson(res, 500, { error: "Failed to read store" });
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

// Serve a file from PUBLIC_DIR (GET/HEAD only); anything outside it is a 404.
async function handleStatic(url, req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(res, 400, { error: "bad path" });
  }
  if (pathname === "/") pathname = "/index.html";

  const file = path.join(PUBLIC_DIR, pathname);
  const type = MIME_TYPES[path.extname(file).toLowerCase()];
  if (pathname.includes("\0") || !file.startsWith(PUBLIC_DIR + path.sep) || !type) {
    return sendJson(res, 404, { error: "not found" });
  }

  try {
    const content = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": type });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR") {
      return sendJson(res, 404, { error: "not found" });
    }
    console.error(err);
    sendJson(res, 500, { error: "Failed to read file" });
  }
}

const server = http.createServer((req, res) => {
  if (!applyCors(req, res)) return;

  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4);

  if (url.pathname === "/timetable") {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return sendJson(res, 405, { error: "method not allowed" });
    }
    return handleTimetable(url, res);
  }

  if (url.pathname === "/store") {
    if (req.method === "GET") return handleStoreStatus(res);
    if (req.method === "POST") return handleStore(req, res);
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "method not allowed" });
  }

  if (req.method === "GET" || req.method === "HEAD") return handleStatic(url, req, res);

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  const address = `http://localhost:${PORT}`;
  console.log(`Listening on ${address}`);
  if (process.argv.includes("--open")) openBrowser(address);
});
