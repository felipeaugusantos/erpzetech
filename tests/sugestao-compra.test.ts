import assert from "node:assert/strict";
import { test } from "node:test";
import { sugerirCompra } from "../src/lib/sugestao-compra.ts";

const base = {
  vendidoNaJanela: 90,
  diasJanela: 30,
  fisico: 10,
  reservado: 0,
  emCompra: 0,
  minimo: 0,
  maximo: 0,
  prazoFornecedorDias: 5,
  coberturaDias: 30,
  fatorCompra: 1,
};

test("vende 3/dia, prazo 5 e cobertura 30: compra o que falta para cobrir prazo + 30 dias", () => {
  // alvo 105 (15 + 90); falta 105 + 15 − 10 = 110
  assert.equal(sugerirCompra(base).quantidade, 110);
});

test("reservado sai do disponível e aumenta a compra", () => {
  assert.equal(sugerirCompra({ ...base, reservado: 10 }).quantidade, 120);
});

test("o que já foi pedido ao fornecedor reduz a sugestão", () => {
  assert.equal(sugerirCompra({ ...base, emCompra: 100 }).quantidade, 10);
});

test("arredonda para cima em embalagens de compra (palete de 50 sacos)", () => {
  const s = sugerirCompra({ ...base, fatorCompra: 50 });
  assert.equal(s.embalagens, 3);
  assert.equal(s.quantidade, 150);
});

test("sem vendas e acima do mínimo não sugere compra", () => {
  const s = sugerirCompra({ ...base, vendidoNaJanela: 0, minimo: 5 });
  assert.equal(s.quantidade, 0);
});

test("sem vendas e abaixo do mínimo repõe até o mínimo", () => {
  const s = sugerirCompra({ ...base, vendidoNaJanela: 0, fisico: 2, minimo: 20 });
  assert.equal(s.quantidade, 18);
});

test("respeita o estoque máximo", () => {
  const s = sugerirCompra({ ...base, maximo: 50 });
  assert.equal(s.alvo, 50);
  assert.equal(s.quantidade, 55); // 50 + 15 de consumo no prazo − 10
});

test("cada sugestão traz os fatores que explicam a conta", () => {
  const s = sugerirCompra({ ...base, emCompra: 5, minimo: 4 });
  assert.ok(s.fatores.some((f) => f.includes("Venda média de 3/dia")));
  assert.ok(s.fatores.some((f) => f.includes("já pedidos")));
  assert.ok(s.fatores.some((f) => f.includes("Prazo do fornecedor 5 dias")));
});
