import assert from "node:assert/strict";
import { test } from "node:test";

// Um fuso bem diferente do de Brasília, para provar que o resultado não depende do ambiente.
process.env["TZ"] = "Asia/Tokyo";

import { FUSO_HORARIO, isoBrasilia } from "../src/lib/fuso.ts";
import { hojeISO, somaDias } from "../src/lib/financeiro.ts";
import { dateBR, dateTimeBR } from "../src/lib/format.ts";

test("o fuso do sistema é o de Brasília", () => {
  assert.equal(FUSO_HORARIO, "America/Sao_Paulo");
});

test("isoBrasilia devolve o dia de Brasília, e não o do ambiente", () => {
  // 01:30 UTC de 04/10 = 22:30 de 03/10 em Brasília (e já é 10:30 de 04/10 em Tóquio)
  assert.equal(isoBrasilia(new Date("2026-10-04T01:30:00Z")), "2026-10-03");
  // 02:59 UTC = 23:59 em Brasília; 03:00 UTC = meia-noite do dia seguinte
  assert.equal(isoBrasilia(new Date("2026-10-04T02:59:00Z")), "2026-10-03");
  assert.equal(isoBrasilia(new Date("2026-10-04T03:00:00Z")), "2026-10-04");
});

test("hojeISO usa o relógio, no fuso de Brasília", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-04T01:30:00Z") });
  assert.equal(hojeISO(), "2026-10-03");
});

test("datas e horas são formatadas no fuso de Brasília", () => {
  assert.equal(dateBR("2026-10-03"), "03/10/2026");
  assert.equal(dateBR("2026-10-04T01:30:00Z"), "03/10/2026");
  assert.equal(dateTimeBR("2026-10-04T01:30:00Z"), "03/10/26, 22:30");
});

test("somaDias é aritmética de calendário, igual em qualquer fuso", () => {
  assert.equal(somaDias("2026-10-31", 1), "2026-11-01");
  assert.equal(somaDias("2026-03-01", -1), "2026-02-28");
  assert.equal(somaDias("2028-02-28", 1), "2028-02-29");
});
