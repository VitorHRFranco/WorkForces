import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { parseOfficeAddress } from "../links.js";

/** Onde as sessões ficam cifradas (no Electron, o `safeStorage`; no Windows, o DPAPI). */
export interface SecretBox {
  /** false: o sistema não tem onde guardar segredos; as sessões ficam só na memória. */
  available(): boolean;
  /** Cifra e devolve em base64. */
  seal(plain: string): string;
  /** Decifra; lança se não conseguir. */
  open(sealed: string): string;
}

export interface StoredOffice {
  id: string;
  url: string;
  userName: string | null;
  session: string | null;
}

/** O `offices.json`: a `session` vai cifrada pelo `SecretBox`. */
const OfficesFile = z.object({
  version: z.literal(1),
  lastUsed: z.string().nullable(),
  offices: z.array(z.object({ id: z.string(), url: z.string().refine((u) => { const r = parseOfficeAddress(u); return "url" in r && r.url === u; }, "endereço de escritório inválido"), userName: z.string().nullable(), session: z.string().nullable() })),
});

/** Os escritórios do perfil local: quem o app já abriu e a sessão de cada um. */
export class OfficeStore {
  private offices: StoredOffice[];
  private last: string | null;
  /** O que foi gravado por último (com as sessões em claro), para não regravar sem mudança. */
  private written: string;

  private constructor(
    private readonly file: string,
    private readonly box: SecretBox,
    offices: StoredOffice[],
    last: string | null,
  ) {
    this.offices = offices;
    this.last = last;
    this.written = this.snapshot();
  }

  static load(file: string, box: SecretBox, log: (message: string) => void = () => {}): OfficeStore {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      // Só "não existe" é perfil novo. Outro erro (antivírus ou backup segurando o arquivo) não pode
      // virar um perfil vazio que a próxima gravação use para sobrescrever o arquivo de verdade.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return new OfficeStore(file, box, [], null);
      OfficeStore.keepBadCopy(file, `não consegui ler o offices.json (${err instanceof Error ? err.message : String(err)})`, log);
      return new OfficeStore(file, box, [], null);
    }
    try {
      const data = OfficesFile.parse(JSON.parse(raw));
      const offices = data.offices.map((entry) => ({ ...entry, session: OfficeStore.unseal(entry.session, box) }));
      const last = offices.some((entry) => entry.id === data.lastUsed) ? data.lastUsed : null;
      return new OfficeStore(file, box, offices, last);
    } catch (err) {
      OfficeStore.keepBadCopy(file, `offices.json ilegível (${err instanceof Error ? err.message : String(err)})`, log);
      return new OfficeStore(file, box, [], null);
    }
  }

  private static keepBadCopy(file: string, reason: string, log: (message: string) => void): void {
    try {
      copyFileSync(file, `${file}.bad`);
    } catch {
      // Sem a cópia, o arquivo estragado só é ignorado.
    }
    log(`${reason}; copiado para ${file}.bad e recomeçando vazio`);
  }

  /** Sessão que não decifra (outro usuário do sistema, cofre trocado): vira null, e a pessoa entra de novo. */
  private static unseal(session: string | null, box: SecretBox): string | null {
    if (session === null) return null;
    try {
      return box.open(session);
    } catch {
      return null;
    }
  }

  list(): StoredOffice[] {
    return this.offices.map((entry) => ({ ...entry }));
  }

  get(id: string): StoredOffice | null {
    const found = this.offices.find((entry) => entry.id === id);
    return found ? { ...found } : null;
  }

  lastUsed(): StoredOffice | null {
    return this.last === null ? null : this.get(this.last);
  }

  /** Mesmo endereço e mesmo nome atualizam a entrada; senão, cria outra. Vira o último usado. */
  saveLogin(url: string, userName: string, session: string): StoredOffice {
    let entry = this.offices.find((e) => e.url === url && e.userName === userName);
    if (entry) {
      entry.session = session;
    } else {
      entry = { id: randomUUID(), url, userName, session };
      this.offices.push(entry);
    }
    this.last = entry.id;
    this.persist();
    return { ...entry };
  }

  setSession(id: string, session: string | null): void {
    const entry = this.offices.find((e) => e.id === id);
    if (!entry) return;
    entry.session = session;
    this.persist();
  }

  markUsed(id: string): void {
    if (!this.offices.some((e) => e.id === id)) return;
    this.last = id;
    this.persist();
  }

  forget(id: string): void {
    this.offices = this.offices.filter((e) => e.id !== id);
    if (this.last === id) this.last = null;
    this.persist();
  }

  private snapshot(): string {
    return JSON.stringify({ lastUsed: this.last, offices: this.offices });
  }

  /** Grava `<arquivo>.tmp` e renomeia, para um corte no meio não deixar o arquivo pela metade. */
  private persist(): void {
    const snapshot = this.snapshot();
    if (snapshot === this.written) return;
    const canSeal = this.box.available();
    const data = {
      version: 1,
      lastUsed: this.last,
      // Sem cofre, a sessão não vai para o disco: fica só na memória.
      offices: this.offices.map((e) => ({ ...e, session: canSeal && e.session !== null ? this.box.seal(e.session) : null })),
    };
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    try {
      renameSync(tmp, this.file);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
    this.written = snapshot;
  }
}
