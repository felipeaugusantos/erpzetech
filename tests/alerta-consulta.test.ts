import assert from "node:assert/strict";
import test from "node:test";
import { consultaProxima } from "../src/lib/proxima-consulta.ts";

const agora = Date.parse("2026-11-16T13:46:00Z");
test("alerta começa exatamente 24 horas antes da consulta", () => {
  assert.equal(consultaProxima("2026-11-17T13:46:00Z", "agendado", agora), true);
  assert.equal(consultaProxima("2026-11-17T13:46:01Z", "agendado", agora), false);
});
test("consulta confirmada também recebe alerta", () => {
  assert.equal(consultaProxima("2026-11-16T16:00:00Z", "confirmado", agora), true);
});
test("alerta termina ao chegar o horário", () => {
  assert.equal(consultaProxima("2026-11-16T13:46:00Z", "agendado", agora), false);
  assert.equal(consultaProxima("2026-11-16T12:46:00Z", "agendado", agora), false);
});
test("canceladas, faltas e consultas já iniciadas não recebem alerta", () => {
  for (const situacao of ["cancelado", "faltou", "em_atendimento", "pronto", "retirado"])
    assert.equal(consultaProxima("2026-11-16T16:00:00Z", situacao, agora), false);
  assert.equal(consultaProxima("inválido", "agendado", agora), false);
});