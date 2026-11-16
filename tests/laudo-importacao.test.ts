import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparLaudoImportacao, modelosPendentes } from "../src/lib/laudo-importacao.ts";
import { lerLaudoTexto, type LaudoPdf } from "../src/lib/laudo-exame-pdf.ts";
const laudo: LaudoPdf = {
  paciente: "LEO",
  especie: "gato",
  coleta: "2026-08-03",
  avisos: [],
  itens: [
    { nome: "ALT (TGP)", valor: 26.9, unidade: "U/L", minimo: null, maximo: null },
    { nome: "Leucócitos totais", valor: 6600, unidade: null, minimo: 5500, maximo: 19500 },
    { nome: "Lipase", valor: 12.3456, unidade: "U/L", minimo: null, maximo: null },
  ],
};
test("todos os resultados reconhecidos entram na conferência, incluindo modelos ausentes", () => {
  const g = agruparLaudoImportacao(laudo, []);
  assert.deepEqual(
    g.map((x) => x.nome),
    ["Bioquímica", "Hemograma", "Lipase"],
  );
  assert.equal(g.flatMap((x) => x.itens).length, 3);
  assert.equal(g[0]?.itens[0]?.valor, 26.9);
  assert.equal(g[2]?.itens[0]?.valor, 12.3456);
});
test("modelo existente é reutilizado, não duplicado", () => {
  const g = agruparLaudoImportacao(laudo, [
    { id: "bio", nome: "Bioquímica", tipo: "bioquimica", ativo: true, campos: [] },
  ]);
  assert.equal(g[0]?.modelo_id, "bio");
});
test("Proteínas totais com dois modelos mantém resultado e exige escolha explícita", () => {
  const resultado = { nome: "Proteínas totais", valor: 10, unidade: "g/dL", minimo: null, maximo: null };
  const grupos = agruparLaudoImportacao({ ...laudo, itens: [resultado] }, [
    { id: "a", nome: "Proteínas séricas", tipo: "bioquimica", ativo: true, campos: [{ nome: "Proteínas totais", unidade: "g/dL", forma: "numero", ativo: true }] },
    { id: "b", nome: "Painel de proteínas", tipo: "bioquimica", ativo: true, campos: [{ nome: "Proteínas totais", unidade: "g/dL", forma: "numero", ativo: true }] },
  ]);
  assert.deepEqual(grupos[0]?.itens, [resultado]);
  assert.equal(grupos[0]?.modelo_id, null);
  assert.deepEqual(grupos[0]?.candidatos?.map((m) => m.id), ["a", "b"]);
  assert.equal(modelosPendentes(grupos), true);
  assert.equal(modelosPendentes(grupos.map((g) => ({ ...g, modelo_id: "b" }))), false);
  assert.equal(modelosPendentes(grupos.map((g) => ({ ...g, modelo_id: "invalido" }))), true);
});
test("modelo inativo não é reativado silenciosamente", () => {
  assert.throws(
    () =>
      agruparLaudoImportacao(laudo, [
        { id: "bio", nome: "Bioquímica", tipo: "bioquimica", ativo: false, campos: [] },
      ]),
    /inativo/,
  );
});
test("reconhece exame numérico fora do catálogo fixo", () => {
  const l = lerLaudoTexto(
    "Paciente | Idade | Sexo\nLEO | 7 | M\nResponsável | Raça | Data coleta\nTutor | Felino | 03/08/2026\nLIPASE | Resultado | Referência\n12,3456 U/L | 1 a 30 U/L",
  );
  assert.equal(l.itens[0]?.nome, "LIPASE");
  assert.equal(l.itens[0]?.valor, 12.3456);
});
