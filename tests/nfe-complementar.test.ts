import assert from "node:assert/strict";
import { test } from "node:test";
import { chaveAcessoValida } from "../src/lib/nfe-devolucao.ts";
import {
  chaveDaOrigemComplementar,
  ideComplementar,
  itemComplementar,
  validarItensComplemento,
} from "../src/lib/nfe-complementar.ts";

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

test("chaveDaOrigemComplementar devolve a chave de nota autorizada", () => {
  assert.equal(chaveAcessoValida(CHAVE), true);
  assert.equal(chaveDaOrigemComplementar(ok), CHAVE);
  assert.equal(chaveDaOrigemComplementar({ ...ok, modelo: null, chave: ` ${CHAVE} ` }), CHAVE);
});

test("chaveDaOrigemComplementar recusa o que a Sefaz recusaria", () => {
  assert.throws(() => chaveDaOrigemComplementar({ ...ok, situacao: "cancelada" }), /autorizada/);
  assert.throws(() => chaveDaOrigemComplementar({ ...ok, situacao: "rascunho" }), /autorizada/);
  assert.throws(() => chaveDaOrigemComplementar({ ...ok, modelo: "nfse" }), /modelo 55/);
  assert.throws(() => chaveDaOrigemComplementar({ ...ok, complementa_nfe_id: "x" }), /268/);
  assert.throws(
    () => chaveDaOrigemComplementar({ ...ok, fornecedor_id: "f" }),
    /devolução de compra/,
  );
  assert.throws(() => chaveDaOrigemComplementar({ ...ok, chave: "123" }), /chave de acesso válida/);
  assert.throws(() => chaveDaOrigemComplementar({ ...ok, chave: null }), /chave de acesso válida/);
});

test("validarItensComplemento: itens da original, valor positivo, sem repetir", () => {
  const ids = ["a", "b"];
  assert.deepEqual(
    validarItensComplemento(
      [
        { nfe_item_id: "a", valor: "10.5" },
        { nfe_item_id: "b", valor: 1.006 },
      ],
      ids,
    ),
    [
      { nfe_item_id: "a", valor: 10.5 },
      { nfe_item_id: "b", valor: 1.01 },
    ],
  );
  assert.throws(() => validarItensComplemento([], ids), /pelo menos um item/);
  assert.throws(
    () => validarItensComplemento([{ nfe_item_id: "z", valor: 1 }], ids),
    /não pertence/,
  );
  assert.throws(
    () =>
      validarItensComplemento(
        [
          { nfe_item_id: "a", valor: 1 },
          { nfe_item_id: "a", valor: 2 },
        ],
        ids,
      ),
    /repetido/,
  );
  assert.throws(
    () => validarItensComplemento([{ nfe_item_id: "a", valor: 0 }], ids),
    /maior que zero/,
  );
  assert.throws(
    () => validarItensComplemento([{ nfe_item_id: "a", valor: 0.004 }], ids),
    /maior que zero/,
  );
  assert.throws(
    () => validarItensComplemento([{ nfe_item_id: "a", valor: -3 }], ids),
    /maior que zero/,
  );
  assert.throws(
    () => validarItensComplemento([{ nfe_item_id: "a", valor: "abc" }], ids),
    /maior que zero/,
  );
});

test("ideComplementar: finalidade 2, saída, indPres 0 e uma só nota referenciada", () => {
  assert.deepEqual(ideComplementar(CHAVE), {
    finNFe: 2,
    tpNF: 1,
    indPres: 0,
    NFref: [{ refNFe: CHAVE }],
  });
});

test("itemComplementar zera quantidade e valor unitário e põe o valor em vProd", () => {
  assert.deepEqual(itemComplementar(12.345), {
    qCom: 0,
    vUnCom: 0,
    qTrib: 0,
    vUnTrib: 0,
    vProd: 12.35,
  });
});
