import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emLotes, letraInicial, lerBulario, registroInativo } from "../src/lib/bulario.ts";

describe("bulário (CSV do MAPA)", () => {
  it("reconhece as colunas pelo nome e guarda o resto em extras", () => {
    const csv =
      "Número Registro;Nome Comercial;Empresa;Princípio Ativo;Situação;Forma\n" +
      '123;"ADAPTIL Difusor";CEVA;Feromônio;Ativo;Difusor\n' +
      ";;CEVA;x;Ativo;y\n";
    const l = lerBulario(csv);
    assert.equal(l.erro, undefined);
    assert.equal(l.itens.length, 1);
    assert.equal(l.ignoradas, 1);
    assert.deepEqual(l.itens[0]?.extras, { Forma: "Difusor" });
    assert.equal(l.itens[0]?.fabricante, "CEVA");
    assert.equal(l.itens[0]?.registro, "123");
  });
  it("recusa arquivo sem coluna de nome e lista as colunas achadas", () => {
    const l = lerBulario("a;b\n1;2\n");
    assert.match(l.erro ?? "", /a \| b/);
    assert.equal(l.itens.length, 0);
  });
  it("arquivo vazio", () => {
    assert.ok(lerBulario("").erro);
  });
  it("lotes, letra inicial e situação", () => {
    assert.deepEqual(emLotes([1, 2, 3], 2), [[1, 2], [3]]);
    assert.equal(letraInicial("Ácaro"), "A");
    assert.equal(letraInicial("4Dx Plus"), "#");
    assert.equal(registroInativo("Registro Cancelado"), true);
    assert.equal(registroInativo("Ativo"), false);
    assert.equal(registroInativo(null), false);
  });
});
