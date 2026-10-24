import assert from "node:assert/strict";
import { test } from "node:test";

import { precoNaTabela, reprecificarLinhas, rotuloAjuste } from "../src/lib/tabela-preco.ts";

const atacado = { ajuste_percentual: -10, ativa: true };

test("sem tabela ou com tabela inativa vale o preço de venda", () => {
  assert.equal(precoNaTabela(100, null), 100);
  assert.equal(precoNaTabela(100, undefined), 100);
  assert.equal(precoNaTabela(100, { ajuste_percentual: -10, ativa: false }), 100);
  assert.equal(precoNaTabela(100, { ajuste_percentual: -10, ativa: false }, 50), 100);
});

test("o ajuste percentual aplica desconto ou acréscimo e arredonda em centavos", () => {
  assert.equal(precoNaTabela(100, atacado), 90);
  assert.equal(precoNaTabela(99.99, atacado), 89.99);
  assert.equal(precoNaTabela(10, { ajuste_percentual: 5, ativa: true }), 10.5);
  assert.equal(precoNaTabela(33.33, { ajuste_percentual: -33.33, ativa: true }), 22.22);
  assert.equal(precoNaTabela(100, { ajuste_percentual: 0, ativa: true }), 100);
});

test("o preço fixado do produto vale mais que o ajuste da tabela", () => {
  assert.equal(precoNaTabela(100, atacado, 85), 85);
  assert.equal(precoNaTabela(100, atacado, 0), 0);
  assert.equal(precoNaTabela(100, atacado, null), 90);
  assert.equal(precoNaTabela(100, atacado, Number.NaN), 90);
});

test("o preço nunca fica negativo", () => {
  assert.equal(precoNaTabela(100, { ajuste_percentual: -100, ativa: true }), 0);
  assert.equal(precoNaTabela(0, atacado), 0);
});

test("rótulo do ajuste", () => {
  assert.equal(rotuloAjuste(0), "Preço normal");
  assert.equal(rotuloAjuste(-10), "10% de desconto");
  assert.equal(rotuloAjuste(5.5), "5,5% de acréscimo");
});

test("reprecificar troca só as linhas de preço automático que o operador não mexeu", () => {
  const linhas = [
    { produto_id: "a", preco: 100, precoAuto: 100 }, // automático: troca
    { produto_id: "b", preco: 70, precoAuto: 100 }, // preço alterado à mão: mantém
    { produto_id: "c", preco: 50 }, // veio de outra origem (serviço, modelo): mantém
    { produto_id: "d", preco: 20, precoAuto: 20 }, // produto desconhecido: mantém
  ];
  const novo = reprecificarLinhas(linhas, (id) => (id === "d" ? null : 90));
  assert.deepEqual(novo, [
    { produto_id: "a", preco: 90, precoAuto: 90 },
    { produto_id: "b", preco: 70, precoAuto: 100 },
    { produto_id: "c", preco: 50 },
    { produto_id: "d", preco: 20, precoAuto: 20 },
  ]);
});

test("reprecificar devolve o mesmo array quando nada muda", () => {
  const linhas = [{ produto_id: "a", preco: 100, precoAuto: 100 }];
  assert.equal(
    reprecificarLinhas(linhas, () => 100),
    linhas,
  );
  const vazio: { produto_id: string; preco: number; precoAuto?: number }[] = [];
  assert.equal(
    reprecificarLinhas(vazio, () => 1),
    vazio,
  );
});

test("voltar ao preço normal (sem tabela) também reprecifica", () => {
  const linhas = [{ produto_id: "a", preco: 90, precoAuto: 90 }];
  assert.deepEqual(
    reprecificarLinhas(linhas, () => 100),
    [{ produto_id: "a", preco: 100, precoAuto: 100 }],
  );
});
