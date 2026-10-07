import assert from "node:assert/strict";
import { test } from "node:test";

import { interpretarBusca } from "../src/lib/busca-pdv.ts";

test("texto sem multiplicador devolve só o termo", () => {
  assert.deepEqual(interpretarBusca("  cimento cp2 "), { quantidade: null, termo: "cimento cp2" });
  assert.deepEqual(interpretarBusca("7891234567890"), {
    quantidade: null,
    termo: "7891234567890",
  });
});

test("3*código e 3*nome definem a quantidade", () => {
  assert.deepEqual(interpretarBusca("3*7891234"), { quantidade: 3, termo: "7891234" });
  assert.deepEqual(interpretarBusca("3*cimento"), { quantidade: 3, termo: "cimento" });
  assert.deepEqual(interpretarBusca("3 * cimento cp2"), { quantidade: 3, termo: "cimento cp2" });
  assert.deepEqual(interpretarBusca("3×cimento"), { quantidade: 3, termo: "cimento" });
});

test("quantidade decimal com vírgula ou ponto", () => {
  assert.equal(interpretarBusca("2,5*areia").quantidade, 2.5);
  assert.equal(interpretarBusca("0.125*prego").quantidade, 0.125);
});

test("3* sem produto ainda não tem termo, para a lista não sumir", () => {
  assert.deepEqual(interpretarBusca("3*"), { quantidade: 3, termo: "" });
});

test("o x de medidas não é multiplicador", () => {
  assert.deepEqual(interpretarBusca("2x4 madeira"), { quantidade: null, termo: "2x4 madeira" });
  assert.deepEqual(interpretarBusca("madeira 2*4"), { quantidade: null, termo: "madeira 2*4" });
});
