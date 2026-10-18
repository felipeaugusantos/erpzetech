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

import { custoSacolinha, SACOLINHA_PADRAO } from "../src/lib/personalizacao.ts";
test("sacolinha: voil 13,50 rende 16,5, costura 1,00, fita 16,90/100 e 2 folhas de 0,50", () => {
  const c = custoSacolinha({ ...SACOLINHA_PADRAO, folha: 0.5 });
  assert.equal(c.tecido.toFixed(3), "0.818");
  assert.equal(c.fita.toFixed(3), "0.169");
  assert.equal(c.folhas, 1);
  assert.equal(c.total.toFixed(3), "2.987");
});
