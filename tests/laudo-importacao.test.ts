import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparLaudoImportacao } from "../src/lib/laudo-importacao.ts";
import { lerLaudoTexto, type LaudoPdf } from "../src/lib/laudo-exame-pdf.ts";
const laudo: LaudoPdf = { paciente: "LEO", especie: "gato", coleta: "2026-08-03", avisos: [], itens: [
  { nome: "ALT (TGP)", valor: 26.9, unidade: "U/L", minimo: null, maximo: null },
  { nome: "Leucócitos totais", valor: 6600, unidade: null, minimo: 5500, maximo: 19500 },
  { nome: "Lipase", valor: 12.3456, unidade: "U/L", minimo: null, maximo: null },
] };
test("todos os resultados reconhecidos entram na conferência, incluindo modelos ausentes", () => {
  const g = agruparLaudoImportacao(laudo, []);
  assert.deepEqual(g.map(x => x.nome), ["Bioquímica", "Hemograma", "Lipase"]);
  assert.equal(g.flatMap(x => x.itens).length, 3);
  assert.equal(g[0]?.itens[0]?.valor, 26.9);
  assert.equal(g[2]?.itens[0]?.valor, 12.3456);
});
test("modelo existente é reutilizado, não duplicado", () => {
  const g = agruparLaudoImportacao(laudo, [{ id: "bio", nome: "Bioquímica", tipo: "bioquimica", ativo: true, campos: [] }]);
  assert.equal(g[0]?.modelo_id, "bio");
});
test("modelo inativo não é reativado silenciosamente", () => {
  assert.throws(() => agruparLaudoImportacao(laudo, [{ id: "bio", nome: "Bioquímica", tipo: "bioquimica", ativo: false, campos: [] }]), /inativo/);
});
test("reconhece exame numérico fora do catálogo fixo", () => {
  const l = lerLaudoTexto("Paciente | Idade | Sexo\nLEO | 7 | M\nResponsável | Raça | Data coleta\nTutor | Felino | 03/08/2026\nLIPASE | Resultado | Referência\n12,3456 U/L | 1 a 30 U/L");
  assert.equal(l.itens[0]?.nome, "LIPASE");
  assert.equal(l.itens[0]?.valor, 12.3456);
});