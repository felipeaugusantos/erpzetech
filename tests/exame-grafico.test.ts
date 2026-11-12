import assert from "node:assert/strict";
import { test } from "node:test";
import { pontosDoLaudo } from "../src/lib/exame-grafico.ts";
import type { PontoEvolucao } from "../src/lib/exames.ts";

const ponto = (id: string, data: string, valor: number): PontoEvolucao => ({
  exame_id: id, data_coleta: data, valor, exame: "Bioquímica", casas: 0, faixa_min: 10, faixa_max: 80,
});
test("não cria gráfico sem outro resultado e não duplica o exame atual", () => {
  const atual = ponto("atual", "2026-08-03", 26.9);
  assert.deepEqual(pontosDoLaudo([], atual), []);
  assert.deepEqual(pontosDoLaudo([atual], atual), []);
});
test("preserva 26,9 e usa apenas resultados anteriores em ordem de coleta", () => {
  const atual = ponto("atual", "2026-08-03", 26.9);
  const pontos = pontosDoLaudo([ponto("b", "2026-07-20", 30.5), atual, ponto("futuro", "2026-08-04", 40), ponto("a", "2026-07-01", 25.1)], atual);
  assert.deepEqual(pontos.map(p => p.valor), [25.1, 30.5, 26.9]);
});
test("mini gráfico limita a três anteriores sem repetir registros", () => {
  const anteriores = [1, 2, 3, 4].map(i => ponto(String(i), `2026-07-0${i}`, i));
  assert.deepEqual(pontosDoLaudo([...anteriores, ponto("4", "2026-07-04", 4)], ponto("atual", "2026-08-03", 26.9)).map(p => p.exame_id), ["2", "3", "4", "atual"]);
});