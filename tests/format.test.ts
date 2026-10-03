import assert from "node:assert/strict";
import { test } from "node:test";

// O servidor e outros aparelhos podem estar em outro fuso: as datas saem sempre no de Brasília.
process.env["TZ"] = "UTC";

import { brl, dateBR, dateTimeBR, formatConverted, initials, num } from "../src/lib/format.ts";

const semEspacoEspecial = (s: string) => s.split(String.fromCharCode(160)).join(" ");

test("brl formata em reais, com nulos como zero", () => {
  assert.equal(semEspacoEspecial(brl(1234.5)), "R$ 1.234,50");
  assert.equal(semEspacoEspecial(brl(0)), "R$ 0,00");
  assert.equal(semEspacoEspecial(brl(null)), "R$ 0,00");
  assert.equal(semEspacoEspecial(brl(undefined)), "R$ 0,00");
  assert.equal(semEspacoEspecial(brl(-10)), "-R$ 10,00");
});

test("num usa vírgula decimal e limita as casas", () => {
  assert.equal(num(1234.5), "1.234,5");
  assert.equal(num(3), "3");
  assert.equal(num(1.23456, 3), "1,235");
  assert.equal(num(null), "0");
});

test("dateBR: data sem hora (coluna date do banco) não volta um dia no fuso do Brasil", () => {
  assert.equal(dateBR("2026-10-03"), "03/10/2026");
  assert.equal(dateBR("2026-01-01"), "01/01/2026");
  assert.equal(dateBR("2026-12-31"), "31/12/2026");
});

test("dateBR: carimbo de data e hora respeita o fuso local", () => {
  assert.equal(dateBR("2026-10-03T15:00:00-03:00"), "03/10/2026");
  assert.equal(dateBR("2026-10-03T23:30:00-03:00"), "03/10/2026");
});

test("dateBR e dateTimeBR: vazio vira travessão", () => {
  assert.equal(dateBR(null), "—");
  assert.equal(dateBR(""), "—");
  assert.equal(dateTimeBR(undefined), "—");
});

test("dateTimeBR mostra a hora local", () => {
  assert.equal(dateTimeBR("2026-10-03T21:30:00-03:00"), "03/10/26, 21:30");
});

test("initials pega até duas iniciais", () => {
  assert.equal(initials("Maria da Silva"), "MD");
  assert.equal(initials("joão"), "J");
  assert.equal(initials("  "), "?");
  assert.equal(initials(null), "?");
});

test("formatConverted mostra rolos fechados mais o resto", () => {
  assert.equal(formatConverted(743, "M", "ROLO", 100), "7 ROLO + 43 M");
  assert.equal(formatConverted(700, "M", "ROLO", 100), "7 ROLO");
  assert.equal(formatConverted(43, "M", "ROLO", 100), "43 M");
  assert.equal(formatConverted(10, "UN", null, null), "10 UN");
  assert.equal(formatConverted(10, "UN", "CX", 1), "10 UN");
});
