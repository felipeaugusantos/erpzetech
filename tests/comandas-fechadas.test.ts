import assert from "node:assert/strict";
import { test } from "node:test";

import {
  diaSeguinte,
  intervaloDias,
  notaPorComanda,
  rotuloNota,
} from "../src/lib/comandas-fechadas.ts";

test("dia seguinte vira mês e ano", () => {
  assert.equal(diaSeguinte("2026-10-24"), "2026-10-25");
  assert.equal(diaSeguinte("2026-10-31"), "2026-11-01");
  assert.equal(diaSeguinte("2026-12-31"), "2027-01-01");
  assert.equal(diaSeguinte("2028-02-28"), "2028-02-29");
});

test("intervalo cobre o dia inteiro de Brasília (21h já é o dia seguinte em UTC)", () => {
  const i = intervaloDias("2026-10-24", "2026-10-24");
  assert.deepEqual(i, { inicio: "2026-10-24T03:00:00.000Z", fim: "2026-10-25T03:00:00.000Z" });
  // 23h30 de Brasília de 24/10 está dentro; 00h10 de 25/10 está fora
  assert.ok("2026-10-25T02:30:00.000Z" >= i!.inicio && "2026-10-25T02:30:00.000Z" < i!.fim);
  assert.ok(!("2026-10-25T03:10:00.000Z" < i!.fim));
});

test("intervalo recusa data inválida ou invertida", () => {
  assert.equal(intervaloDias("24/10/2026", "2026-10-24"), null);
  assert.equal(intervaloDias("2026-13-40", "2026-13-41"), null);
  assert.equal(intervaloDias("2026-10-25", "2026-10-24"), null);
});

test("nota viva mais recente por comanda; cancelada e sem comanda não contam", () => {
  const mapa = notaPorComanda([
    { comanda_id: "a", situacao: "cancelada", numero: 1, created_at: "2026-10-24T10:00:00Z" },
    { comanda_id: "a", situacao: "rascunho", numero: null, created_at: "2026-10-24T11:00:00Z" },
    { comanda_id: "a", situacao: "pronta", numero: 7, created_at: "2026-10-24T12:00:00Z" },
    { comanda_id: null, situacao: "pronta", numero: 8, created_at: "2026-10-24T12:00:00Z" },
    { comanda_id: "b", situacao: "cancelada", numero: 2, created_at: "2026-10-24T12:00:00Z" },
  ]);
  assert.equal(mapa.get("a")?.numero, 7);
  assert.equal(mapa.has("b"), false);
  assert.equal(mapa.size, 1);
});

test("rótulo da nota", () => {
  assert.equal(rotuloNota(undefined), "Sem NFC-e");
  assert.equal(rotuloNota({ situacao: "rascunho", numero: null }), "Rascunho (falta resolver)");
  assert.equal(rotuloNota({ situacao: "autorizada", numero: 12 }), "Autorizada · nº 12");
});
