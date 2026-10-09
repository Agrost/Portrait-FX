import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const tmRoot = resolve(root, "../tokenmagic");
const stubs = {
  "/tmfx/module/tokenmagic.js": 'export const isAnimationDisabled = () => false; export const fixPath = (path) => path?.replace(/^\\/?modules\\/tokenmagic\\//, "/tmfx/");',
  "/tmfx/module/proto/PlaceableObjectProto.js": '',
  "/tmfx/module/util.js": 'export const getPlaceableById = () => null;',
  "/tmfx/module/constants.js": 'export const PlaceableType = { TOKEN: "Token", TILE: "Tile", DRAWING: "Drawing", REGION: "Region" };',
  "/tmfx/fx/FilterOverrides.js": 'export const FilterOverrideManager = { applyOverrides() {} };',
};
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".webm": "video/webm" };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    if (Object.hasOwn(stubs, pathname)) { response.writeHead(200, { "Content-Type": types[".js"] }).end(stubs[pathname]); return; }
    const base = pathname.startsWith("/tmfx/") ? tmRoot : root;
    const file = resolve(base, pathname.startsWith("/tmfx/") ? pathname.slice(6) : `.${pathname}`);
    if (relative(base, file).startsWith("..")) { response.writeHead(403).end(); return; }
    const content = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
server.listen(5417, "127.0.0.1", () => { console.log("FX Portraits preview: http://127.0.0.1:5417/tests/preview.html"); });
