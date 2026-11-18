import { it } from "node:test";
import assert from "node:assert/strict";
import { examesDaConsulta } from "../src/lib/exames-consulta.ts";

const exame = { atendimento_id: null, data_coleta: "2026-11-12", aberto_em: "2026-11-16T22:25:53Z", situacao: "aberto" };
it("inclui laudo antigo de Bianca na única consulta de 12/11, preservando inclusão em 16/11", () => {
  assert.deepEqual(examesDaConsulta([exame], "consulta", "2026-11-12", 1), [exame]);
});
it("não atribui exame a outra data nem a consultas ambíguas", () => {
  assert.equal(examesDaConsulta([exame], "consulta", "2026-11-13", 1).length, 0);
  assert.equal(examesDaConsulta([exame], "consulta", "2026-11-12", 2).length, 0);
});
it("vínculo explícito vence a data e exames cancelados não contam", () => {
  const vinculado = { ...exame, atendimento_id: "outra" };
  assert.equal(examesDaConsulta([vinculado], "consulta", "2026-11-12", 1).length, 0);
  assert.equal(examesDaConsulta([vinculado], "outra", "2026-11-13", 2).length, 1);
  assert.equal(examesDaConsulta([{ ...exame, situacao: "cancelado" }], "consulta", "2026-11-12", 1).length, 0);
});