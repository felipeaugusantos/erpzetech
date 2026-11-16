import assert from "node:assert/strict";
import test from "node:test";
import { podeSalvarCatalogo } from "../src/lib/vacina-produto.ts";

test("vacina pode ser salva sem produto anterior ao cadastrar a dose no próprio catálogo", () => {
  assert.equal(podeSalvarCatalogo("V10 (múltipla canina)", undefined, false, true), true);
  assert.equal(podeSalvarCatalogo("", undefined, false, true), false);
});

test("usar dose existente mantém a confirmação de lote obrigatória", () => {
  const dose = { id: "v10", descricao: "V10", codigo_interno: "1", controla_estoque: true, controla_lote: false };
  assert.equal(podeSalvarCatalogo("V10", dose, false, false), false);
  assert.equal(podeSalvarCatalogo("V10", dose, true, false), true);
  assert.equal(podeSalvarCatalogo("V10", undefined, true, false), false);
});