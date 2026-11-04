import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MODELOS_INICIAIS,
  itensDoModeloReceita,
  modelosReceitaDaResposta,
  textoReceitaWhatsApp,
  type DocumentoClinico,
  dataPorExtenso,
  faltaParaEmitir,
  marcadoresPendentes,
  montarTextoDocumento,
  numeroDoDocumento,
} from "../src/lib/documentos-clinica.ts";

test("data por extenso e número do documento", () => {
  assert.equal(dataPorExtenso("2026-10-21"), "21 de outubro de 2026");
  assert.equal(dataPorExtenso("2026-03-05T14:00:00-03:00"), "5 de março de 2026");
  assert.equal(numeroDoDocumento({ numero: 7, ano: 2026 }), "0007/2026");
});

test("modelo preenche tutor, pet, veterinário e clínica", () => {
  const atestado = MODELOS_INICIAIS.find((m) => m.titulo === "Atestado de comparecimento");
  if (!atestado) return assert.fail("modelo inicial não encontrado");
  const t = montarTextoDocumento(atestado.corpo, {
    tutor: "Ana Souza",
    pet: "Thor",
    especie: "cão",
    clinica: "Clínica Vida",
    data: "21 de outubro de 2026",
  });
  assert.match(t, /Ana Souza compareceu a Clínica Vida em 21 de outubro de 2026/);
  assert.equal(marcadoresPendentes(t).length, 0);
});

test("campo sem valor continua marcado para o veterinário conferir", () => {
  const t = montarTextoDocumento("Pet {pet}, raça {raca}, vet {veterinario}", {
    pet: "Thor",
    raca: null,
    veterinario: "Dra. Lia",
  });
  assert.equal(t, "Pet Thor, raça {raca}, vet Dra. Lia");
  assert.deepEqual(marcadoresPendentes(t), ["{raca}"]);
});

test("todo modelo inicial usa só marcadores conhecidos", () => {
  for (const m of MODELOS_INICIAIS) {
    const t = montarTextoDocumento(m.corpo, {
      tutor: "a",
      pet: "b",
      especie: "c",
      raca: "d",
      data: "e",
      veterinario: "f",
      crmv: "g",
      clinica: "h",
    });
    assert.deepEqual(marcadoresPendentes(t), [], m.titulo);
  }
});

test("o que falta para emitir", () => {
  const base = { titulo: "Receita", corpo: "", receita: [], exames: [] };
  assert.deepEqual(faltaParaEmitir("receita", base), ["pelo menos um medicamento"]);
  assert.deepEqual(
    faltaParaEmitir("receita", {
      ...base,
      receita: [{ medicamento: "Amoxicilina", posologia: "" }],
    }),
    ["a posologia de Amoxicilina"],
  );
  assert.deepEqual(
    faltaParaEmitir("receita", {
      ...base,
      receita: [{ medicamento: "Amoxicilina", posologia: "1 comprimido a cada 12 horas" }],
    }),
    [],
  );
  assert.deepEqual(faltaParaEmitir("atestado", base), ["o texto do documento"]);
  assert.deepEqual(faltaParaEmitir("solicitacao_exame", base), ["pelo menos um exame"]);
  assert.deepEqual(
    faltaParaEmitir("solicitacao_exame", { ...base, exames: [{ exame: "Hemograma" }] }),
    [],
  );
  assert.deepEqual(faltaParaEmitir("termo", { ...base, titulo: "Te" }), [
    "o título",
    "o texto do documento",
  ]);
});

test("há modelos de atestado de vacinação e de trânsito", () => {
  const titulos = MODELOS_INICIAIS.filter((m) => m.tipo === "atestado").map((m) => m.titulo);
  assert.ok(titulos.includes("Atestado de vacinação"));
  assert.ok(titulos.includes("Atestado de saúde para trânsito"));
});

test("modelo de receita: ignora item sem medicamento ou posologia e limpa campos vazios", () => {
  const itens = itensDoModeloReceita([
    { medicamento: " Dipirona ", posologia: " 1 ml a cada 8h ", via: "", duracao: "3 dias" },
    { medicamento: "Sem posologia", posologia: "" },
    { posologia: "Sem medicamento" },
    "lixo",
    null,
  ]);
  assert.deepEqual(itens, [
    { medicamento: "Dipirona", posologia: "1 ml a cada 8h", duracao: "3 dias" },
  ]);
  assert.deepEqual(itensDoModeloReceita("não é lista"), []);
});

test("modelos da resposta do banco: só entradas com id e título", () => {
  const modelos = modelosReceitaDaResposta([
    {
      id: "m1",
      titulo: "Pós-cirúrgico",
      itens: [{ medicamento: "Melox", posologia: "1 cp/dia" }],
      orientacoes: "Repouso",
    },
    { titulo: "sem id" },
    null,
  ]);
  assert.equal(modelos.length, 1);
  assert.equal(modelos[0].titulo, "Pós-cirúrgico");
  assert.equal(modelos[0].orientacoes, "Repouso");
  assert.equal(modelos[0].itens[0].medicamento, "Melox");
});

test("texto da receita para o WhatsApp traz itens, orientações e veterinário", () => {
  const d = {
    tipo: "receita",
    numero: 3,
    ano: 2026,
    pet: { nome: "Thor" },
    tutor: { nome: "Ana" },
    veterinario: { nome: "Dra. Maria", crmv: "12345", crmv_uf: "SP" },
    clinica: { nome: "Clínica Bicho Bom" },
    itens: [
      { medicamento: "Dipirona", posologia: "1 ml a cada 8h", quantidade: "1 frasco", via: "oral" },
      { medicamento: "Melox", posologia: "1 cp ao dia" },
    ],
    corpo: "Manter em repouso.",
  } as unknown as DocumentoClinico;
  const t = textoReceitaWhatsApp(d);
  assert.ok(t.includes("0003/2026"));
  assert.ok(t.includes("Thor"));
  assert.ok(t.includes("1. Dipirona — 1 frasco"));
  assert.ok(t.includes("1 ml a cada 8h"));
  assert.ok(t.includes("Via oral"));
  assert.ok(t.includes("2. Melox"));
  assert.ok(t.includes("Orientações: Manter em repouso."));
  assert.ok(t.includes("Dra. Maria · CRMV 12345/SP · Clínica Bicho Bom"));
  assert.ok(t.includes("sem assinatura digital"));
});
