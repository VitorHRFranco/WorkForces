import { homedir } from "node:os";
import { join } from "node:path";

/** Pasta do log da ponte (`bridge.log`). */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.WORKFORCES_HOME ?? join(homedir(), ".workforces");
}
