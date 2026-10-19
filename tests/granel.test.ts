import assert from "node:assert/strict";
import test from "node:test";

import { custoDoKg, kgDosSacos, lerFatorGranel, margemDoKg } from "../src/lib/granel.ts";

test("lê o fator com vírgula ou ponto e recusa vazio, zero e negativo", () => {
  assert.equal(lerFatorGranel("15"), 15);
  assert.equal(lerFatorGranel(" 10,5 "), 10.5);
  assert.equal(lerFatorGranel("7.25"), 7.25);
  assert.equal(lerFatorGranel(""), null);
  assert.equal(lerFatorGranel("0"), null);
  assert.equal(lerFatorGranel("-3"), null);
  assert.equal(lerFatorGranel("abc"), null);
});

test("kg dos sacos abertos", () => {
  assert.equal(kgDosSacos(1, 15), 15);
  assert.equal(kgDosSacos(3, 10.5), 31.5);
  assert.equal(kgDosSacos(2, 0.333), 0.666);
});

test("custo do kg é o custo do saco dividido pelos kg", () => {
  assert.equal(custoDoKg(90, 15), 6);
  assert.equal(custoDoKg(100, 15), 6.6667);
  assert.equal(custoDoKg(90, 0), 0);
});

test("margem do kg contra o custo proporcional", () => {
  assert.equal(margemDoKg(12, 6), 50);
  assert.equal(margemDoKg(12, 0), null);
  assert.equal(margemDoKg(0, 6), null);
});
