import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { chromium } from "playwright";

const importMap = '{"imports":{"waarmerk":"/waarmerk/index.js","xprsn":"/xprsn/index.js"}}';
const hash = createHash("sha256").update(importMap).digest("base64");
const csp = [
  "default-src 'none'",
  `script-src 'self' 'sha256-${hash}'`,
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>sjabloon CSP test</title>
<body>
	<output id="result" data-status="running">running</output>
	<div id="rendered"></div>
	<script type="importmap">${importMap}</script>
	<script type="module" src="/browser.js"></script>
</body>
</html>`;
const files = new Map([
  ["/", ["text/html; charset=utf-8", html]],
  [
    "/browser.js",
    ["text/javascript; charset=utf-8", await readFile(new URL("./browser.js", import.meta.url))],
  ],
  // Two entries plus the shared core they both import, served from `lib/`
  // exactly as published — the relative `./core.js` specifier resolves against
  // these paths, so no rewriting is needed.
  [
    "/lib/index.js",
    [
      "text/javascript; charset=utf-8",
      await readFile(new URL("../../lib/index.js", import.meta.url)),
    ],
  ],
  [
    "/lib/html.js",
    [
      "text/javascript; charset=utf-8",
      await readFile(new URL("../../lib/html.js", import.meta.url)),
    ],
  ],
  [
    "/lib/core.js",
    [
      "text/javascript; charset=utf-8",
      await readFile(new URL("../../lib/core.js", import.meta.url)),
    ],
  ],
  // Resolved through the exports map rather than a hardcoded path, so this
  // keeps working whichever directory xprsn publishes its entry from. The
  // served URL stays fixed, so the import map — and the CSP hash over it —
  // are unaffected.
  [
    "/xprsn/index.js",
    ["text/javascript; charset=utf-8", await readFile(new URL(import.meta.resolve("xprsn")))],
  ],
  // xprsn imports waarmerk by bare specifier too, and the map covers both.
  [
    "/waarmerk/index.js",
    ["text/javascript; charset=utf-8", await readFile(new URL(import.meta.resolve("waarmerk")))],
  ],
]);

const server = http.createServer((request, response) => {
  const file = files.get(new URL(request.url, "http://localhost").pathname);
  if (!file) {
    response.writeHead(404).end("Not found");
    return;
  }
  response
    .writeHead(200, {
      "Content-Type": file[0],
      "Content-Security-Policy": csp,
      "X-Content-Type-Options": "nosniff",
    })
    .end(file[1]);
});

let browser;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  browser = await chromium.launch();
  const page = await browser.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto(`http://127.0.0.1:${port}`);
  const done = page.locator('#result[data-status="passed"], #result[data-status="failed"]');
  await done.waitFor({ timeout: 10_000 });
  const status = await done.getAttribute("data-status");
  const message = await done.textContent();

  assert.equal(status, "passed", message);
  assert.deepEqual(browserErrors, []);
  console.log("Browser CSP test passed");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
