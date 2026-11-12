import assert from "node:assert/strict";
import { test } from "node:test";
import {
  creditoPotencialDaCompra,
  direitoCreditoIbsCbs,
  somarCreditoCompras,
  textoCreditoIbsCbs,
} from "../src/lib/credito-ibs-cbs.ts";

test("direitoCreditoIbsCbs: só Lucro Presumido e Real", () => {
  assert.equal(direitoCreditoIbsCbs("presumido"), true);
  assert.equal(direitoCreditoIbsCbs("real"), true);
  assert.equal(direitoCreditoIbsCbs("REAL"), true);
  for (const r of ["simples", "simples_excesso", "mei", "", null, undefined, "outro"])
    assert.equal(direitoCreditoIbsCbs(r), false, String(r));
});

test("creditoPotencialDaCompra soma IBS e CBS destacados e ignora o crédito presumido", () => {
  const r = creditoPotencialDaCompra(
    { ibs: 1.5, cbs: 9, ibs_uf: 1, ibs_mun: 0.5, cred_pres_ibs: 0.25, cred_pres_cbs: 0.75 },
    "presumido",
  );
  assert.deepEqual(r, { disponivel: true, ibs: 1.5, cbs: 9, total: 10.5 });
});

test("creditoPotencialDaCompra: regime sem direito ou nota sem IBS/CBS não gera crédito", () => {
  assert.deepEqual(creditoPotencialDaCompra({ ibs: 1, cbs: 9 }, "simples"), {
    disponivel: false,
    ibs: 0,
    cbs: 0,
    total: 0,
  });
  assert.deepEqual(creditoPotencialDaCompra(null, "real"), {
    disponivel: true,
    ibs: 0,
    cbs: 0,
    total: 0,
  });
  assert.deepEqual(creditoPotencialDaCompra("texto", "real"), {
    disponivel: true,
    ibs: 0,
    cbs: 0,
    total: 0,
  });
});

test("creditoPotencialDaCompra ignora valores negativos, inválidos e arredonda em centavos", () => {
  assert.deepEqual(creditoPotencialDaCompra({ ibs: -5, cbs: "abc" }, "real"), {
    disponivel: true,
    ibs: 0,
    cbs: 0,
    total: 0,
  });
  assert.equal(creditoPotencialDaCompra({ ibs: 0.004, cbs: 1.005 }, "real").cbs, 1.01);
});

test("somarCreditoCompras soma as compras válidas e conta só as que geraram crédito", () => {
  const compras = [
    { situacao: "recebido", nfe_impostos: { ibs_cbs: { ibs: 1, cbs: 9 } } },
    { situacao: "aprovado", nfe_impostos: { ibs_cbs: { ibs: 0.5, cbs: 4.5 } } },
    { situacao: "cancelado", nfe_impostos: { ibs_cbs: { ibs: 100, cbs: 100 } } },
    { situacao: "rascunho", nfe_impostos: { ibs_cbs: { ibs: 100, cbs: 100 } } },
    { situacao: "recebido", nfe_impostos: { icms: 10 } },
    { situacao: "recebido", nfe_impostos: null },
  ];
  assert.deepEqual(somarCreditoCompras(compras, "presumido"), {
    disponivel: true,
    ibs: 1.5,
    cbs: 13.5,
    total: 15,
    compras: 2,
  });
  assert.deepEqual(somarCreditoCompras(compras, "simples"), {
    disponivel: false,
    ibs: 0,
    cbs: 0,
    total: 0,
    compras: 0,
  });
});

test("textoCreditoIbsCbs explica o que o valor significa em cada situação", () => {
  assert.match(textoCreditoIbsCbs({ disponivel: false, ibs: 0, cbs: 0, total: 0 }), /não credita/);
  assert.match(
    textoCreditoIbsCbs({ disponivel: true, ibs: 0, cbs: 0, total: 0 }),
    /Sem IBS\/CBS a creditar/,
  );
  const t = textoCreditoIbsCbs({ disponivel: true, ibs: 1.5, cbs: 9, total: 10.5 });
  assert.match(t, /Crédito potencial de IBS\/CBS/);
  assert.match(t, /Não muda o custo/);
});
