import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, normalize, sep } from "node:path";

/**
 * Serve uma pasta de release (`latest.yml`, o instalador e o `.blockmap`) em http://127.0.0.1, como o provedor `generic`
 * do electron-updater espera. Só os arquivos de `dir`: nada com `..`, nada fora dela.
 */
export async function serveUpdateFeed(dir: string): Promise<{ url: string; close(): Promise<void> }> {
  const root = normalize(dir + sep);
  const server = createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? "/").split("?")[0]!.replace(/^\/+/, ""));
    const path = normalize(join(root, name));
    if (name === "" || name.includes("..") || !path.startsWith(root)) {
      response.writeHead(404).end();
      return;
    }
    let size: number;
    try {
      const stat = statSync(path);
      if (!stat.isFile()) throw new Error("não é arquivo");
      size = stat.size;
    } catch {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-length": size, "content-type": "application/octet-stream" });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(path).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
