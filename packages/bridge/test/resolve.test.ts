import { describe, expect, it } from "vitest";
import { cmdArguments, comspec, quoteForCmd, resolveClaude } from "../src/claude/resolve.js";

const fakeFs = (...files: string[]) => {
  const set = new Set(files);
  return (path: string) => set.has(path);
};

describe("resolveClaude", () => {
  it("usa WORKFORCES_CLAUDE_BIN quando definido", () => {
    expect(resolveClaude(["-c"], { env: { WORKFORCES_CLAUDE_BIN: "/opt/fake" }, platform: "linux", isFile: fakeFs() })).toEqual({
      file: "/opt/fake",
      args: ["-c"],
      viaCmd: false,
    });
  });

  it("no Windows respeita a ordem do PATH, sem diferenciar maiúsculas no nome da variável", () => {
    const isFile = fakeFs("C:\\npm\\claude.cmd", "C:\\bin\\claude.exe");
    expect(resolveClaude(["-c"], { env: { Path: "C:\\npm;C:\\bin", PATHEXT: ".EXE;.CMD" }, platform: "win32", isFile })).toEqual({
      file: "C:\\npm\\claude.cmd",
      args: ["-c"],
      viaCmd: true,
    });
  });

  it("na mesma pasta prefere .exe ao .cmd", () => {
    const isFile = fakeFs("C:\\x\\claude.exe", "C:\\x\\claude.cmd");
    expect(resolveClaude([], { env: { PATH: "C:\\x", PATHEXT: ".COM;.EXE;.BAT;.CMD" }, platform: "win32", isFile })?.file).toBe(
      "C:\\x\\claude.exe",
    );
  });

  it("acha o shim do npm numa pasta com espaços", () => {
    const dir = "C:\\Users\\Nome Sobrenome\\AppData\\Roaming\\npm";
    const resolved = resolveClaude(["--resume"], { env: { PATH: dir }, platform: "win32", isFile: fakeFs(`${dir}\\claude.cmd`) });
    expect(resolved).toEqual({ file: `${dir}\\claude.cmd`, args: ["--resume"], viaCmd: true });
    expect(cmdArguments(resolved!)).toBe(`/d /s /c ""${dir}\\claude.cmd" --resume"`);
  });

  it("no Linux procura o executável sem extensão", () => {
    const isFile = fakeFs("/home/u/.local/bin/claude");
    expect(resolveClaude([], { env: { PATH: "/usr/bin:/home/u/.local/bin" }, platform: "linux", isFile })).toEqual({
      file: "/home/u/.local/bin/claude",
      args: [],
      viaCmd: false,
    });
  });

  it("devolve null quando não acha", () => {
    expect(resolveClaude([], { env: { PATH: "/usr/bin" }, platform: "linux", isFile: fakeFs() })).toBeNull();
  });
});

describe("quoteForCmd e comspec", () => {
  it("só põe aspas quando precisa", () => {
    expect(quoteForCmd("simples")).toBe("simples");
    expect(quoteForCmd("C:\\a\\b.cmd")).toBe("C:\\a\\b.cmd");
    expect(quoteForCmd("com espaço")).toBe('"com espaço"');
    expect(quoteForCmd('a"b')).toBe('"a""b"');
    expect(quoteForCmd("")).toBe('""');
  });

  it("usa ComSpec quando existe", () => {
    expect(comspec({ ComSpec: "C:\\Windows\\system32\\cmd.exe" })).toBe("C:\\Windows\\system32\\cmd.exe");
    expect(comspec({})).toBe("cmd.exe");
  });
});
