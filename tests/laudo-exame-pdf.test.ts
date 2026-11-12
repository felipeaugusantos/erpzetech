import assert from "node:assert/strict";
import { test } from "node:test";
import { lerLaudoTexto, corresponderLaudo, conferirPacienteLaudo, type CampoLaudo } from "../src/lib/laudo-exame-pdf.ts";
const cabecalho = "Paciente | Idade | Sexo\nLEO | 7a | Macho\nResponsável | Raça | Data coleta\nBRUNA | Felino / SRD | 03/08/2026\n";
const texto = cabecalho + "LEUCOGRAMA | Relativo | Absoluto | Valor Rel. Ref. | Valor Abs. Ref.\nLEUCÓCITOS TOTAIS | 6.600 | 5.500 a 19.500\nSEGMENTADOS | 40 | 2.640 | 35 a 75 | 2.500 a 12.500\nPLAQUETOGRAMA | Resultado | Referência\nPLAQUETAS | 247.000 | 200 a 500\n";
const campo = (id: string, nome: string, unidade: string, forma = "numero", total_id: string | null = null, pct_id: string | null = null): CampoLaudo => ({ id, nome, unidade, forma, casas: 0, total_id, pct_id });

test("PDF de Leo preserva resultado 6600 e referência absoluta 5500 a 19500", () => {
  const l = lerLaudoTexto(texto);
  assert.deepEqual(l.itens[0], { nome: "Leucócitos totais", valor: 6600, unidade: null, minimo: 5500, maximo: 19500 });
  assert.equal(l.coleta, "2026-08-03");
  assert.equal(l.especie, "gato");
});
test("importa apenas a referência absoluta dos segmentados, não a relativa", () => {
  const l = lerLaudoTexto(texto);
  assert.equal(l.itens[1]?.valor, 40);
  assert.equal(l.itens[1]?.minimo, null);
  assert.equal(l.itens[2]?.valor, 2640);
  assert.equal(l.itens[2]?.minimo, 2500);
  assert.equal(l.itens[2]?.maximo, 12500);
});
test("plaquetas com escala ambígua não são convertidas nem importadas", () => {
  const l = lerLaudoTexto(texto);
  assert.equal(l.itens.some(i => i.nome === "Plaquetas"), false);
  assert.match(l.avisos.join(""), /escalas diferentes/);
});
test("bloqueia paciente ou espécie diferente e laudos de múltiplos pacientes", () => {
  const l = lerLaudoTexto(texto);
  assert.equal(conferirPacienteLaudo(l, { nome: "LEO", especie: "gato" }), true);
  assert.equal(conferirPacienteLaudo(l, { nome: "Thor", especie: "gato" }), false);
  assert.equal(conferirPacienteLaudo(l, { nome: "LEO", especie: "cao" }), false);
  assert.throws(() => lerLaudoTexto(texto + cabecalho.replace("LEO", "THOR")), /único paciente/);
});
test("não mistura unidades incompatíveis ou campos duplicados", () => {
  const l = lerLaudoTexto(texto);
  assert.equal(corresponderLaudo(l, [campo("a", "Leucócitos totais", "%")]).length, 0);
  assert.equal(corresponderLaudo(l, [campo("a", "Leucócitos totais", "células/mm³"), campo("b", "Leucócitos totais", "células/mm³")]).length, 0);
});
test("absoluto calculado precisa bater com total e percentual do laudo", () => {
  const l = lerLaudoTexto(texto);
  const campos = [campo("a", "Leucócitos totais", "células/mm³"), campo("b", "Segmentados (%)", "%"), campo("c", "Segmentados (abs.)", "células/mm³", "calculado", "a", "b")];
  assert.equal(corresponderLaudo(l, campos).length, 3);
  const divergente = lerLaudoTexto(texto.replace("2.640", "2.641"));
  assert.equal(corresponderLaudo(divergente, campos).length, 2);
});
test("bioquímica mantém decimal de creatinina e não copia referência fora do leucograma", () => {
  const l = lerLaudoTexto(cabecalho + "CREATININA\n1,3 mg/dL | 0,7 a 1,9 mg/dL");
  assert.deepEqual(l.itens[0], { nome: "Creatinina", valor: 1.3, unidade: "mg/dL", minimo: null, maximo: null });
});

for (const [nome, minimo, maximo] of [
  ["METAMIELÓCITOS", 0, 0], ["BASTONETES", 0, 300], ["SEGMENTADOS", 2500, 12500],
  ["EOSINÓFILOS", 120, 1500], ["LINFÓCITOS", 1500, 7000], ["MONÓCITOS", 0, 850], ["BASÓFILOS", 0, 190],
] as const) {
  test(`referência absoluta de ${nome}: ${minimo} a ${maximo}`, () => {
    const l = lerLaudoTexto(cabecalho + `LEUCOGRAMA | Relativo | Absoluto | Valor Rel. Ref. | Valor Abs. Ref.\n${nome} | 0 | 0 | 0 a 1 | ${minimo.toLocaleString("pt-BR")} a ${maximo.toLocaleString("pt-BR")}`);
    assert.equal(l.itens[1]?.minimo, minimo);
    assert.equal(l.itens[1]?.maximo, maximo);
  });
}