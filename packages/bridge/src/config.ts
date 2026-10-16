import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { LIMITS } from "@workforces/protocol";
import { z } from "zod";

export const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const Config = z
  .object({
    server: z.string().optional(),
    token: z.string().min(1).optional(),
    insecure: z.boolean().default(false),
    folders: z.array(z.object({ alias: z.string().regex(ALIAS_PATTERN), path: z.string().min(1) })).default([]),
    secretPatterns: z.array(z.string()).default([]),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    for (const folder of config.folders) {
      if (seen.has(folder.alias)) ctx.addIssue({ code: "custom", message: `apelido repetido: ${folder.alias}` });
      seen.add(folder.alias);
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
  const normalize = (path: string) => (platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
  const here = normalize(cwd);
  const match = folders.find((folder) => normalize(folder.path) === here);
  const label = match?.alias ?? (basename(resolve(cwd)) || resolve(cwd));
  return label.slice(0, LIMITS.maxLabelLength);
}

export function saveConfig(dir: string, config: Config): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}
