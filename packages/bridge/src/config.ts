import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { ALIAS_PATTERN, LIMITS, MAX_ALIASES } from "@workforces/protocol";
import { z } from "zod";

/** Caminho comparável: absoluto e, no Windows, sem diferenciar maiúsculas. */
export function folderKey(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// looseObject: as chaves que esta versão não conhece continuam no arquivo quando ele é regravado.
export const Config = z
  .looseObject({
    server: z.string().optional(),
    token: z.string().min(1).optional(),
    insecure: z.boolean().default(false),
    folders: z
      .array(z.object({ alias: z.string().regex(ALIAS_PATTERN), path: z.string().min(1) }))
      .max(MAX_ALIASES)
      .default([]),
    secretPatterns: z.array(z.string()).default([]),
  })
  .superRefine((config, ctx) => {
    const aliases = new Set<string>();
    const paths = new Map<string, string>();
    for (const folder of config.folders) {
      if (aliases.has(folder.alias)) ctx.addIssue({ code: "custom", message: `apelido repetido: ${folder.alias}` });
      aliases.add(folder.alias);
      const other = paths.get(folderKey(folder.path));
      if (other !== undefined) ctx.addIssue({ code: "custom", message: `a pasta ${folder.path} aparece duas vezes (${other} e ${folder.alias})` });
      paths.set(folderKey(folder.path), folder.alias);
    }
  });
export type Config = z.infer<typeof Config>;

export class ConfigError extends Error {}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.WORKFORCES_HOME ?? join(homedir(), ".workforces");
}

export function loadConfig(dir: string): Config {
  const file = join(dir, "config.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return Config.parse({});
    throw new ConfigError(`não consegui ler ${file}: ${(err as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new ConfigError(`${file} não é um JSON válido`);
  }
  const result = Config.safeParse(data);
  if (!result.success) {
    throw new ConfigError(`${file} inválido: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return result.data;
}

/** Rótulo do agente: o apelido da pasta liberada, ou o nome da pasta atual. */
export function labelFor(cwd: string, folders: Config["folders"], platform: NodeJS.Platform = process.platform): string {
  const here = folderKey(cwd, platform);
  const match = folders.find((folder) => folderKey(folder.path, platform) === here);
  const label = match?.alias ?? (basename(resolve(cwd)) || resolve(cwd));
  return label.slice(0, LIMITS.maxLabelLength);
}

export function saveConfig(dir: string, config: Config): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "config.json");
  const temp = `${file}.${process.pid}.tmp`;
  // O arquivo guarda o token da ponte: só o dono lê (no Windows o modo é ignorado).
  try {
    writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
