import assert from "node:assert/strict";
import { test } from "node:test";
import { evolucaoDosLaudos, historicoParaImpressao } from "../src/lib/laudos-pet.ts";
import type { ExameClinico } from "../src/lib/exames.ts";

function exame(id: string, data: string, valor: number, situacao = "fechado", unidade = "U/L") {
  return { id, nome: "Bioquímica", data_coleta: data, situacao, resultados: [{ nome: "ALT (TGP)", unidade, forma: "numero", valor_num: valor, casas: 0, faixa_min: 10, faixa_max: 80 }] } as ExameClinico;
}
test("histórico impresso inclui importados em rascunho e mantém datas, valores e cancelamentos identificáveis", () => {
  const h = historicoParaImpressao([exame("a", "2026-07-01", 30.5), exame("b", "2026-08-03", 26.9, "aberto"), exame("c", "2026-06-01", 12, "cancelado")]);
  assert.deepEqual(h.map(e => [e.id, e.data_coleta, e.situacao, e.resultados[0]?.valor_num]), [["b", "2026-08-03", "aberto", 26.9], ["a", "2026-07-01", "fechado", 30.5], ["c", "2026-06-01", "cancelado", 12]]);
});
test("ordena anteriores e mantém 26,9 sem arredondamento", () => {
  const grupos = evolucaoDosLaudos([exame("atual", "2026-08-03", 26.9), exame("anterior", "2026-07-01", 30.5)]);
  assert.deepEqual(grupos[0]?.pontos.map(p => p.valor), [30.5, 26.9]);
});
test("não mistura unidades nem inclui rascunhos e cancelados na evolução", () => {
  const grupos = evolucaoDosLaudos([exame("a", "2026-08-03", 26.9), exame("b", "2026-08-03", 2, "fechado", "mg/dL"), exame("c", "2026-08-03", 99, "aberto"), exame("d", "2026-08-03", 77, "cancelado")]);
  assert.equal(grupos.length, 2);
  assert.deepEqual(grupos.flatMap(g => g.pontos.map(p => p.exame_id)).sort(), ["a", "b"]);
});