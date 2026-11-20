import assert from "node:assert/strict";
import test from "node:test";
import { dadosLoteManual } from "../src/lib/vacina-lote-manual.ts";

test("lote e vencimento manuais não exigem cadastro de lote", () => {
  assert.deepEqual(dadosLoteManual(" VAC-2026-A ", "2027-06-30", "2026-11-20"), {
    lote: "VAC-2026-A",
    validade_lote: "2027-06-30",
  });
});
test("lote informado é obrigatório", () => {
  assert.throws(() => dadosLoteManual("   ", "2027-06-30", "2026-11-20"));
});
test("vencimento informado é obrigatório e deve ser uma data real", () => {
  for (const data of ["", "2027-02-30", "não é data"])
    assert.throws(() => dadosLoteManual("VAC-A", data, "2026-11-20"));
});
test("validade é conferida contra aplicação e não contra dia atual", () => {
  assert.throws(() => dadosLoteManual("VAC-A", "2026-11-19", "2026-11-20"));
  assert.equal(dadosLoteManual("VAC-A", "2026-11-20", "2026-11-20").validade_lote, "2026-11-20");
});
