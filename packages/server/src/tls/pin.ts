import { createHash, X509Certificate } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

/** O pino do convite: SHA-256 do certificado (DER) em base64url, o mesmo que o app confere. */
export function pinOfCertificate(pem: string): string {
  return createHash("sha256").update(new X509Certificate(pem).raw).digest("base64url");
}

export interface PinSource {
  /** O pino e o certificado (PEM) de que o app precisa; `null` enquanto o certificado não existe ou não lê. */
  current(): { pin: string; anchor: string } | null;
}

/** Certificado que o próprio servidor gerou: não muda enquanto o processo vive. */
export function fixedPin(certPem: string): PinSource {
  const value = { pin: pinOfCertificate(certPem), anchor: new X509Certificate(certPem).toString() };
  return { current: () => value };
}

const FIRST_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/;

/** Certificado de uma CA da rede interna, num arquivo que pode aparecer ou ser trocado com o servidor no ar. */
export function filePin(path: string): PinSource {
  let seen: { mtimeMs: number; size: number } | null = null;
  let value: { pin: string; anchor: string } | null = null;
  return {
    current() {
      let stat;
      try {
        stat = statSync(path);
      } catch {
        seen = null;
        value = null;
        return null;
      }
      if (seen && seen.mtimeMs === stat.mtimeMs && seen.size === stat.size) return value;
      try {
        // Do arquivo vale só o primeiro certificado (a cadeia pode vir inteira).
        const block = FIRST_CERTIFICATE.exec(readFileSync(path, "utf8"))?.[0];
        value = block ? { pin: pinOfCertificate(block), anchor: new X509Certificate(block).toString() } : null;
      } catch {
        value = null;
      }
      seen = { mtimeMs: stat.mtimeMs, size: stat.size };
      return value;
    },
  };
}
