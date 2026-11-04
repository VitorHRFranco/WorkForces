import { describe, expect, it } from "vitest";
import { findInviteArg, parseInviteLink, parseOfficeAddress } from "../src/links.js";

describe("parseInviteLink", () => {
  it("aceita o link do app e o link https do convite", () => {
    expect(parseInviteLink(" workforces://invite?server=https%3A%2F%2Fescritorio.exemplo&code=Abc_123-x ")).toEqual({ server: "https://escritorio.exemplo", code: "Abc_123-x", pin: null });
    expect(parseInviteLink("WORKFORCES://invite?server=http%3A%2F%2Flocalhost%3A4600&code=abc")).toEqual({ server: "http://localhost:4600", code: "abc", pin: null });
    expect(parseInviteLink("https://escritorio.exemplo:8443/invite/abc")).toEqual({ server: "https://escritorio.exemplo:8443", code: "abc", pin: null });
    expect(parseInviteLink("http://127.0.0.1:4600/invite/abc")).toEqual({ server: "http://127.0.0.1:4600", code: "abc", pin: null });
  });

  it("lê o pino do convite; sem pino ou no link https, pin é null; pino malformado é convite incompleto", () => {
    const pin = "Ab1_-".repeat(8) + "Ab3";
    expect(parseInviteLink(`workforces://invite?server=https%3A%2F%2F192.168.0.10%3A4600&code=abc&pin=${pin}`)).toEqual({ server: "https://192.168.0.10:4600", code: "abc", pin });
    expect(parseInviteLink("workforces://invite?server=https%3A%2F%2Fe.exemplo&code=abc")).toMatchObject({ pin: null });
    expect(parseInviteLink("https://e.exemplo/invite/abc")).toMatchObject({ pin: null });
    expect(parseInviteLink("workforces://invite?server=https%3A%2F%2Fe.exemplo&code=abc&pin=curto")).toEqual({ error: "o convite está incompleto; copie o link inteiro de novo" });
  });

  it("recusa http fora de localhost, código ruim e lixo, dizendo o que fazer", () => {
    expect(parseInviteLink("http://10.0.0.5:4600/invite/abc")).toEqual({ error: expect.stringContaining("https") });
    expect(parseInviteLink("workforces://invite?server=http%3A%2F%2F10.0.0.5&code=abc")).toEqual({ error: expect.stringContaining("https") });
    for (const bad of ["https://e.exemplo/invite/..%2F..", `https://e.exemplo/invite/${"a".repeat(65)}`, "workforces://invite?server=https%3A%2F%2Fe.exemplo", "https://e.exemplo/invite/abc/extra"]) {
      expect(parseInviteLink(bad), bad).toHaveProperty("error");
    }
    for (const junk of ["", "olá", "javascript:alert(1)", "ftp://e.exemplo/invite/abc", "https://usuario:senha@e.exemplo/invite/abc", "workforces://invite?server=javascript%3Aalert(1)&code=abc"]) {
      expect(parseInviteLink(junk), junk).toHaveProperty("error");
    }
  });
});

describe("parseOfficeAddress", () => {
  it("aceita endereço com ou sem https e fica só com a origem", () => {
    expect(parseOfficeAddress("escritorio.exemplo")).toEqual({ url: "https://escritorio.exemplo" });
    expect(parseOfficeAddress("https://escritorio.exemplo/qualquer/coisa")).toEqual({ url: "https://escritorio.exemplo" });
    expect(parseOfficeAddress("http://localhost:4600")).toEqual({ url: "http://localhost:4600" });
    expect(parseOfficeAddress("http://10.0.0.5")).toEqual({ error: expect.stringContaining("https") });
    expect(parseOfficeAddress("não é endereço")).toHaveProperty("error");
  });
});

describe("findInviteArg", () => {
  it("acha o link do app entre os argumentos do Electron", () => {
    expect(findInviteArg(["electron.exe", "C:\\app", "--flag", "workforces://invite?server=x&code=y"])).toBe("workforces://invite?server=x&code=y");
    expect(findInviteArg(["electron.exe", "C:\\app"])).toBeNull();
  });
});
