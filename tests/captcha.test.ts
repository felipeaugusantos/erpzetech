import assert from "node:assert/strict";
import test from "node:test";

import { URL_VERIFICACAO_TURNSTILE, ipDoEnvio, verificarTurnstile } from "../src/lib/captcha.ts";

const resposta = (ok: boolean, corpo: unknown) => ({ ok, json: async () => corpo });

test("sem segredo configurado o CAPTCHA fica desligado e não consulta ninguém", async () => {
  let chamadas = 0;
  const r = await verificarTurnstile(undefined, "", "1.2.3.4", async () => {
    chamadas++;
    return resposta(true, { success: true });
  });
  assert.deepEqual(r, { ok: true });
  assert.equal(chamadas, 0);
});

test("com segredo, sem token o envio é barrado sem consultar a Cloudflare", async () => {
  let chamadas = 0;
  const buscar = async () => {
    chamadas++;
    return resposta(true, { success: true });
  };
  assert.deepEqual(await verificarTurnstile("", "segredo", null, buscar), {
    ok: false,
    motivo: "ausente",
  });
  assert.deepEqual(await verificarTurnstile("  ", "segredo", null, buscar), {
    ok: false,
    motivo: "ausente",
  });
  assert.deepEqual(await verificarTurnstile(null, "segredo", null, buscar), {
    ok: false,
    motivo: "ausente",
  });
  assert.equal(chamadas, 0);
});

test("token aceito pela Cloudflare libera; recusado bloqueia", async () => {
  assert.deepEqual(
    await verificarTurnstile("tk", "segredo", "1.2.3.4", async () =>
      resposta(true, { success: true }),
    ),
    { ok: true },
  );
  assert.deepEqual(
    await verificarTurnstile("tk", "segredo", null, async () =>
      resposta(true, { success: false, "error-codes": ["invalid-input-response"] }),
    ),
    { ok: false, motivo: "recusado" },
  );
});

test("envia segredo, token e IP para a Cloudflare", async () => {
  let url = "";
  let corpo = "";
  await verificarTurnstile("meu-token", "meu-segredo", "203.0.113.9", async (u, init) => {
    url = u;
    corpo = String(init.body);
    return resposta(true, { success: true });
  });
  assert.equal(url, URL_VERIFICACAO_TURNSTILE);
  const p = new URLSearchParams(corpo);
  assert.equal(p.get("secret"), "meu-segredo");
  assert.equal(p.get("response"), "meu-token");
  assert.equal(p.get("remoteip"), "203.0.113.9");
});

test("Cloudflare fora do ar ou resposta com erro: bloqueia com motivo de indisponível, nunca libera", async () => {
  assert.deepEqual(
    await verificarTurnstile("tk", "segredo", null, async () => {
      throw new Error("rede");
    }),
    { ok: false, motivo: "indisponivel" },
  );
  assert.deepEqual(
    await verificarTurnstile("tk", "segredo", null, async () => resposta(false, {})),
    { ok: false, motivo: "indisponivel" },
  );
  assert.deepEqual(
    await verificarTurnstile("tk", "segredo", null, async () => ({
      ok: true,
      json: async () => {
        throw new Error("json ruim");
      },
    })),
    { ok: false, motivo: "indisponivel" },
  );
});

test("o IP vem de cf-connecting-ip, senão do primeiro de x-forwarded-for", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  assert.equal(
    ipDoEnvio(h({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "10.0.0.1" })),
    "198.51.100.7",
  );
  assert.equal(ipDoEnvio(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  assert.equal(ipDoEnvio(h({})), null);
  assert.equal(ipDoEnvio(h({ "x-forwarded-for": " " })), null);
});
