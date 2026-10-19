import assert from "node:assert/strict";
import test from "node:test";

import { passoDoProfissional, somarDiasISO } from "../src/lib/pet.ts";

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
