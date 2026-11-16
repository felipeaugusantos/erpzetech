import assert from "node:assert/strict";
import test from "node:test";
import { inicioProximaConsulta, erroProximaConsulta } from "../src/lib/proxima-consulta.ts";

test("próxima consulta usa o horário de Brasília", () => {
  assert.equal(inicioProximaConsulta("2026-11-17", "10:30"), "2026-11-17T13:30:00.000Z");
});
test("agendamento exige horário futuro", () => {
  const agora = new Date("2026-11-16T13:31:00Z");
  assert.equal(erroProximaConsulta("2026-11-17", "10:30", agora), null);
  assert.ok(erroProximaConsulta("2026-11-16", "10:30", agora));
  assert.ok(erroProximaConsulta("2026-11-16", "10:31", agora));
});
test("horários inválidos não geram agendamento", () => {
  assert.equal(inicioProximaConsulta("2026-11-17", "25:00"), null);
  assert.equal(inicioProximaConsulta("", "10:00"), null);
});