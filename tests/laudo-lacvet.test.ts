import assert from "node:assert/strict";
import { test } from "node:test";
import { lerLaudoTexto, conferirPacienteLaudo } from "../src/lib/laudo-exame-pdf.ts";

// PDF text fragments in their actual column order; personal identifiers anonymized.
const cabecalho = "Código | 0000000 | Data de Atendimento: | 12/11/2026\nAnimal......: | PACIENTE TESTE | Espécie......: | CANINA\n";
const texto = cabecalho + [
  "ERITROGRAMA | VALORES DE REFERÊNCIA CÃES 1 A 8 ANOS",
  "3 | 3",
  "Hemácias................: | 4,44 | milh/mm | 5,5 a 8,5 milhões/mm",
  "Hemoglobina.............: | 9,6 | g/dL | 12 a 18 g/dL",
  "Hematócrito.............: | 30,4 | % | 37 a 55 %",
  "V.C.M...................: | 68 | fl | 60 a 77 fl",
  "H.C.M...................: | 22 | pg | 19,5 a | 24,5 pg",
  "C.H.C.M.................: | 32 | g/dL | 30 a 36 g/dL",
  "Proteinas | totais........: | 10,0 | g/dL | 5,5 a 8,0 g/dL",
  "LEUCOGRAMA",
  "3",
  "Leucócitos | Totais........: | 2.900 | 6.000 a 18.000/mm",
  "3",
  "% | /mm",
  "Segmentados..............: | 94 | 2.726 | 3.600 a 13.860/mm",
  "Linfócitos | Típicos.......: | 3 | 87 | 780 a 5.400/mm",
  "Linfócitos | Atípicos......: | 0 | 0 | 0/mm",
  "PLAQUETAS | ...............: | 26.000 | /mm | 200.000 a 400.000 /mm",
  cabecalho,
  "ALBUMINA",
  "Valor de referência",
  "Resultado................: | 2,89 | g/dL | 2,6 - 4,0 g/dL",
  "ALT (TGP)",
  "Valor de referência",
  "Resultado................: | 130 | U.I./L | 10 - 88 U.I./L",
  "CREATININA",
  "Valor de referência",
  "Resultado................: | 1,23 | mg/dL | 0,50 - 1,50 | mg/dL",
  "FOSFATASE ALCALINA",
  "Resultado................: | 205 | U.I./L | 20-150 UI/L",
  cabecalho,
  "UREIA",
  "Valor de referência",
  "Resultado................: | 85 | mg/dL | 15 - 65 mg/dL",
].join("\n");

test("identifica o mesmo animal e espécie e usa Data de Atendimento como data do exame", () => {
  const l = lerLaudoTexto(texto);
  assert.equal(l.paciente, "PACIENTE TESTE");
  assert.equal(l.especie, "cao");
  assert.equal(l.coleta, "2026-11-12");
  assert.equal(conferirPacienteLaudo(l, { nome: "Outro", especie: "cao" }), false);
});
test("usa Data de Coleta quando o PDF também informa Data de Atendimento", () => {
  assert.equal(lerLaudoTexto(texto + "\nData de Coleta: | 11/11/2026").coleta, "2026-11-11");
});
test("aceita Data de Coleta no lugar de Data de Atendimento", () => {
  assert.equal(lerLaudoTexto(texto.replaceAll("Data de Atendimento", "Data de Coleta")).coleta, "2026-11-12");
});
test("datas de atendimento divergentes exigem conferência manual", () => {
  assert.equal(lerLaudoTexto(texto + "\nData de Atendimento: | 13/11/2026").coleta, "");
});
test("preserva decimais de hemograma e todos os cinco exames bioquímicos", () => {
  const l = lerLaudoTexto(texto);
  for (const [nome, valor] of [["Hemácias", 4.44], ["Hematócrito", 30.4], ["Albumina", 2.89], ["ALT (TGP)", 130], ["Creatinina", 1.23], ["Fosfatase alcalina", 205], ["Ureia", 85]] as const)
    assert.equal(l.itens.find((i) => i.nome === nome)?.valor, valor);
});
test("preserva contagens absolutas e unidades explícitas sem copiar referências relativas", () => {
  const l = lerLaudoTexto(texto);
  assert.deepEqual(l.itens.find((i) => i.nome === "Segmentados (abs.)"), { nome: "Segmentados (abs.)", valor: 2726, unidade: "células/mm³", minimo: 3600, maximo: 13860 });
  assert.equal(l.itens.find((i) => i.nome === "Plaquetas")?.valor, 26000);
  assert.equal(l.itens.find((i) => i.nome === "Linfócitos Atípicos (abs.)")?.maximo, 0);
});
for (const [nome, minimo, maximo] of [
  ["Hemácias", 5.5, 8.5], ["Hemoglobina", 12, 18], ["Hematócrito", 37, 55],
  ["VCM", 60, 77], ["HCM", 19.5, 24.5], ["CHCM", 30, 36],
  ["Proteínas totais", 5.5, 8], ["Plaquetas", 200000, 400000],
  ["Albumina", 2.6, 4], ["ALT (TGP)", 10, 88], ["Creatinina", 0.5, 1.5],
  ["Fosfatase alcalina", 20, 150], ["Ureia", 15, 65],
] as const) {
  test(`importa a faixa explícita de ${nome} do PDF LACVET`, () => {
    const item = lerLaudoTexto(texto).itens.find((i) => i.nome === nome);
    assert.equal(item?.minimo, minimo);
    assert.equal(item?.maximo, maximo);
  });
}
test("continua bloqueando animais, espécies ou resultados divergentes em páginas combinadas", () => {
  assert.throws(() => lerLaudoTexto(texto + cabecalho.replace("PACIENTE TESTE", "OUTRO")), /único paciente/);
  assert.throws(() => lerLaudoTexto(texto + cabecalho.replace("CANINA", "FELINA")), /único paciente/);
  assert.throws(() => lerLaudoTexto(texto + "\nUREIA\nResultado................: | 86 | mg/dL | 15 - 65 mg/dL"), /repetidos/);
});
test("não confunde data de atendimento com emissão; lê emissão somente quando explícita", () => {
  assert.equal(lerLaudoTexto(texto).emissao, undefined);
  assert.equal(lerLaudoTexto(texto + "\nData de emissão: | 13/11/2026").emissao, "2026-11-13");
  assert.equal(lerLaudoTexto(texto + "\nData de emissão: | 13/11/2026\nData de emissão: | 14/11/2026").emissao, undefined);
});
import { agruparLaudoImportacao } from "../src/lib/laudo-importacao.ts";
test("seção do PDF escolhe o modelo de campo repetido", () => {
  const campo = { nome: "Proteínas totais", unidade: "g/dL", forma: "numero", ativo: true };
  const modelos = [
    { id: "h", nome: "Hemograma", tipo: "hemograma", ativo: true, campos: [campo] },
    { id: "b", nome: "Bioquímica sanguínea", tipo: "bioquimica", ativo: true, campos: [campo] },
  ];
  const item = { nome: "Proteínas totais", valor: 10, unidade: "g/dL", minimo: 5.5, maximo: 8 };
  const laudo = { itens: [{ ...item, secao: "bioquimica" as const }] } as never;
  assert.equal(agruparLaudoImportacao(laudo, modelos)[0]?.modelo_id, "b");
  const semSecao = { itens: [item] } as never;
  assert.equal(agruparLaudoImportacao(semSecao, modelos)[0]?.modelo_id, null);
});
import { laboratorioDoLaudo } from "../src/lib/laudo-exame-pdf.ts";
test("identifica o laboratório pelo texto do PDF", () => {
  assert.equal(laboratorioDoLaudo("e-mail: lacvetribeirao@outook.com"), "LACVET");
  assert.equal(laboratorioDoLaudo("A HopeLab oferece assessoria"), "HopeLab");
  assert.equal(laboratorioDoLaudo("Paciente BIBI"), "");
});
import { unidadesEquivalentes } from "../src/lib/laudo-importacao.ts";
test("CHCM em g/dL é aceita no modelo em %, plaquetas em escalas diferentes não", () => {
  assert.equal(unidadesEquivalentes("CHCM", "g/dL", "%"), true);
  assert.equal(unidadesEquivalentes("Hemácias", "milhões/mm³", "milhões/mm3"), true);
  assert.equal(unidadesEquivalentes("Plaquetas", "células/mm³", "mil/mm³"), false);
  assert.equal(unidadesEquivalentes("Hemoglobina", "g/dL", "%"), false);
});
test("grupo usa a unidade do modelo quando é a mesma medida", () => {
  const modelos = [{ id: "h", nome: "Hemograma", tipo: "hemograma", ativo: true, campos: [{ nome: "CHCM", unidade: "%", forma: "numero", ativo: true }] }];
  const laudo = { itens: [{ nome: "CHCM", valor: 32, unidade: "g/dL", minimo: 30, maximo: 36 }] } as never;
  assert.equal(agruparLaudoImportacao(laudo, modelos)[0]?.itens[0]?.unidade, "%");
});
