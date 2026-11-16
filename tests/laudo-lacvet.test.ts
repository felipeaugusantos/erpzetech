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

test("identifica o mesmo animal e espécie nos três cabeçalhos sem inferir coleta", () => {
  const l = lerLaudoTexto(texto);
  assert.equal(l.paciente, "PACIENTE TESTE");
  assert.equal(l.especie, "cao");
  assert.equal(l.coleta, "");
  assert.equal(conferirPacienteLaudo(l, { nome: "Outro", especie: "cao" }), false);
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
test("continua bloqueando animais, espécies ou resultados divergentes em páginas combinadas", () => {
  assert.throws(() => lerLaudoTexto(texto + cabecalho.replace("PACIENTE TESTE", "OUTRO")), /único paciente/);
  assert.throws(() => lerLaudoTexto(texto + cabecalho.replace("CANINA", "FELINA")), /único paciente/);
  assert.throws(() => lerLaudoTexto(texto + "\nUREIA\nResultado................: | 86 | mg/dL | 15 - 65 mg/dL"), /repetidos/);
});