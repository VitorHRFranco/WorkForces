import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { ALIAS_PATTERN, MAX_ALIASES, type FolderChange, type FolderInfo } from "@workforces/protocol";
import { renameWithRetry } from "../offices/store.js";

export interface FolderEntry {
  alias: string;
  path: string;
}

/** O `agents.json`: as pastas liberadas para "Chamar agente" e os padrões extras de máscara (editados à mão). */
const AgentsFile = z.object({
  version: z.literal(1),
  folders: z.array(z.object({ alias: z.string().regex(ALIAS_PATTERN), path: z.string() })),
  secretPatterns: z.array(z.string()).default([]),
});

/** Caminho comparável: absoluto e, no Windows, sem diferenciar maiúsculas. */
function folderKey(path: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** As pastas que o app pode abrir para um agente. Valem para o computador inteiro, não por escritório. */
export class FolderStore {
  private constructor(
    private readonly file: string,
    private folders: FolderEntry[],
    private readonly patterns: string[],
  ) {}

  static load(file: string, log: (message: string) => void = () => {}): FolderStore {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") log(`não consegui ler o agents.json (${err instanceof Error ? err.message : String(err)}); recomeçando vazio`);
      return new FolderStore(file, [], []);
    }
    try {
      const data = AgentsFile.parse(JSON.parse(raw));
      return new FolderStore(file, data.folders, data.secretPatterns);
    } catch (err) {
      const reason = `agents.json ilegível (${err instanceof Error ? err.message : String(err)})`;
      const copy = `${file}.bad`;
      try {
        copyFileSync(file, copy);
        log(`${reason}; copiado para ${copy} e recomeçando vazio`);
      } catch {
        log(`${reason}; recomeçando vazio`);
      }
      return new FolderStore(file, [], []);
    }
  }

  list(): FolderInfo[] {
    return this.folders.map((folder) => ({ ...folder, exists: isDirectory(folder.path) }));
  }

  find(alias: string): FolderEntry | null {
    const found = this.folders.find((folder) => folder.alias === alias);
    return found ? { ...found } : null;
  }

  add(alias: string, path: string, platform: NodeJS.Platform = process.platform): FolderChange {
    const full = resolve(path);
    if (!ALIAS_PATTERN.test(alias)) return { ok: false, error: "apelido inválido: use até 32 letras minúsculas, números e hífen, começando por letra ou número" };
    if (!isDirectory(full)) return { ok: false, error: `não é uma pasta: ${full}` };
    // O Windows Terminal usa ";" para separar comandos: a janela não abriria nessa pasta.
    if (full.includes(";")) return { ok: false, error: "o caminho não pode ter ; (o Windows Terminal não abre a pasta)" };
    if (this.folders.some((folder) => folder.alias === alias)) return { ok: false, error: `o apelido ${alias} já está em uso` };
    const same = this.folders.find((folder) => folderKey(folder.path, platform) === folderKey(full, platform));
    if (same) return { ok: false, error: `essa pasta já está liberada como ${same.alias}` };
    if (this.folders.length >= MAX_ALIASES) return { ok: false, error: `no máximo ${MAX_ALIASES} pastas` };
    this.folders = [...this.folders, { alias, path: full }];
    this.persist();
    return { ok: true, folders: this.list() };
  }

  remove(alias: string): FolderInfo[] {
    this.folders = this.folders.filter((folder) => folder.alias !== alias);
    this.persist();
    return this.list();
  }

  /** Padrões extras de máscara, escritos à mão no arquivo. */
  secretPatterns(): string[] {
    return [...this.patterns];
  }

  /** Grava `<arquivo>.tmp` e renomeia, para um corte no meio não deixar o arquivo pela metade. */
  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, folders: this.folders, secretPatterns: this.patterns }, null, 2));
    try {
      renameWithRetry(tmp, this.file);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
  }
}
