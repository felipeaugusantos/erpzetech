import { test } from "node:test";
import assert from "node:assert/strict";
import { situacaoValidade } from "../src/lib/bulario-favoritos.ts";

test("validade anterior a hoje está vencida", () => {
  assert.equal(situacaoValidade("2026-11-11", "2026-11-12"), "vencido");
});
test("no próprio dia da validade ainda vale, mas avisa", () => {
  assert.equal(situacaoValidade("2026-11-12", "2026-11-12"), "vence_logo");
});
test("até 30 dias avisa; 31 dias está válido", () => {
  assert.equal(situacaoValidade("2026-12-12", "2026-11-12"), "vence_logo");
  assert.equal(situacaoValidade("2026-12-13", "2026-11-12"), "valido");
});
test("sem validade informada", () => {
  assert.equal(situacaoValidade(null, "2026-11-12"), "sem_validade");
});
