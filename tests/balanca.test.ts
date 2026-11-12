import assert from "node:assert/strict";
import { test } from "node:test";

import { ean13Valido } from "../src/lib/ean13.ts";
import {
  acharProdutoDeBalanca,
  codigoBalancaDoProduto,
  ehUnidadeDePeso,
  gerarCodigoBalanca,
  lerCodigoBalanca,
  leituraDeBalancaNoPdv,
  valorDaPesagem,
} from "../src/lib/balanca.ts";

test("código de balança: prefixo 2, código de 6 dígitos, peso em gramas e dígito verificador", () => {
  const c = gerarCodigoBalanca("123", 850);
  assert.equal(c.length, 13);
  assert.equal(c.slice(0, 12), "2000123" + "00850");
  assert.equal(ean13Valido(c), true);
  assert.deepEqual(lerCodigoBalanca(c), { codigo: "000123", pesoG: 850 });
  assert.deepEqual(lerCodigoBalanca(gerarCodigoBalanca("999999", 99_999)), {
    codigo: "999999",
    pesoG: 99_999,
  });
});

test("código de balança: recusa código de produto e peso que não cabem", () => {
  for (const c of ["P-77", "", "1234567", "0", "000000", "12 3", null, undefined]) {
    assert.equal(codigoBalancaDoProduto(c as string), null, String(c));
    assert.throws(() => gerarCodigoBalanca(c as string, 500));
  }
  for (const g of [0, -5, 100_000, 1.5, NaN])
    assert.throws(() => gerarCodigoBalanca("12", g), String(g));
  assert.equal(codigoBalancaDoProduto(" 00012 "), "000012");
});

test("leitura: só aceita EAN-13 de prefixo 2, dígito certo e peso maior que zero", () => {
  const ok = gerarCodigoBalanca("7", 1200);
  assert.ok(lerCodigoBalanca(ok));
  assert.equal(lerCodigoBalanca(ok.slice(0, 12) + ((Number(ok[12]) + 1) % 10)), null); // dígito errado
  assert.equal(lerCodigoBalanca("4006381333931"), null); // outro EAN
  assert.equal(lerCodigoBalanca("2000007" + "00000" + "0"), null);
  assert.equal(lerCodigoBalanca("2000007005"), null); // curto
  assert.equal(lerCodigoBalanca("abc"), null);
  assert.deepEqual(lerCodigoBalanca(` ${ok} `)?.pesoG, 1200);
});

test("produto de balança: só vendido por kg e com código único", () => {
  const p = [
    { id: "a", codigo_interno: "123", unidade: "UN", unidade_venda: "KG" },
    { id: "b", codigo_interno: "124", unidade: "UN", unidade_venda: "UN" },
    { id: "c", codigo_interno: "P-9", unidade: "KG", unidade_venda: null },
    { id: "d", codigo_interno: "125", unidade: "kg", unidade_venda: null },
  ];
  assert.equal(acharProdutoDeBalanca(p, "000123")?.id, "a");
  assert.equal(acharProdutoDeBalanca(p, "000124"), null); // não é por kg
  assert.equal(acharProdutoDeBalanca(p, "000125")?.id, "d"); // unidade do estoque quando não há de venda
  assert.equal(acharProdutoDeBalanca(p, "009999"), null);
  // 123 e 00123 viram o mesmo código de balança: ambíguo, não escolhe
  assert.equal(
    acharProdutoDeBalanca(
      [...p, { id: "e", codigo_interno: "00123", unidade_venda: "KG" }],
      "00123",
    ),
    null,
  );
  assert.equal(ehUnidadeDePeso(" Kg "), true);
  assert.equal(ehUnidadeDePeso("KGS"), false);
  assert.equal(ehUnidadeDePeso(null), false);
});

test("valor da pesagem usa centavos inteiros", () => {
  assert.equal(valorDaPesagem(850, 39.9), 33.92); // 0,85 × 39,90 = 33,915
  assert.equal(valorDaPesagem(1000, 10), 10);
  assert.equal(valorDaPesagem(0, 10), null);
});

test("caixa: etiqueta de balança vira produto por kg e peso; o resto segue a busca normal", () => {
  const produtos = [
    { id: "a", codigo_interno: "123", unidade_venda: "KG", unidade: "UN" },
    { id: "b", codigo_interno: "124", unidade_venda: "UN", unidade: "UN" },
  ];
  const r = leituraDeBalancaNoPdv(produtos, gerarCodigoBalanca("123", 1250));
  assert.deepEqual(r && "produto" in r ? [r.produto.id, r.quantidade] : r, ["a", 1.25]);
  assert.equal(leituraDeBalancaNoPdv(produtos, "ração"), null);
  assert.equal(leituraDeBalancaNoPdv(produtos, "4006381333931"), null);
  const sem = leituraDeBalancaNoPdv(produtos, gerarCodigoBalanca("124", 500)); // produto 124 não é por kg
  assert.ok(sem && "erro" in sem && /código 124/.test(sem.erro));
  const nenhum = leituraDeBalancaNoPdv([], gerarCodigoBalanca("9", 500));
  assert.ok(nenhum && "erro" in nenhum);
});
