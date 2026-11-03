import assert from "node:assert/strict";
import { test } from "node:test";

import { erroDasLinhasCobradas } from "../src/lib/pet-cobranca.ts";

const exigidas = [
  { produto_id: "s", descricao: "Banho", quantidade: 1, preco: 60 },
  { produto_id: "r", descricao: "Ração", quantidade: 2.5, preco: 20 },
];

test("tudo mantido na venda: sem erro", () => {
  assert.equal(
    erroDasLinhasCobradas(
      [
        { produto_id: "s", quantidade: 1, preco: 60 },
        { produto_id: "r", quantidade: 2.5, preco: 20 },
      ],
      exigidas,
    ),
    null,
  );
});

test("pode vender mais do que a ordem, mas não menos", () => {
  const ok = [
    { produto_id: "s", quantidade: 1, preco: 60 },
    { produto_id: "r", quantidade: 4, preco: 20 },
  ];
  assert.equal(erroDasLinhasCobradas(ok, exigidas), null);
  const menos = [
    { produto_id: "s", quantidade: 1, preco: 60 },
    { produto_id: "r", quantidade: 2, preco: 20 },
  ];
  assert.match(erroDasLinhasCobradas(menos, exigidas) ?? "", /Ração/);
});

test("item removido ou com valor mudado é apontado pelo nome", () => {
  assert.match(
    erroDasLinhasCobradas([{ produto_id: "r", quantidade: 2.5, preco: 20 }], exigidas) ?? "",
    /Banho/,
  );
  const preco = [
    { produto_id: "s", quantidade: 1, preco: 50 },
    { produto_id: "r", quantidade: 2.5, preco: 20 },
  ];
  assert.match(erroDasLinhasCobradas(preco, exigidas) ?? "", /Banho.*60/);
  assert.equal(erroDasLinhasCobradas([], []), null);
});
