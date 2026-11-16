import assert from "node:assert/strict";
import { test } from "node:test";

import { linhasDaCorrecao } from "../src/lib/clinica.ts";

test("correção lista só os campos corrigidos, na ordem da ficha, com antes e depois", () => {
  const linhas = linhasDaCorrecao({
    anterior: { diagnostico: "Gastrite", peso_kg: "12.500" },
    correcao: { diagnostico: "Gastrite aguda", peso_kg: "13.250" },
  });
  assert.deepEqual(linhas, [
    { rotulo: "Peso (kg)", antes: "12.500", depois: "13.250" },
    { rotulo: "Diagnóstico", antes: "Gastrite", depois: "Gastrite aguda" },
  ]);
});

test("campo que passou a vazio aparece com depois nulo; adendo comum não tem linhas", () => {
  assert.deepEqual(
    linhasDaCorrecao({ anterior: { observacoes: "x" }, correcao: { observacoes: null } }),
    [{ rotulo: "Observações", antes: "x", depois: null }],
  );
  assert.deepEqual(linhasDaCorrecao({}), []);
});
