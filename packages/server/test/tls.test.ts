import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN_PATTERN } from "@workforces/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { loadOrCreateCertificate, serialHex } from "../src/tls/certificate.js";
import { filePin, pinOfCertificate } from "../src/tls/pin.js";
import { testConfig } from "./helpers/setup.js";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-tls-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

describe("loadOrCreateCertificate", () => {
  it("cria na primeira vez, reaproveita na segunda e renova perto de vencer", () => {
    const dir = tempDir();
    const first = loadOrCreateCertificate(dir);
    expect(first.created).toBe(true);
    statSync(join(dir, "cert.pem"));
    statSync(join(dir, "key.pem"));
    const second = loadOrCreateCertificate(dir);
    expect(second).toMatchObject({ cert: first.cert, created: false });
    const later = loadOrCreateCertificate(dir, new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000));
    expect(later.created).toBe(true);
    expect(pinOfCertificate(later.cert)).not.toBe(pinOfCertificate(first.cert));
  });

  it("gera uma CA de 10 anos que casa com a chave", () => {
    const { cert, key } = loadOrCreateCertificate(tempDir());
    const x509 = new X509Certificate(cert);
    expect(x509.ca).toBe(true);
    expect(new Date(x509.validTo).getTime() - Date.now()).toBeGreaterThan(9 * 365 * 24 * 3600 * 1000);
    expect(x509.checkPrivateKey(createPrivateKey(key))).toBe(true);
  });

  it("o número de série nunca começa com 0x00 nem 0x80 (DER mínimo e positivo)", () => {
    for (const first of [0x00, 0x80, 0x01, 0x7f, 0xff]) {
      const byte = Number.parseInt(serialHex(Buffer.from([first, 0x10, 0x20, 0x30])).slice(0, 2), 16);
      expect(byte).toBeGreaterThanOrEqual(0x01);
      expect(byte).toBeLessThanOrEqual(0x7f);
    }
  });

  it.skipIf(process.platform === "win32")("a chave fica só para o dono", () => {
    const dir = tempDir();
    loadOrCreateCertificate(dir);
    expect(statSync(join(dir, "key.pem")).mode & 0o777).toBe(0o600);
  });
});

describe("pino", () => {
  it("é o SHA-256 do certificado em base64url", () => {
    const { cert } = loadOrCreateCertificate(tempDir());
    const pin = pinOfCertificate(cert);
    expect(pin).toBe(createHash("sha256").update(new X509Certificate(cert).raw).digest("base64url"));
    expect(pin).toMatch(PIN_PATTERN);
  });

  it("filePin acompanha o arquivo", () => {
    const dir = tempDir();
    const file = join(dir, "root.crt");
    const source = filePin(file);
    expect(source.current()).toBeNull();
    const a = loadOrCreateCertificate(join(dir, "a")).cert;
    writeFileSync(file, a);
    const first = source.current();
    expect(first?.pin).toBe(pinOfCertificate(a));
    expect(new X509Certificate(first!.anchor).raw).toEqual(new X509Certificate(a).raw);
    const b = loadOrCreateCertificate(join(dir, "b")).cert;
    writeFileSync(file, `${b}\n${a}`);
    expect(source.current()?.pin).toBe(pinOfCertificate(b));
    writeFileSync(file, "lixo que não é certificado");
    expect(source.current()).toBeNull();
  });
});

describe("servidor com HTTPS próprio", () => {
  it("responde a quem confia no certificado e recusa quem não confia", async () => {
    const dataDir = tempDir();
    const server = createServer(testConfig({ tls: "self-signed", dataDir, publicUrl: new URL("https://127.0.0.1:4600") }), { dbFile: ":memory:", log: () => {} });
    await server.app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const port = (server.app.server.address() as AddressInfo).port;
      const { cert } = loadOrCreateCertificate(join(dataDir, "tls"));
      const request = (ca?: string) =>
        new Promise<number>((resolve, reject) => {
          get({ host: "127.0.0.1", port, path: "/api/health", ca, checkServerIdentity: () => undefined }, (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          }).on("error", reject);
        });
      expect(await request(cert)).toBe(200);
      await expect(request()).rejects.toThrow(/certificate|self.signed/i);
    } finally {
      await server.app.close();
    }
  });
});
