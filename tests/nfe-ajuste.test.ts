import assert from "node:assert/strict";
import { test } from "node:test";
import { chaveDaOrigemAjuste, ideAjuste, validarMotivoAjuste } from "../src/lib/nfe-ajuste.ts";

function chaveComDv(base43: string): string {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  [...base43].reverse().forEach((d, i) => {
    soma += Number(d) * pesos[i % 8]!;
  });
  const r = soma % 11;
  return base43 + String(r < 2 ? 0 : 11 - r);
}
const CHAVE = chaveComDv("3526111234567800019055001000000123100000045");
const ok = { situacao: "autorizada", chave: CHAVE, modelo: "nfe" };

test("chaveDaOrigemAjuste devolve a chave de nota autorizada", () => {
  assert.equal(chaveDaOrigemAjuste(ok), CHAVE);
  assert.equal(chaveDaOrigemAjuste({ ...ok, modelo: null, chave: ` ${CHAVE} ` }), CHAVE);
});

test("chaveDaOrigemAjuste recusa nota que não pode ser ajustada", () => {
  assert.throws(() => chaveDaOrigemAjuste({ ...ok, situacao: "cancelada" }), /autorizada/);
  assert.throws(() => chaveDaOrigemAjuste({ ...ok, modelo: "nfse" }), /modelo 55/);
  assert.throws(() => chaveDaOrigemAjuste({ ...ok, ajusta_nfe_id: "x" }), /ajustada de novo/);
  assert.throws(() => chaveDaOrigemAjuste({ ...ok, fornecedor_id: "f" }), /devolução de compra/);
  assert.throws(() => chaveDaOrigemAjuste({ ...ok, chave: "123" }), /chave de acesso válida/);
});

test("validarMotivoAjuste exige o motivo e limita a 200 caracteres", () => {
  assert.throws(() => validarMotivoAjuste("curto"), /amparo legal/);
  assert.throws(() => validarMotivoAjuste(null), /amparo legal/);
  assert.equal(
    validarMotivoAjuste("  Ajuste previsto no RICMS art.   10  "),
    "Ajuste previsto no RICMS art. 10",
  );
  assert.equal(validarMotivoAjuste("x".repeat(300)).length, 200);
});

test("ideAjuste: finalidade 3, saída, indPres 0 e uma só nota referenciada", () => {
  assert.deepEqual(ideAjuste(CHAVE), {
    finNFe: 3,
    tpNF: 1,
    indPres: 0,
    NFref: [{ refNFe: CHAVE }],
  });
});
