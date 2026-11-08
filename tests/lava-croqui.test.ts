import assert from "node:assert/strict";
import { test } from "node:test";

import { contagemPorLocal, locaisForaDoCroqui, zonasDoCroqui } from "../src/lib/lava-croqui.ts";
import { locaisDeAvaria } from "../src/lib/lava-rapido.ts";

test("toda parte do croqui é um local sugerido do mesmo veículo", () => {
  for (const tipo of ["carro", "caminhonete", "moto"]) {
    const sugeridos = new Set(locaisDeAvaria(tipo));
    for (const z of zonasDoCroqui(tipo)) assert.ok(sugeridos.has(z), `${tipo}: ${z}`);
  }
});

test("o que o desenho não cobre vira botão, e nada se perde", () => {
  for (const tipo of ["carro", "caminhonete", "moto"]) {
    const todos = new Set([...zonasDoCroqui(tipo), ...locaisForaDoCroqui(tipo)]);
    assert.deepEqual(todos, new Set(locaisDeAvaria(tipo)));
  }
  assert.ok(locaisForaDoCroqui("carro").includes("Interior"));
  assert.deepEqual(locaisForaDoCroqui("moto"), []);
});

test("aeronaves seguem só com o campo de texto", () => {
  for (const tipo of ["aviao", "helicoptero"]) assert.deepEqual(zonasDoCroqui(tipo), []);
});

test("conta avarias por local ignorando caixa e espaços", () => {
  const m = contagemPorLocal([{ lugar: "Capô" }, { lugar: " capô " }, { lugar: "Rodas" }]);
  assert.equal(m.get("capô"), 2);
  assert.equal(m.get("rodas"), 1);
});
