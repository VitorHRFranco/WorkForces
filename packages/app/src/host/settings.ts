import { readFileSync } from "node:fs";
import { z } from "zod";
import { HostSettingsInput } from "@workforces/protocol";
import { writeFileAtomic } from "../atomic-write.js";

export const DEFAULT_HOST_PORT = 4600;

/** As escolhas da pessoa mais o que o app aprendeu ao subir o escritório. */
export interface HostSettings extends HostSettingsInput {
  /** O pino do certificado do escritório hospedado. */
  pin: string | null;
  /** O endereço usado no último convite (para refazer o link se o endereço mudar). */
  lastInviteHost: string | null;
}

const HostFile = HostSettingsInput.extend({
  version: z.literal(1),
  pin: z.string().nullable(),
  lastInviteHost: z.string().nullable(),
});

/** O `host.json`: como este computador hospeda o escritório. */
export class HostSettingsStore {
  private constructor(
    private readonly file: string,
    private current: HostSettings | null,
  ) {}

  static load(file: string, log: (m: string) => void): HostSettingsStore {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") log(`não consegui ler o host.json (${err instanceof Error ? err.message : String(err)})`);
      return new HostSettingsStore(file, null);
    }
    try {
      const { version: _version, ...settings } = HostFile.parse(JSON.parse(raw));
      return new HostSettingsStore(file, settings);
    } catch (err) {
      // O arquivo fica como está: a pessoa pode corrigir à mão; o app só pede as escolhas de novo.
      log(`host.json ilegível, vou pedir as escolhas de novo (${err instanceof Error ? err.message : String(err)})`);
      return new HostSettingsStore(file, null);
    }
  }

  get(): HostSettings | null {
    return this.current ? { ...this.current } : null;
  }

  save(settings: HostSettings): void {
    writeFileAtomic(this.file, JSON.stringify({ version: 1, ...settings }, null, 2));
    this.current = { ...settings };
  }
}
