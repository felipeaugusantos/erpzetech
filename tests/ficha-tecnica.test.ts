import assert from "node:assert/strict";
import { test } from "node:test";

import {
  consumoReal,
  custoDoInsumo,
  custoDoPrato,
  faixaCmv,
  margemDoPrato,
} from "../src/lib/ficha-tecnica.ts";

test("consumo real soma a perda de preparo", () => {
  assert.equal(consumoReal(0.15, 0), 0.15);
  assert.equal(consumoReal(0.15, 10), 0.1667);
  assert.equal(consumoReal(1, 50), 2);
  // perda nunca chega a 100%
  assert.ok(Number.isFinite(consumoReal(1, 100)));
});

test("custo do insumo: médio do depósito, senão o do cadastro", () => {
  assert.equal(custoDoInsumo(42, 40), 42);
  assert.equal(custoDoInsumo(0, 40), 40);
  assert.equal(custoDoInsumo(null, 40), 40);
  assert.equal(custoDoInsumo(undefined, undefined), 0);
});

test("custo do prato: carne com perda, pão e bacon", () => {
  const custo = custoDoPrato([
    { quantidade: 0.15, perda_percentual: 10, custoUnitario: 40 }, // 0,1667 kg × 40 = 6,668
    { quantidade: 1, perda_percentual: 0, custoUnitario: 1.5 },
    { quantidade: 0.03, perda_percentual: 0, custoUnitario: 60 }, // 1,80
  ]);
  assert.equal(custo, 9.97);
  assert.equal(custoDoPrato([]), 0);
});

test("margem e CMV do prato", () => {
  const m = margemDoPrato(30, 9.97);
  assert.deepEqual(m, { custo: 9.97, lucro: 20.03, cmvPercentual: 33.2, margemPercentual: 66.8 });
  assert.equal(margemDoPrato(0, 5), null);
  assert.equal(margemDoPrato(10, 12)?.lucro, -2);
});

test("faixas de CMV", () => {
  assert.equal(faixaCmv(30), "bom");
  assert.equal(faixaCmv(40), "atencao");
  assert.equal(faixaCmv(60), "alto");
});
