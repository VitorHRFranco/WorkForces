import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

/** A página só fala com a própria origem; o escritório só é alcançado pelo processo principal. */
export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const NOT_FOUND = 404;
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const FALLBACK_CONTENT_TYPE = "application/octet-stream";
const INDEX = "index.html";

const notFound = () => new Response("não encontrado", { status: NOT_FOUND, headers: { "content-type": CONTENT_TYPES[".txt"] } });

/** Caminho do pedido dentro de `clientDir`, ou null se tentar sair dela. */
function insideClientDir(clientDir: string, pathname: string): string | null {
  const segments: string[] = [];
  for (const raw of pathname.split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment.includes("\\") || segment.includes("\0") || segment === "..") return null;
    if (segment !== "" && segment !== ".") segments.push(segment);
  }
  const root = resolve(clientDir);
  const path = resolve(root, ...segments);
  const outside = relative(root, path);
  return outside.startsWith("..") || isAbsolute(outside) ? null : path;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Serve os arquivos empacotados do cliente. Nada fora de `clientDir`; rota sem arquivo e sem extensão cai no `index.html`. */
export async function servePageFile(clientDir: string, pathname: string, method: string): Promise<Response> {
  if (method !== "GET" && method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const requested = insideClientDir(clientDir, pathname);
  if (requested === null) return notFound();

  let file = requested;
  if (!(await isFile(file))) {
    if (extname(requested) !== "") return notFound();
    file = resolve(clientDir, INDEX);
    if (!(await isFile(file))) return notFound();
  }

  const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? FALLBACK_CONTENT_TYPE;
  const headers = new Headers({ "content-type": type });
  if (type === CONTENT_TYPES[".html"]) headers.set("content-security-policy", PAGE_CSP);
  return new Response(method === "HEAD" ? null : await readFile(file), { headers });
}
