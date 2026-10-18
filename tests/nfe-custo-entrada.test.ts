import assert from "node:assert/strict";
import { test } from "node:test";
import { custosEntrada } from "../src/lib/nfe-xml.ts";

const soma = (r: { composicao: { total: number } }[]) =>
  Math.round(r.reduce((s, x) => s + x.composicao.total, 0) * 100) / 100;

test("frete entra no custo e desconto sai, fechando com o total da nota", () => {
  const r = custosEntrada(
    [
      { quantidade: 2, total: 60 },
      { quantidade: 1, total: 40 },
    ],
    { total: 105, frete: 10, desconto: 5 },
  );
  assert.equal(soma(r), 105);
  assert.equal(r[0]!.composicao.frete, 6);
  assert.equal(r[0]!.composicao.desconto, 3);
});

test("Simples Nacional não tira ICMS do custo", () => {
  const r = custosEntrada(
    [{ quantidade: 1, total: 100, impostos: { icms: 18 } }],
    { total: 100, frete: 0, desconto: 0 },
    "simples",
  );
  assert.equal(r[0]!.custo_unitario, 100);
});

test("Lucro Presumido tira só o ICMS do custo", () => {
  const r = custosEntrada(
    [{ quantidade: 1, total: 100, impostos: { icms: 18, pis: 1.65, cofins: 7.6 } }],
    { total: 100, frete: 0, desconto: 0 },
    "presumido",
  );
  assert.equal(r[0]!.custo_unitario, 82);
});

test("Lucro Real tira ICMS, PIS e COFINS do custo", () => {
  const r = custosEntrada(
    [{ quantidade: 1, total: 100, impostos: { icms: 18, pis: 1.65, cofins: 7.6 } }],
    { total: 100, frete: 0, desconto: 0 },
    "real",
  );
  assert.equal(r[0]!.custo_unitario, 72.75);
});

test("ST e IPI do item ficam no próprio item", () => {
  const r = custosEntrada(
    [
      { quantidade: 1, total: 50, impostos: { icms_st: 10, ipi: 5 } },
      { quantidade: 1, total: 50 },
    ],
    { total: 115, frete: 0, desconto: 0 },
  );
  assert.equal(r[0]!.composicao.total, 65);
  assert.equal(r[1]!.composicao.total, 50);
});
