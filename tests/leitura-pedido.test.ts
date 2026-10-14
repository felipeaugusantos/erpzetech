import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acharProdutoPorCodigo,
  aplicarLeitura,
  lerCodigo,
  mensagemLeitura,
  mesmoCodigo,
} from "../src/lib/leitura-pedido.ts";

const itens = [
  { id: "a", produtos: { codigo_barras: "7891000100103", codigo_interno: "CIM-50" } },
  { id: "b", produtos: { codigo_barras: null, codigo_interno: "AREIA-M" } },
  { id: "c", produtos: { codigo_barras: "7891000100103", codigo_interno: "CIM-50" } },
];

test("EAN-13 e GTIN-14 do mesmo produto são o mesmo código", () => {
  assert.ok(mesmoCodigo("7891000100103", "07891000100103"));
  assert.ok(!mesmoCodigo("7891000100103", "7891000100104"));
  assert.ok(!mesmoCodigo("", ""));
  assert.ok(!mesmoCodigo("000", "0"));
  // códigos internos numéricos só casam quando são iguais
  assert.ok(!mesmoCodigo("123", "00123"));
  assert.ok(mesmoCodigo("123", "123"));
  assert.ok(!mesmoCodigo("123456789", "0123456789"));
});

test("código interno vale sem diferenciar maiúsculas", () => {
  assert.ok(mesmoCodigo("cim-50", "CIM-50"));
});

test("acha o produto pelo código de barras ou pelo código interno", () => {
  assert.equal(
    acharProdutoPorCodigo(
      itens.map((i) => ({ ...i.produtos, id: i.id })),
      "AREIA-m",
    )?.id,
    "b",
  );
  assert.equal(
    acharProdutoPorCodigo(
      itens.map((i) => ({ ...i.produtos, id: i.id })),
      "7891000100103",
    )?.id,
    "a",
  );
  assert.equal(
    acharProdutoPorCodigo(
      itens.map((i) => ({ ...i.produtos, id: i.id })),
      "999",
    ),
    null,
  );
});

test("leitura com multiplicador e sem", () => {
  assert.deepEqual(lerCodigo("3*7891000100103"), { quantidade: 3, termo: "7891000100103" });
  assert.deepEqual(lerCodigo("7891000100103"), { quantidade: 1, termo: "7891000100103" });
  assert.equal(lerCodigo("   "), null);
  assert.equal(lerCodigo("0*7891"), null);
});

test("cada leitura soma uma unidade ao item", () => {
  const r = aplicarLeitura(itens.slice(1, 2), { b: 0 }, { b: 4 }, "AREIA-M");
  assert.equal(r.tipo, "ok");
  assert.deepEqual(r.tipo === "ok" && r.alteracoes, { b: 1 });
});

test("multiplicador lê várias unidades de uma vez", () => {
  const r = aplicarLeitura(itens.slice(1, 2), { b: 1 }, { b: 4 }, "3*AREIA-M");
  assert.deepEqual(r.tipo === "ok" && r.alteracoes, { b: 4 });
});

test("passar do limite não altera nada e diz quanto falta", () => {
  const r = aplicarLeitura(itens.slice(1, 2), { b: 3 }, { b: 4 }, "2*AREIA-M");
  assert.deepEqual(r, { tipo: "excede", itemId: "b", restante: 1 });
});

test("item completo recusa nova leitura", () => {
  const r = aplicarLeitura(itens.slice(1, 2), { b: 4 }, { b: 4 }, "AREIA-M");
  assert.equal(r.tipo, "completo");
});

test("código que não é do pedido", () => {
  const r = aplicarLeitura(itens, { a: 0, b: 0, c: 0 }, { a: 5, b: 5, c: 5 }, "123456789");
  assert.deepEqual(r, { tipo: "desconhecido", termo: "123456789" });
});

test("produto em duas linhas do pedido: enche uma e passa para a outra", () => {
  const r = aplicarLeitura(itens, { a: 4, b: 0, c: 0 }, { a: 5, b: 5, c: 3 }, "3*7891000100103");
  assert.equal(r.tipo, "ok");
  assert.deepEqual(r.tipo === "ok" && r.alteracoes, { a: 5, c: 2 });
});

test("mensagens para o operador", () => {
  const nome = (id: string) => `item ${id}`;
  assert.equal(
    mensagemLeitura({ tipo: "ok", alteracoes: { b: 1 }, quantidade: 1, itemId: "b" }, nome).ok,
    true,
  );
  assert.match(
    mensagemLeitura({ tipo: "desconhecido", termo: "9" }, nome).texto,
    /não está neste pedido/,
  );
  assert.match(
    mensagemLeitura({ tipo: "excede", itemId: "b", restante: 1 }, nome).texto,
    /só faltam 1/,
  );
  assert.equal(mensagemLeitura({ tipo: "vazio" }, nome).texto, "");
});
