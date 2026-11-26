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

  it("mascara o convite no caminho da API", () => {
    const out = redact("POST /api/invites/AbC123xyz/accept");
    expect(out).not.toContain("AbC123xyz");
    expect(out).toContain("/accept");
  });

  it("mascara o cookie wf_session em todas as formas", () => {
    const secret = "Zq9-Xy8_Wv7Tu6Sr5Qp4";
    expect(redact(`Set-Cookie: wf_session=${secret}; Path=/; HttpOnly`)).not.toContain(secret);
    expect(redact(`cookie: wf_session=${secret}`)).not.toContain(secret);
    expect(redact(`{"wf_session":"${secret}"}`)).not.toContain(secret);
    expect(redact(`{ session: '${secret}' }`)).not.toContain(secret);
  });

  it("deixa intacto o texto sem segredo", () => {
    const text = String.raw`o escritório abriu com 3 agentes em C:\Users\ana`;
    expect(redact(text)).toBe(text);
  });
});
