import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cfopDevolucaoVenda,
  chaveAcessoValida,
  chavesDaVenda,
  dvChaveAcesso,
  ideDevolucao,
  nItemDaVenda,
} from "../src/lib/nfe-devolucao.ts";

/** Chave de teste com o dígito verificador calculado à mão (soma ponderada), sem usar a função testada. */
function chaveComDv(base43: string): string {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  [...base43].reverse().forEach((d, i) => {
    soma += Number(d) * pesos[i % 8]!;
  });
  const r = soma % 11;
  return base43 + String(r < 2 ? 0 : 11 - r);
}
const BASE = "3526111234567800019055001000000123100000045";
const CHAVE = chaveComDv(BASE);

test("dvChaveAcesso e chaveAcessoValida batem com o cálculo manual", () => {
  assert.equal(CHAVE.length, 44);
  assert.equal(dvChaveAcesso(BASE), Number(CHAVE[43]));
  assert.equal(chaveAcessoValida(CHAVE), true);
  const errada = BASE + String((Number(CHAVE[43]) + 1) % 10);
  assert.equal(chaveAcessoValida(errada), false);
  assert.equal(chaveAcessoValida("123"), false);
  assert.equal(chaveAcessoValida(null), false);
  assert.equal(chaveAcessoValida(CHAVE.replace(/\d$/, "x")), false);
});

test("cfopDevolucaoVenda: 1202/2202 e ST em 1411/2411, qualquer que seja o CFOP de origem", () => {
  assert.equal(cfopDevolucaoVenda("5102", false), "1202");
  assert.equal(cfopDevolucaoVenda("1202", true), "2202");
  assert.equal(cfopDevolucaoVenda("6102", true), "2202");
  assert.equal(cfopDevolucaoVenda("5405", false), "1411");
  assert.equal(cfopDevolucaoVenda("6403", true), "2411");
  assert.equal(cfopDevolucaoVenda(null, false), "1202");
});

test("chavesDaVenda: só autorizada, modelo 55, chave válida, sem repetir nem a própria nota", () => {
  const notas = [
    { id: "a", chave: CHAVE, situacao: "autorizada", modelo: "nfe" },
    { id: "b", chave: CHAVE, situacao: "autorizada", modelo: null },
    {
      id: "c",
      chave: chaveComDv("3526111234567800019055001000000124100000046"),
      situacao: "cancelada",
    },
    { id: "d", chave: "123", situacao: "autorizada" },
    { id: "dev", chave: CHAVE, situacao: "autorizada" },
    { id: "e", chave: CHAVE, situacao: "autorizada", modelo: "nfse" },
  ];
  assert.deepEqual(chavesDaVenda(notas, "dev"), [CHAVE]);
});

test("chavesDaVenda: sem nota de venda autorizada, recusa com o motivo", () => {
  assert.throws(
    () => chavesDaVenda([{ id: "a", chave: CHAVE, situacao: "rejeitada" }], "dev"),
    /referenciar a NF-e de venda autorizada/,
  );
  assert.throws(() => chavesDaVenda([], "dev"), /referenciar/);
});

test("nItemDaVenda acha a posição do primeiro item do produto", () => {
  const itens = [{ produto_id: "p1" }, { produto_id: "p2" }, { produto_id: "p2" }];
  assert.equal(nItemDaVenda(itens, "p1"), 1);
  assert.equal(nItemDaVenda(itens, "p2"), 2);
  assert.equal(nItemDaVenda(itens, "p9"), null);
  assert.equal(nItemDaVenda(itens, null), null);
});

test("ideDevolucao: finalidade 4, entrada, indPres 0 e a(s) chave(s) referenciada(s)", () => {
  assert.deepEqual(ideDevolucao([CHAVE]), {
    finNFe: 4,
    tpNF: 0,
    indPres: 0,
    NFref: [{ refNFe: CHAVE }],
  });
});
