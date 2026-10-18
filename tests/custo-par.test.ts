import assert from "node:assert/strict";
import { test } from "node:test";
import { custoPar, margemPar } from "../src/lib/personalizacao.ts";

test("custo do par soma tira, solado, fração da folha e outros", () => {
  const c = custoPar({ tira: 1.15, tirasPorPar: 1, solado: 4, soladosPorPar: 1, folha: 3, paresPorFolha: 4, outros: 0.5 });
  assert.ok(Math.abs(c.folha - 0.75) < 1e-9);
  assert.ok(Math.abs(c.total - 6.4) < 1e-9);
});

test("margem sobre o preço de venda", () => {
  assert.ok(Math.abs(margemPar(10, 6.4) - 36) < 1e-9);
});
