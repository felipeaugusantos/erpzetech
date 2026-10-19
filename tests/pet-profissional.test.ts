import assert from "node:assert/strict";
import test from "node:test";

import { crmvValido, normalizarCrmv, passoDoProfissional, somarDiasISO } from "../src/lib/pet.ts";

test("o profissional começa e conclui; o resto é da recepção", () => {
  assert.deepEqual(passoDoProfissional("agendado"), { para: "em_atendimento", rotulo: "Começar" });
  assert.deepEqual(passoDoProfissional("confirmado"), {
    para: "em_atendimento",
    rotulo: "Começar",
  });
  assert.deepEqual(passoDoProfissional("em_atendimento"), { para: "pronto", rotulo: "Pronto" });
  for (const s of ["pronto", "retirado", "cancelado", "faltou"])
    assert.equal(passoDoProfissional(s), null);
});

test("soma de dias atravessa mês e ano", () => {
  assert.equal(somarDiasISO("2026-10-19", 1), "2026-10-20");
  assert.equal(somarDiasISO("2026-10-31", 1), "2026-11-01");
  assert.equal(somarDiasISO("2026-01-01", -1), "2025-12-31");
  assert.equal(somarDiasISO("2028-02-28", 1), "2028-02-29");
});

test("CRMV: normaliza e confere o número e a UF", () => {
  assert.equal(normalizarCrmv("sp-12.345"), "SP12345");
  assert.equal(crmvValido("12.345", "SP"), true);
  assert.equal(crmvValido("12", "SP"), false);
  assert.equal(crmvValido("12345", "XX"), false);
  assert.equal(crmvValido("", "SP"), false);
});
