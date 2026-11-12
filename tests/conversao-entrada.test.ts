import assert from "node:assert/strict";
import { test } from "node:test";
import { fatorEntrada, quantidadeEntrada } from "../src/lib/conversao-entrada.ts";
import { ratearValorReal } from "../src/lib/conferencia-fisica.ts";

const coca = { unidade: "UN", unidade_compra: "CX", fator_conversao: 6 };

test("produto 110441: três fardos com seis unidades entram como 18 unidades", () => {
  assert.equal(quantidadeEntrada(3, fatorEntrada("CX", coca)), 18);
});
test("o custo total de 175,88 é dividido pelas 18 unidades", () => {
  const [custo = 0] = ratearValorReal([{ quantidade: quantidadeEntrada(3, 6), base: 175.88 }], null);
  assert.equal(custo, 9.771111);
  assert.equal(Math.round(custo * 18 * 100) / 100, 175.88);
});
test("nota em unidade de estoque não é multiplicada de novo", () => {
  assert.equal(quantidadeEntrada(18, fatorEntrada("UN", coca)), 18);
});
test("unidade diferente da compra não assume a conversão", () => {
  assert.equal(fatorEntrada("KG", coca), 1);
});
test("fator inválido não permite importação", () => {
  assert.throws(() => quantidadeEntrada(3, 0));
});