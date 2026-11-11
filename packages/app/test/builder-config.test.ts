import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface BuilderConfig {
  electronVersion?: string;
  appId?: string;
  productName?: string;
  artifactName?: string;
  npmRebuild?: boolean;
  nsis?: { perMachine?: boolean; oneClick?: boolean };
  protocols?: { schemes: string[] }[];
  publish?: unknown;
  extraResources?: unknown[];
}

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;
const config = read<BuilderConfig>("../release/electron-builder.json");
const app = read<{ devDependencies: Record<string, string> }>("../package.json");

// O instalador é o que o usuário guarda: identidade, instalação por usuário e o endereço dos releases não mudam por acaso.
describe("configuração do electron-builder", () => {
  it("empacota o Electron do app, na mesma versão", () => {
    expect(config.electronVersion).toBe(app.devDependencies.electron);
  });

  it("mantém a identidade do app e o nome do instalador", () => {
    expect(config.appId).toBe("io.github.vitorhrfranco.workforces");
    expect(config.productName).toBe("WorkForces");
    expect(config.artifactName).toBe("WorkForces-Setup-${version}.${ext}");
  });

  it("instala por usuário, sem perguntas", () => {
    expect(config.nsis?.perMachine).toBe(false);
    expect(config.nsis?.oneClick).toBe(true);
  });

  it("registra o link workforces://", () => {
    expect(config.protocols?.[0]?.schemes).toContain("workforces");
  });

  it("publica como rascunho nos releases do repositório", () => {
    expect(config.publish).toEqual({ provider: "github", owner: "VitorHRFranco", repo: "WorkForces", releaseType: "draft" });
  });

  it("não recompila módulos nativos e leva o runtime para resources/runtime", () => {
    expect(config.npmRebuild).toBe(false);
    expect(config.extraResources).toContainEqual(expect.objectContaining({ from: "release/stage/runtime", to: "runtime" }));
  });
});
