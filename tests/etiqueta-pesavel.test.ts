import assert from "node:assert/strict";
import { test } from "node:test";

import { lerCodigoBalanca } from "../src/lib/balanca.ts";
import { etiquetaDoProduto, htmlEtiquetas, modeloEtiqueta } from "../src/lib/etiqueta.ts";
import { etiquetaPesavel } from "../src/lib/etiqueta-pesavel.ts";
import { comandosEtiquetas } from "../src/lib/etiqueta-raw.ts";

const PRODUTO = {
  descricao: "Ração a granel",
  descricao_resumida: null,
  codigo_barras: null,
  codigo_interno: "123",
  preco_venda: 39.9,
  unidade: "UN",
  unidade_venda: "KG",
};

test("produto por kg com pesagem ligada vira etiqueta que pede o peso", () => {
  const b = etiquetaDoProduto(PRODUTO, { pesagem: true });
  assert.deepEqual(b.pesavel, { codigoInterno: "123", precoKg: 39.9 });
  assert.equal(etiquetaDoProduto(PRODUTO).pesavel, undefined); // sem pedir, nada muda
  assert.equal(
    etiquetaDoProduto({ ...PRODUTO, unidade_venda: "UN" }, { pesagem: true }).pesavel,
    undefined,
  );
});

test("etiqueta de pesagem: valor, peso, código de balança e validade", () => {
  const e = etiquetaPesavel(etiquetaDoProduto(PRODUTO, { pesagem: true }), 850, "2026-12-31");
  assert.equal(e.preco, 33.92);
  assert.deepEqual(e.pesagem, { pesoG: 850, precoKg: 39.9 });
  assert.equal(e.validade, "31/12/2026");
  assert.equal(e.unidade, null);
  assert.deepEqual(lerCodigoBalanca(e.codigo!), { codigo: "000123", pesoG: 850 });
});

test("etiqueta de pesagem: recusa produto sem preço, peso inválido e código que não é número", () => {
  const base = etiquetaDoProduto(PRODUTO, { pesagem: true });
  assert.throws(() => etiquetaPesavel(base, 0), /Peso inválido/);
  assert.throws(() => etiquetaPesavel(base, 100_000), /limite/);
  assert.throws(
    () => etiquetaPesavel({ ...base, pesavel: { codigoInterno: "123", precoKg: 0 } }, 500),
    /sem preço/,
  );
  assert.throws(
    () => etiquetaPesavel({ ...base, pesavel: { codigoInterno: "P-1", precoKg: 9 } }, 500),
    /números/,
  );
  assert.throws(() => etiquetaPesavel({ ...base, pesavel: null }, 500), /sem preço por kg/);
});

test("o modelo pesável mostra peso e preço do kg nos três formatos", () => {
  const m = modeloEtiqueta("t-60x40-pesavel")!;
  const e = etiquetaPesavel(etiquetaDoProduto(PRODUTO, { pesagem: true }), 850);
  const html = htmlEtiquetas(m, [e]);
  assert.ok(html.includes("0,850 kg × R$ 39,90/kg"));
  assert.ok(html.includes("R$ 33,92"));
  for (const linguagem of ["zpl", "tspl"] as const) {
    const t = comandosEtiquetas(m, [e], { linguagem, dpi: 203 });
    assert.ok(t.includes("0,850 kg × R$ 39,90/kg"), linguagem);
    assert.ok(t.includes(e.codigo!), `${linguagem}: código de balança`);
  }
  // sem pesagem o campo some, sem deixar linha vazia
  assert.ok(!htmlEtiquetas(m, [{ descricao: "X" }]).includes("kg ×"));
});
