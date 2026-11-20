import assert from "node:assert/strict";
import test from "node:test";
import { dadosLoteManual, dadosServicoCobrado } from "../src/lib/vacina-lote-manual.ts";

test("serviço cobrado é opcional e não envia cobrança implícita", () => {
  assert.deepEqual(dadosServicoCobrado(""), {});
  assert.deepEqual(dadosServicoCobrado("11111111-1111-1111-1111-111111111111"), {
    servico_id: "11111111-1111-1111-1111-111111111111",
  });
  assert.throws(() => dadosServicoCobrado("__nenhum"));
});

test("lote e vencimento manuais não exigem cadastro de lote", () => {
  assert.deepEqual(dadosLoteManual(" VAC-2026-A ", "2027-06-30", "2026-11-20"), {
    lote: "VAC-2026-A",
    validade_lote: "2027-06-30",
  });
});
test("lote é opcional mesmo com vencimento preenchido", () => {
  assert.deepEqual(dadosLoteManual("   ", "2027-06-30", "2026-11-20"), {
    lote: null,
    validade_lote: "2027-06-30",
  });
});
test("vencimento é opcional mesmo com lote preenchido", () => {
  assert.deepEqual(dadosLoteManual("VAC-A", "", "2026-11-20"), {
    lote: "VAC-A",
    validade_lote: null,
  });
});
test("lote e vencimento podem ficar ambos vazios", () => {
  assert.deepEqual(dadosLoteManual("", "", "2026-11-20"), {
    lote: null,
    validade_lote: null,
  });
});
test("vencimento preenchido deve ser uma data real", () => {
  for (const data of ["2027-02-30", "não é data"])
    assert.throws(() => dadosLoteManual("VAC-A", data, "2026-11-20"));
});
test("validade é conferida contra aplicação e não contra dia atual", () => {
  assert.throws(() => dadosLoteManual("VAC-A", "2026-11-19", "2026-11-20"));
  assert.equal(dadosLoteManual("VAC-A", "2026-11-20", "2026-11-20").validade_lote, "2026-11-20");
});
