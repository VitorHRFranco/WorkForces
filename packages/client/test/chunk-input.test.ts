import { describe, expect, it } from "vitest";
import { chunkInput } from "../src/office/chunk-input";

describe("chunkInput", () => {
  it("corta uma colagem de 10 000 caracteres em 3 pedaços que, juntos, dão o texto original", () => {
    const data = Array.from({ length: 10_000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
    const chunks = chunkInput(data, 4096);
    expect(chunks.map((chunk) => chunk.length)).toEqual([4096, 4096, 1808]);
    expect(chunks.join("")).toBe(data);
  });

  it("nunca parte um par substituto na divisa", () => {
    // O emoji ocupa as posições 4095 e 4096: um corte em 4096 o partiria ao meio.
    const data = `${"a".repeat(4095)}😀${"b".repeat(5000)}`;
    const chunks = chunkInput(data, 4096);
    expect(chunks.join("")).toBe(data);
    expect(chunks[0]).toHaveLength(4095);
    expect(chunks[1]!.startsWith("😀")).toBe(true);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
      // Nenhum pedaço termina com a metade alta nem começa com a metade baixa de um par.
      expect(chunk).not.toMatch(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/);
    }
  });

  it("texto vazio não gera pedaço", () => {
    expect(chunkInput("", 4096)).toEqual([]);
  });
});
