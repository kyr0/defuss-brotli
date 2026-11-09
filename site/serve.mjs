// A static file server for docs/ with the MIME types GitHub Pages sends (application/wasm included), for the e2e
// test and for looking at the site locally: `node site/serve.mjs [port]`. VERIFIED: the slim init() of both modules
// loads its .wasm from it in Chromium 158 (site e2e). node:http over a dependency: a dozen lines serve a folder.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".br": "application/octet-stream",
};

/** Serves `dir` on 127.0.0.1; resolves to its base URL and a close function. */
export function serve(dir, port = 0) {
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(dir, path.endsWith("/") ? `${path}index.html` : path);
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await serve(join(import.meta.dirname, "..", "docs"), Number(process.argv[2] ?? 8080));
  console.log(`${new Date().toISOString()} INFO serving docs/ url=${url}`);
}
