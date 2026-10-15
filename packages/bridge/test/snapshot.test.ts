import { describe, expect, it } from "vitest";
import { BUILTIN_PATTERNS } from "../src/masking/patterns.js";
import { createHeadless } from "../src/screen/headless.js";
import { takeSnapshot } from "../src/screen/snapshot.js";
import { stripAnsi } from "./helpers/ansi.js";

const dots = (n: number) => "•".repeat(n);
const at = (row: number, col: number) => `\x1b[${row + 1};${col + 1}H`;

async function snap(cols: number, rows: number, data: string) {
  const headless = createHeadless(cols, rows);
  headless.write(data);
  await headless.flush();
  const snapshot = takeSnapshot(headless.term, BUILTIN_PATTERNS, headless.isCursorVisible());
  headless.dispose();
  return { ...snapshot, text: snapshot.lines.map(stripAnsi) };
}

describe("takeSnapshot", () => {
  it("mascara um token numa linha simples", async () => {
    const token = "ghp_" + "a".repeat(36);
    const s = await snap(60, 3, `${at(0, 0)}token: ${token} fim`);
    expect(s.text[0]).toBe(`token: ${dots(40)} fim`);
    expect(s.lines).toHaveLength(3);
  });

  it("une linhas quebradas pelo terminal antes de aplicar os padrões", async () => {
    const s = await snap(20, 4, "x".repeat(17) + " " + "ghp_" + "a".repeat(36));
    expect(s.text).toEqual(["x".repeat(17) + " " + dots(2), dots(20), dots(18), ""]);
  });

  it("detecta o BEGIN quebrado pelo terminal e mascara até o fim", async () => {
    const s = await snap(30, 4, "x".repeat(20) + "-----BEGIN " + "PRIVATE KEY-----" + "Q".repeat(40));
    expect(s.text).toEqual([dots(30), dots(30), dots(30), dots(30)]);
  });

  it("mascara chave mais alta que a tela (BEGIN no histórico)", async () => {
    const begin = "-----BEGIN " + "OPENSSH PRIVATE KEY-----";
    const end = "-----END " + "OPENSSH PRIVATE KEY-----";
    const body = Array.from({ length: 10 }, (_, i) => "b3BlbnNzaC" + i).join("\r\n");
    const headless = createHeadless(40, 5);
    headless.write(begin + "\r\n" + body);
    await headless.flush();
    const first = takeSnapshot(headless.term, BUILTIN_PATTERNS, true).lines.map(stripAnsi);
    headless.write("\r\n" + end + "\r\n" + "depois");
    await headless.flush();
    const second = takeSnapshot(headless.term, BUILTIN_PATTERNS, true).lines.map(stripAnsi);
    headless.dispose();
    expect(first).toEqual([dots(40), dots(40), dots(40), dots(40), dots(40)]);
    expect(second).toEqual([dots(40), dots(40), dots(40), dots(40), "depois"]);
  });

  it("mascara END sem BEGIN na janela", async () => {
    const begin = "-----BEGIN " + "OPENSSH PRIVATE KEY-----";
    const end = "-----END " + "OPENSSH PRIVATE KEY-----";
    const body = Array.from({ length: 150 }, (_, i) => "b3BlbnNzaC" + i);
    const s = await snap(40, 5, [begin, ...body, end, "depois"].join("\r\n"));
    expect(s.text).toEqual([dots(40), dots(40), dots(40), dots(40), "depois"]);
  });

  it("mascara token quebrado que começou acima da tela", async () => {
    const s = await snap(20, 3, "ghp_" + "a".repeat(76));
    expect(s.text).toEqual([dots(20), dots(20), dots(20)]);
  });

  it("mascara chave PGP", async () => {
    const begin = "-----BEGIN " + "PGP PRIVATE KEY BLOCK-----";
    const end = "-----END " + "PGP PRIVATE KEY BLOCK-----";
    const s = await snap(50, 4, at(0, 0) + "antes" + at(1, 0) + begin + at(2, 0) + "lQOYBF" + at(3, 0) + end);
    expect(s.text).toEqual(["antes", dots(50), dots(50), dots(50)]);
  });

  it("continua a máscara na linha seguinte quando o segredo encosta na borda", async () => {
    const row0 = "│ " + "sk-ant-" + "A".repeat(21) + " │";
    const row1 = "│ " + "B".repeat(10) + " resto" + " ".repeat(13) + "│";
    const s = await snap(32, 3, at(0, 0) + row0 + at(1, 0) + row1);
    expect(s.text[0]).toBe("│ " + dots(28) + " │");
    expect(s.text[1]).toBe("│ " + dots(10) + " resto" + " ".repeat(13) + "│");
  });

  it("mascara token quebrado pela TUI numa caixa", async () => {
    const row0 = "│ " + "x".repeat(14) + " " + "sk-ant-api03" + "  │";
    const row1 = "│ " + "-" + "Q".repeat(25) + "   │";
    const s = await snap(32, 3, at(0, 0) + row0 + at(1, 0) + row1);
    expect(s.text[0]).toBe("│ " + "x".repeat(14) + " " + dots(12) + "  │");
    expect(s.text[1]).toBe("│ " + dots(26) + "   │");
  });

  it("mascara JWT longo quebrado numa caixa", async () => {
    const jwt = "eyJ" + "a".repeat(30) + ".eyJ" + "b".repeat(30) + "." + "c".repeat(20);
    const s = await snap(
      32,
      4,
      at(0, 0) + "│ " + jwt.slice(0, 28) + " │" +
        at(1, 0) + "│ " + jwt.slice(28, 56) + " │" +
        at(2, 0) + "│ " + jwt.slice(56, 84) + " │" +
        at(3, 0) + "│ " + jwt.slice(84) + " ".repeat(24) + " │",
    );
    expect(s.text).toEqual([
      "│ " + dots(28) + " │",
      "│ " + dots(28) + " │",
      "│ " + dots(28) + " │",
      "│ " + dots(4) + " ".repeat(24) + " │",
    ]);
  });

  it("não continua quando o segredo termina longe da borda", async () => {
    const s = await snap(60, 3, at(0, 0) + "DB_PASSWORD=hunter22" + at(1, 0) + "DB_HOST=localhost");
    expect(s.text[0]).toBe("DB_PASSWORD=" + dots(8));
    expect(s.text[1]).toBe("DB_HOST=localhost");
  });

  it("mascara o bloco de chave privada inteiro", async () => {
    const begin = "-----BEGIN " + "OPENSSH PRIVATE KEY-----";
    const end = "-----END " + "OPENSSH PRIVATE KEY-----";
    const s = await snap(40, 5, at(0, 0) + "antes" + at(1, 0) + begin + at(2, 0) + "b3BlbnNzaC1rZXktdjE" + at(3, 0) + end + at(4, 0) + "depois");
    expect(s.text).toEqual(["antes", dots(40), dots(40), dots(40), "depois"]);
  });

  it("acerta as células com emoji e acentos antes do segredo", async () => {
    const s = await snap(40, 2, at(0, 0) + "🔑 ação senha=abcd1234 ok");
    expect(s.text[0]).toBe("🔑 ação senha=" + dots(8) + " ok");
  });

  it("informa a posição e a visibilidade do cursor", async () => {
    const s = await snap(10, 3, at(1, 4) + "\x1b[?25l");
    expect(s.cursor).toEqual({ x: 4, y: 1, visible: false });
  });

  it("mantém o cursor dentro da tela quando a linha está cheia", async () => {
    const s = await snap(4, 2, "ABCD");
    expect(s.cursor.x).toBe(3);
  });
});
