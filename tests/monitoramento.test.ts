import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  criarLimitador,
  ehRuido,
  impressaoDoErro,
  lerCorpoDoNavegador,
  limparRota,
  limparTexto,
  montarRelato,
} from "../src/lib/monitoramento.ts";

describe("monitoramento: limpeza de dados pessoais", () => {
  it("tira e-mail, token, documento, telefone e id do texto", () => {
    const t = limparTexto(
      "Falha de maria@loja.com.br CPF 123.456.789-09 CNPJ 12.345.678/0001-90 sem máscara 12345678909 fone (16) 98854-7561 " +
        "id 11111111-1111-1111-1111-111111111111 Bearer abc.def-123 jwt eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM",
    );
    assert.doesNotMatch(t, /maria@|123\.456|12\.345|12345678909|98854|1111-1111|abc\.def|eyJ/);
    for (const m of ["[email]", "[documento]", "[numero]", "[id]", "[token]"])
      assert.ok(t.includes(m), m);
  });

  it("corta query e fragmento de URL (código de convite, tokens)", () => {
    assert.equal(
      limparTexto("GET https://app.exemplo.com/portal/entrar?x=1#c=SEGREDO123 falhou"),
      "GET https://app.exemplo.com/portal/entrar falhou",
    );
    assert.equal(limparRota("/portal/entrar?c=abc#c=SEGREDO"), "/portal/entrar");
    assert.equal(limparRota("/pets/11111111-1111-1111-1111-111111111111"), "/pets/[id]");
    assert.equal(limparRota(""), null);
  });

  it("preserva o que ajuda a achar o defeito", () => {
    const t = limparTexto(
      "TypeError: Cannot read properties of undefined (reading 'nome') at Dashboard (/assets/index-AbCd1234.js:10:5)",
    );
    assert.match(t, /Cannot read properties of undefined \(reading 'nome'\)/);
    assert.match(t, /Dashboard/);
  });

  it("monta o relato com limites", () => {
    const e = new Error("x ".repeat(2000));
    const r = montarRelato(e, { origem: "navegador", rota: "/a?b=1" });
    assert.ok(r.mensagem.length <= 500);
    assert.ok((r.stack ?? "").length <= 4000);
    assert.equal(r.rota, "/a");
  });
});

describe("monitoramento: ruído", () => {
  it("ignora o que não é defeito do sistema", () => {
    assert.ok(ehRuido("ResizeObserver loop completed with undisplaced events"));
    assert.ok(ehRuido("Script error."));
    assert.ok(ehRuido("Failed to fetch dynamically imported module: https://x/a.js"));
    assert.ok(ehRuido("TypeError: x", "at chrome-extension://abc/inject.js:1:1"));
    assert.ok(ehRuido("TypeError: Failed to fetch", null, false));
    assert.ok(!ehRuido("TypeError: Failed to fetch", null, true));
    assert.ok(!ehRuido("TypeError: Cannot read properties of undefined"));
  });
});

describe("monitoramento: impressão digital", () => {
  it("o mesmo defeito cai no mesmo grupo, mesmo com números e hashes diferentes", async () => {
    const a = await impressaoDoErro({
      origem: "navegador",
      mensagem: "Erro no pedido 123",
      stack: "Error\n    at f (/assets/index-AbCd1234.js:10:5)",
    });
    const b = await impressaoDoErro({
      origem: "navegador",
      mensagem: "Erro no pedido 987",
      stack: "Error\n    at f (/assets/index-ZzYy9876.js:77:9)",
    });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it("defeitos ou origens diferentes não se misturam", async () => {
    const base = { mensagem: "Erro", stack: null };
    assert.notEqual(
      await impressaoDoErro({ ...base, origem: "navegador" }),
      await impressaoDoErro({ ...base, origem: "servidor" }),
    );
    assert.notEqual(
      await impressaoDoErro({ origem: "navegador", mensagem: "A", stack: null }),
      await impressaoDoErro({ origem: "navegador", mensagem: "B", stack: null }),
    );
  });
});

describe("monitoramento: corpo recebido e limite", () => {
  it("recusa corpo fora do formato e limpa o que aceita", () => {
    assert.equal(lerCorpoDoNavegador(null), null);
    assert.equal(lerCorpoDoNavegador([]), null);
    assert.equal(lerCorpoDoNavegador({ mensagem: "  " }), null);
    assert.equal(lerCorpoDoNavegador({ mensagem: 5 }), null);
    const r = lerCorpoDoNavegador({
      mensagem: "falha de a@b.com",
      rota: "/x?y=1",
      origem: "servidor",
    });
    assert.equal(r?.origem, "navegador");
    assert.equal(r?.mensagem, "falha de [email]");
    assert.equal(r?.rota, "/x");
  });

  it("o limitador barra o excesso e libera depois da janela", () => {
    const ok = criarLimitador(3, 1000);
    assert.ok(ok("ip", 0) && ok("ip", 1) && ok("ip", 2));
    assert.ok(!ok("ip", 3));
    assert.ok(ok("outro", 3));
    assert.ok(ok("ip", 1500));
  });
});
