import assert from "node:assert/strict";
import { test } from "node:test";
import { custosComImpostos } from "../src/lib/nfe-xml.ts";

// Nota real da Rio de Janeiro Refrescos: produtos R$ 201,51 e nota R$ 233,70 (ST 28,18 + IPI 2,61 + outras 1,40).
const itens = [
  { quantidade: 1, total: 14.06 },
  { quantidade: 1, total: 20.54 },
  { quantidade: 1, total: 20.54 },
  { quantidade: 2, total: 81.17 },
  { quantidade: 2, total: 30.56 },
  { quantidade: 2, total: 34.64 },
];

test("o custo dos itens soma o total da nota, com ST, IPI e outras despesas", () => {
  const c = custosComImpostos(itens, { total: 233.7, frete: 0, desconto: 0 });
  const soma = c.reduce((s, u, i) => s + u * itens[i]!.quantidade, 0);
  assert.equal(Math.round(soma * 100) / 100, 233.7);
});

test("custo antigo: frete e desconto ficam fora do rateio", () => {
  const c = custosComImpostos([{ quantidade: 1, total: 100 }], {
    total: 110,
    frete: 10,
    desconto: 0,
  });
  assert.equal(c[0], 100);
});
