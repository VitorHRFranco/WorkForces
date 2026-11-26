import { describe, expect, it } from "vitest";
import { redact } from "../src/log/redact.js";

describe("redact", () => {
  it("mascara o código de convite na URL", () => {
    const out = redact("abri https://x.com/invite/AbC123xyz");
    expect(out).not.toContain("AbC123xyz");
    expect(out).toContain("••••");
  });

  it("mascara o valor de code= e mantém o resto da query", () => {
    const out = redact("?code=segredo123&a=1");
    expect(out).not.toContain("segredo123");
    expect(out).toContain("&a=1");
  });

  it("mascara tokens, Bearer e sessão em JSON", () => {
    expect(redact("token wf_" + "a".repeat(30))).not.toContain("a".repeat(30));
    expect(redact("Authorization: Bearer abcdefghijklmnopqrstu")).not.toContain("abcdefghijklmnopqrstu");
    expect(redact('{"session":"s3cr3t-s3ss10n"}')).not.toContain("s3cr3t-s3ss10n");
    expect(redact('{"sessionId":"abc-987-zzz"}')).not.toContain("abc-987-zzz");
    expect(redact("cookie=chocolate42")).not.toContain("chocolate42");
  });

  it("deixa intacto o texto sem segredo", () => {
    const text = "o escritório abriu com 3 agentes em C:\Users\ana";
    expect(redact(text)).toBe(text);
  });
});
