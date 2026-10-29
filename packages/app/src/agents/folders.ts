import { copyFileSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { ALIAS_PATTERN, MAX_ALIASES, type FolderChange, type FolderInfo } from "@workforces/protocol";
import { writeFileAtomic } from "../atomic-write.js";

export interface FolderEntry {
  alias: string;
  path: string;
}

/** O `agents.json`: as pastas liberadas para "Chamar agente" e os padrões extras de máscara (editados à mão). */
const AgentsFile = z.object({
  version: z.literal(1),
  folders: z.array(z.object({ alias: z.string(), path: z.string() })),
  secretPatterns: z.array(z.string()).default([]),
});

/** Limites do `LocalStart` do canal local: acima disso todo `start` falharia. */
const MAX_PATTERNS = 50;
const MAX_PATTERN_LENGTH = 500;

const SAVE_FAILED = "não consegui salvar a lista de pastas; tente de novo";

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

/** Mantém só as entradas que cumprem as regras do `add` (o arquivo é editável à mão); registra as que saíram. */
function validEntries(entries: FolderEntry[], log: (message: string) => void): FolderEntry[] {
  const kept: FolderEntry[] = [];
  for (const entry of entries) {
    let why: string | null = null;
    if (!ALIAS_PATTERN.test(entry.alias)) why = "apelido inválido";
    else if (!isAbsolute(entry.path)) why = "caminho não é absoluto";
    else if (entry.path.includes(";")) why = "caminho com ;";
    else if (kept.some((other) => other.alias === entry.alias)) why = "apelido repetido";
    else if (kept.some((other) => folderKey(other.path, process.platform) === folderKey(entry.path, process.platform))) why = "pasta repetida";
    else if (kept.length >= MAX_ALIASES) why = `passa de ${MAX_ALIASES} pastas`;
    if (why === null) kept.push(entry);
    else log(`agents.json: pasta ${JSON.stringify(entry.alias)} ignorada (${why})`);
  }
  return kept;
}

/** As pastas que o app pode abrir para um agente. Valem para o computador inteiro, não por escritório. */
export class FolderStore {
  private constructor(
    private readonly file: string,
    private folders: FolderEntry[],
    private readonly patterns: string[],
    private readonly log: (message: string) => void,
    /** O arquivo existe mas não pôde ser lido: nesta execução nada é gravado por cima dele. */
    private readonly readOnly = false,
  ) {}

  static load(file: string, log: (message: string) => void = () => {}): FolderStore {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return new FolderStore(file, [], [], log);
      FolderStore.keepBadCopy(file, `não consegui ler o agents.json (${err instanceof Error ? err.message : String(err)})`, log, "a lista fica só na memória até fechar o app");
      return new FolderStore(file, [], [], log, true);
    }
    try {
      const data = AgentsFile.parse(JSON.parse(raw));
      const folders = validEntries(data.folders, log);
      const patterns = data.secretPatterns.filter((pattern) => pattern.length <= MAX_PATTERN_LENGTH).slice(0, MAX_PATTERNS);
      if (patterns.length < data.secretPatterns.length) {
        log(`agents.json: ${data.secretPatterns.length - patterns.length} padrões de máscara ignorados (no máximo ${MAX_PATTERNS}, de até ${MAX_PATTERN_LENGTH} caracteres)`);
      }
      return new FolderStore(file, folders, patterns, log);
    } catch (err) {
      FolderStore.keepBadCopy(file, `agents.json ilegível (${err instanceof Error ? err.message : String(err)})`, log, "recomeçando vazio");
      return new FolderStore(file, [], [], log);
    }
  }

  private static keepBadCopy(file: string, reason: string, log: (message: string) => void, outcome: string): void {
    const copy = `${file}.bad`;
    try {
      copyFileSync(file, copy);
    } catch {
      log(`${reason}; ${outcome}`);
      return;
    }
    log(`${reason}; copiado para ${copy} e ${outcome}`);
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
    const before = this.folders;
    this.folders = [...before, { alias, path: full }];
    if (!this.persist()) {
      this.folders = before;
      return { ok: false, error: SAVE_FAILED };
    }
    return { ok: true, folders: this.list() };
  }

  remove(alias: string): FolderInfo[] {
    if (!this.folders.some((folder) => folder.alias === alias)) return this.list();
    const before = this.folders;
    this.folders = before.filter((folder) => folder.alias !== alias);
    if (!this.persist()) this.folders = before;
    return this.list();
  }

  /** Padrões extras de máscara, escritos à mão no arquivo. */
  secretPatterns(): string[] {
    return [...this.patterns];
  }

  /** false se não gravou (o erro vai para o registro). */
  private persist(): boolean {
    if (this.readOnly) return true;
    try {
      writeFileAtomic(this.file, JSON.stringify({ version: 1, folders: this.folders, secretPatterns: this.patterns }, null, 2));
      return true;
    } catch (err) {
      this.log(`não consegui gravar o agents.json (${err instanceof Error ? err.message : String(err)})`);
      return false;
    }
  }
}
