import assert from "node:assert/strict";
import { test } from "node:test";

import { montarGrade, proximaEtapa, totalGrade } from "../src/lib/personalizacao.ts";

test("produção não começa sem a arte aprovada", () => {
  assert.equal(proximaEtapa("aguardando_arte", "aguardando"), null);
  assert.equal(proximaEtapa("aguardando_arte", "reprovada"), null);
  assert.equal(proximaEtapa("aguardando_arte", "aprovada"), "impressao");
});

test("etapas seguem impressão → prensa → pronto → entregue", () => {
  assert.equal(proximaEtapa("impressao", "aprovada"), "prensa");
  assert.equal(proximaEtapa("prensa", "aprovada"), "pronto");
  assert.equal(proximaEtapa("pronto", "aprovada"), "entregue");
  assert.equal(proximaEtapa("entregue", "aprovada"), null);
});

test("grade ignora tamanhos vazios e soma os pares", () => {
  const g = montarGrade("Branco", { "35/36": "10", "37/38": "", "39/40": "0", "41/42": "41" });
  assert.equal(g.length, 2);
  assert.equal(totalGrade(g), 51);
});
