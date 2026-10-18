import assert from "node:assert/strict";
import { test } from "node:test";
import { ajusteComercial, ratearValorReal } from "../src/lib/conferencia-fisica.ts";

test("rateia o valor real pago (1225) entre solados e tiras, somando exatamente o pago", () => {
  // nota: 950 em placas que viraram 130 solados; tiras fora da nota com referência de R$ 2,75/par
  const [s = 0, a = 0, b = 0] = ratearValorReal(
    [
      { quantidade: 130, base: 950 },
      { quantidade: 80, base: 80 * 2.75 },
      { quantidade: 20, base: 20 * 2.75 },
    ],
    1225,
  );
  assert.equal(Math.round((130 * s + 80 * a + 20 * b) * 100) / 100, 1225);
  assert.equal(a, b);
});

test("sem valor real, mantém o custo da nota", () => {
  assert.deepEqual(ratearValorReal([{ quantidade: 5, base: 950 }], null), [190]);
});

test("item extra sem preço de referência divide o valor pela quantidade", () => {
  assert.deepEqual(
    ratearValorReal(
      [
        { quantidade: 130, base: 950 },
        { quantidade: 100, base: 0 },
      ],
      1150,
    ),
    [5, 5],
  );
});

test("complemento não faturado: 1225 pago − 950 da nota = 275", () => {
  assert.equal(ajusteComercial(950, 1225), 275);
});
