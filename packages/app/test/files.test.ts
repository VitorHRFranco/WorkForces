import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PAGE_CSP, servePageFile } from "../src/page/files.js";

let root: string;
let clientDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wf-files-"));
  clientDir = join(root, "client");
  mkdirSync(join(clientDir, "assets"), { recursive: true });
  mkdirSync(join(clientDir, "sprites"));
  writeFileSync(join(clientDir, "index.html"), "<html>INDEX</html>");
  writeFileSync(join(clientDir, "assets", "app.js"), "console.log(1)");
  writeFileSync(join(clientDir, "sprites", "robot.png"), "png");
  writeFileSync(join(root, "segredo.txt"), "SEGREDO");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("servePageFile", () => {
  it("serve os arquivos com o tipo certo e o HTML com CSP", async () => {
    expect((await servePageFile(clientDir, "/assets/app.js", "GET")).headers.get("content-type")).toContain("text/javascript");
    expect((await servePageFile(clientDir, "/sprites/robot.png", "GET")).headers.get("content-type")).toBe("image/png");
    const index = await servePageFile(clientDir, "/", "GET");
    expect(await index.text()).toBe("<html>INDEX</html>");
    expect(index.headers.get("content-security-policy")).toBe(PAGE_CSP);
  });

  it("rota da página recebe o index; arquivo que falta dá 404", async () => {
    for (const path of ["/office", "/invite/abc"]) {
      const res = await servePageFile(clientDir, path, "GET");
      expect(await res.text(), path).toBe("<html>INDEX</html>");
    }
    expect((await servePageFile(clientDir, "/assets/nada.js", "GET")).status).toBe(404);
  });

  it("nada sai da pasta do cliente", async () => {
    for (const path of ["/../segredo.txt", "/%2e%2e/segredo.txt", "/assets/%2e%2e/%2e%2e/segredo.txt", "/..%5csegredo.txt", "/assets%5c..%5c..%5csegredo.txt", "/%00", "/%E0%A4%A"]) {
      const res = await servePageFile(clientDir, path, "GET");
      expect(await res.text(), path).not.toContain("SEGREDO");
    }
  });

  it("só leitura", async () => {
    expect((await servePageFile(clientDir, "/", "POST")).status).toBe(405);
  });
});
