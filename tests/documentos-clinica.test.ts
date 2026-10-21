import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MODELOS_INICIAIS,
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
