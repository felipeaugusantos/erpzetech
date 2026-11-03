import assert from "node:assert/strict";
import { test } from "node:test";

import {
  diasInternado,
  rotuloSituacaoInternacao,
  rotuloTipoOcorrencia,
  variacaoDePeso,
} from "../src/lib/internacao.ts";

test("dias de internação contam o dia da admissão como o 1º (relógio de Brasília)", () => {
  assert.equal(diasInternado("2026-11-02T13:00:00Z", new Date("2026-11-02T20:00:00Z")), 1);
  assert.equal(diasInternado("2026-11-02T13:00:00Z", new Date("2026-11-03T13:00:00Z")), 2);
  // 01h UTC ainda é o dia anterior em Brasília
  assert.equal(diasInternado("2026-11-02T22:00:00Z", new Date("2026-11-03T01:30:00Z")), 1);
  assert.equal(diasInternado("2026-11-02T22:00:00Z", new Date("2026-11-03T03:30:00Z")), 2);
  assert.equal(diasInternado("2026-11-05T10:00:00Z", new Date("2026-11-01T10:00:00Z")), 1);
});

test("variação de peso desde a primeira pesagem", () => {
  assert.equal(variacaoDePeso([{ peso_kg: 8, created_at: "2026-11-02T10:00:00Z" }]), null);
  assert.equal(
    variacaoDePeso([
      { peso_kg: 7.6, created_at: "2026-11-04T10:00:00Z" },
      { peso_kg: 8.4, created_at: "2026-11-02T10:00:00Z" },
      { peso_kg: 8, created_at: "2026-11-03T10:00:00Z" },
    ]),
    -0.8,
  );
});

test("rótulos da internação", () => {
  assert.equal(rotuloSituacaoInternacao("obito"), "Óbito");
  assert.equal(rotuloSituacaoInternacao("internado"), "Internado");
  assert.equal(rotuloTipoOcorrencia("transferencia"), "Transferência");
  assert.equal(rotuloTipoOcorrencia("medicacao"), "Medicação");
});
