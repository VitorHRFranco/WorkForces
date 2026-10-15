import { describe, expect, it } from "vitest";
import { compileExtraPatterns, findMaskRanges, mergeRanges, type MaskPattern } from "../src/masking/mask.js";
import { BUILTIN_PATTERNS } from "../src/masking/patterns.js";

const dots = (n: number) => "•".repeat(n);

function maskText(text: string, patterns: readonly MaskPattern[] = BUILTIN_PATTERNS): string {
  const chars = [...text.split("")];
  for (const [start, end] of findMaskRanges(text, patterns)) {
    for (let i = start; i < end; i++) chars[i] = "•";
  }
  return chars.join("");
}

describe("BUILTIN_PATTERNS", () => {
  const cases: [string, string, string][] = [
    ["github", `push ${"ghp_" + "a".repeat(36)} ok`, `push ${dots(40)} ok`],
    ["github-pat", "x " + "github_pat_" + "B".repeat(22), "x " + dots(33)],
    ["gitlab", "glpat-" + "c".repeat(20), dots(26)],
    ["anthropic", "sk-ant-" + "d".repeat(24), dots(31)],
    ["openai", "sk-proj-" + "e".repeat(24), dots(32)],
    ["aws", "id=" + "AKIA" + "F".repeat(16), "id=" + dots(20)],
    ["slack", "xoxb-" + "1".repeat(12), dots(17)],
    ["google", "AIza" + "g".repeat(35), dots(39)],
    ["npm", "npm_" + "h".repeat(36), dots(40)],
    ["workforces", "wf_" + "i".repeat(24), dots(27)],
    ["jwt", "eyJ" + "j".repeat(10) + ".eyJ" + "k".repeat(10) + "." + "l".repeat(10), dots(38)],
    ["senha em URL", "postgres://app:" + "s3nhaForte" + "@db:5432", "postgres://app:" + dots(10) + "@db:5432"],
    ["variável de ambiente", "DB_PASSWORD=hunter22", "DB_PASSWORD=" + dots(8)],
    ["JSON", '"password": "hunter22"', '"password": "' + dots(8) + '"'],
    ["senha", "senha: abcd1234", "senha: " + dots(8)],
    ["Azure", "AccountKey=" + "m".repeat(20) + ";EndpointSuffix=x", "AccountKey=" + dots(20) + ";EndpointSuffix=x"],
  ];

  it.each(cases)("mascara %s", (_name, input, expected) => {
    expect(maskText(input)).toBe(expected);
  });

  it.each([
    "nada de segredo aqui",
    "senha=abc",
    "o comando pwd mostra a pasta",
    "ghp_curto",
    "task-" + "x".repeat(25),
  ])("não mascara %j", (input) => {
    expect(maskText(input)).toBe(input);
  });
});

describe("mergeRanges", () => {
  it("ordena e une intervalos sobrepostos ou encostados", () => {
    expect(mergeRanges([[5, 8], [0, 2], [2, 3], [7, 10]])).toEqual([[0, 3], [5, 10]]);
  });
});

describe("compileExtraPatterns", () => {
  it("compila os válidos e avisa sobre os inválidos", () => {
    const warnings: string[] = [];
    const extra = compileExtraPatterns(["ACME-[0-9]{4}", "(sem fechar"], (message) => warnings.push(message));
    expect(extra).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("(sem fechar");
    expect(maskText("id ACME-1234 ok", extra)).toBe("id " + dots(9) + " ok");
  });
});
