import { X509Certificate, createPrivateKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";

const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_YEARS = 10;
/** Renova quando faltam menos de 30 dias, para o pino mudar antes de o certificado quebrar. */
const RENEW_BEFORE_MS = 30 * DAY_MS;

/** Primeiro byte em 0x01..0x7f: positivo e sem zero à esquerda, que o DER proíbe (parsers estritos, como o do Electron, recusam). */
export function serialHex(bytes: Uint8Array): string {
  const serial = Buffer.from(bytes);
  serial[0] = (serial[0]! & 0x7f) | 0x01;
  return serial.toString("hex");
}

function generate(now: Date): { cert: string; key: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }).toString());
  cert.serialNumber = serialHex(randomBytes(16));
  cert.validity.notBefore = new Date(now.getTime() - DAY_MS);
  const notAfter = new Date(now);
  notAfter.setFullYear(notAfter.getFullYear() + VALID_YEARS);
  cert.validity.notAfter = notAfter;
  const name = [{ name: "commonName", value: "WorkForces" }];
  cert.setSubject(name);
  cert.setIssuer(name);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, keyCertSign: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: "workforces" }] },
  ]);
  cert.sign(forge.pki.privateKeyFromPem(keyPem), forge.md.sha256.create());
  return { cert: forge.pki.certificateToPem(cert), key: keyPem };
}

function stillGood(certPath: string, keyPath: string, now: Date): { cert: string; key: string } | null {
  if (!existsSync(certPath) || !existsSync(keyPath)) return null;
  try {
    const cert = readFileSync(certPath, "utf8");
    const key = readFileSync(keyPath, "utf8");
    const x509 = new X509Certificate(cert);
    if (new Date(x509.validTo).getTime() - now.getTime() < RENEW_BEFORE_MS) return null;
    if (!x509.checkPrivateKey(createPrivateKey(key))) return null;
    return { cert, key };
  } catch {
    return null;
  }
}

function writeAtomic(path: string, content: string, mode?: number): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, path);
}

/** Certificado e chave próprios do servidor em `dir`: reaproveita enquanto valem, gera de novo se faltam, não leem ou vencem em breve. */
export function loadOrCreateCertificate(dir: string, now: Date = new Date()): { cert: string; key: string; created: boolean } {
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  const existing = stillGood(certPath, keyPath, now);
  if (existing) return { ...existing, created: false };
  mkdirSync(dir, { recursive: true });
  const fresh = generate(now);
  // Primeiro a chave: um certificado novo nunca fica ao lado de uma chave velha.
  writeAtomic(keyPath, fresh.key, 0o600);
  writeAtomic(certPath, fresh.cert);
  return { ...fresh, created: true };
}
