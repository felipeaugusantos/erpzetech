import assert from "node:assert/strict";
import { test } from "node:test";

import { labelRamo, ramos, usaGradeTamanho } from "../src/lib/ramo.ts";

test("o ramo restaurante existe e tem rótulo próprio", () => {
  assert.ok(ramos.some((r) => r.value === "restaurante"));
  assert.equal(labelRamo("restaurante"), "Restaurante e lanchonete");
});

test("ramo desconhecido ou vazio cai em materiais de construção", () => {
  assert.equal(labelRamo("xyz"), "Material de Construção");
  assert.equal(labelRamo(null), "Material de Construção");
});

test("grade de tamanhos só vale para roupas e calçados", () => {
  assert.equal(usaGradeTamanho("roupas"), true);
  assert.equal(usaGradeTamanho("restaurante"), false);
  assert.equal(usaGradeTamanho(undefined), false);
});
