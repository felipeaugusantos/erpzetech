import assert from "node:assert/strict";
import { test } from "node:test";

import { montarGrade, proximaEtapa, totalGrade } from "../src/lib/personalizacao.ts";

test("produção não começa sem a arte aprovada", () => {
  assert.equal(proximaEtapa("aguardando_arte", "aguardando"), null);
  assert.equal(proximaEtapa("aguardando_arte", "reprovada"), null);
  assert.equal(proximaEtapa("aguardando_arte", "aprovada"), "impressao");
});

test("etapas seguem impressão → prensa → montagem → pronto → entregue", () => {
  assert.equal(proximaEtapa("impressao", "aprovada"), "prensa");
  assert.equal(proximaEtapa("prensa", "aprovada"), "montagem");
  assert.equal(proximaEtapa("montagem", "aprovada"), "pronto");
  assert.equal(proximaEtapa("pronto", "aprovada"), "entregue");
  assert.equal(proximaEtapa("entregue", "aprovada"), null);
});

test("grade ignora tamanhos vazios e soma os pares", () => {
  const g = montarGrade("Branco", { "35/36": "10", "37/38": "", "39/40": "0", "41/42": "41" });
  assert.equal(g.length, 2);
  assert.equal(totalGrade(g), 51);
});

test("status das etapas da produção pela etapa atual", async () => {
  const { statusEtapa } = await import("../src/lib/personalizacao.ts");
  assert.equal(statusEtapa("prensa", "impressao"), "concluida");
  assert.equal(statusEtapa("prensa", "prensa"), "andamento");
  assert.equal(statusEtapa("prensa", "montagem"), "aguardando");
});
