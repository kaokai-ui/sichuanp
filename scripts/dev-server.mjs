import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || "4173");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

function safePathFromUrl(requestUrl) {
  let pathname;

  try {
    const parsedUrl = new URL(requestUrl, `http://127.0.0.1:${port}`);
    pathname = decodeURIComponent(parsedUrl.pathname);
  } catch {
    return null;
  }

  const normalizedPath =
    pathname === "/" ? "/index.html" : pathname.replace(/\/+$/, "");
  const fullPath = path.normalize(path.join(rootDir, normalizedPath));

  if (fullPath !== rootDir && !fullPath.startsWith(rootDir + path.sep)) {
    return null;
  }

  return fullPath;
}

const server = http.createServer(async (request, response) => {
  const targetPath = safePathFromUrl(request.url || "/");

  if (!targetPath) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const fileStat = await fs.stat(targetPath);
    const filePath = fileStat.isDirectory()
      ? path.join(targetPath, "index.html")
      : targetPath;
    const fileBuffer = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const contentType =
      MIME_TYPES[extension] || "application/octet-stream";

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": contentType,
    });
    response.end(fileBuffer);
  } catch (error) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Static server running at: http://localhost:${port}`);

  for (const address of localAddresses()) {
    console.log(`LAN access: http://${address}:${port}`);
  }
});
