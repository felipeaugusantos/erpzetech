import assert from "node:assert/strict";
import test from "node:test";
import { dadosDoseAplicacao } from "../src/lib/vacina-dose.ts";
import { aplicacaoVazia, externaVazia, operacaoDeAplicar, operacaoDeExterna, trocarLote } from "../src/lib/vacina-offline.ts";

for (const numero of [1, 2, 3]) {
  test(`seleção da ${numero}ª dose registra exatamente o número informado`, () => {
    assert.deepEqual(dadosDoseAplicacao(String(numero)), { dose_tipo: "serie", dose_numero: numero });
  });
}
test("reforço não é registrado como dose da série", () => {
  assert.deepEqual(dadosDoseAplicacao("reforco"), { dose_tipo: "reforco", dose_numero: 1 });
});
test("automática não sobrescreve a sequência existente", () => {
  assert.deepEqual(dadosDoseAplicacao("auto"), {});
});
test("dose inválida é recusada", () => {
  assert.throws(() => dadosDoseAplicacao("4"));
  assert.throws(() => dadosDoseAplicacao(""));
});

const paciente = { petId: "pet", petNome: "Paciente", tutorNome: "Tutor", especie: "cao" };
for (const dose of ["1", "2", "3", "reforco"]) {
  test(`fila offline preserva ${dose} na aplicação e na externa`, () => {
    const aplicacao = operacaoDeAplicar(paciente, { tipo: "agenda", agendamentoId: "ag" }, { nome: "V10" }, { ...aplicacaoVazia("2026-11-26"), dose });
    const externa = operacaoDeExterna(paciente, { nome: "V10" }, { ...externaVazia("2026-11-26"), dose });
    for (const op of [aplicacao, externa]) {
      const payload = op.payload as Record<string, unknown>;
      const esperado = dadosDoseAplicacao(dose);
      assert.equal(payload['dose_tipo'], esperado.dose_tipo);
      assert.equal(payload['dose_numero'], esperado.dose_numero);
    }
    const recusada = { ...aplicacao, estado: "recusada" as const };
    const corrigida = trocarLote(recusada, "novo-lote");
    assert.equal(corrigida.id, aplicacao.id);
    assert.equal((corrigida.payload as Record<string, unknown>)['dose_numero'], dadosDoseAplicacao(dose).dose_numero);
  });
}