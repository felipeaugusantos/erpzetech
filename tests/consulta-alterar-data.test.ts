import assert from "node:assert/strict";
import test from "node:test";
import { erroAlteracaoDataConsulta } from "../src/lib/clinica.ts";

test("permite data passada em consulta finalizada com motivo", () => {
  assert.equal(erroAlteracaoDataConsulta("2026-11-10", "2021-01-01", true, "Data informada incorretamente", "2026-11-16"), null);
});
test("correção de consulta fechada exige motivo", () => {
  assert.equal(erroAlteracaoDataConsulta("2026-11-10", null, true, " ", "2026-11-16"), "Informe o motivo da correção");
});
test("consulta aberta pode alterar data sem motivo", () => {
  assert.equal(erroAlteracaoDataConsulta("2026-11-10", null, false, "", "2026-11-16"), null);
});
test("não permite data futura", () => {
  assert.equal(erroAlteracaoDataConsulta("2026-11-17", null, false, "", "2026-11-16"), "A data do atendimento não pode ser no futuro");
});
test("não permite data anterior ao nascimento", () => {
  assert.equal(erroAlteracaoDataConsulta("2026-11-09", "2026-11-10", false, "", "2026-11-16"), "O atendimento não pode ser anterior ao nascimento do paciente");
});