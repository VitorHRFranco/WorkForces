import { readFileSync } from "node:fs";
import { parseAppearance, type Appearance } from "@workforces/protocol";
import { writeFileAtomic } from "./atomic-write.js";

/** O perfil local do app: uma aparência só, que vale para todos os escritórios. */
export class ProfileStore {
  constructor(private readonly file: string) {}

  /** A aparência guardada; arquivo ausente, quebrado ou inválido dá null. */
  appearance(): Appearance | null {
    try {
      const data: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
      return parseAppearance((data as { appearance?: unknown }).appearance);
    } catch {
      return null;
    }
  }

  setAppearance(appearance: Appearance): void {
    writeFileAtomic(this.file, JSON.stringify({ appearance }));
  }
}
