import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baseIbsCbs,
  estimarIbsCbsPedido,
  simularItemIbsCbs,
  situacaoIbsCbs,
} from "../src/lib/ibs-cbs-simulacao.ts";
import { calcularItemIbsCbs } from "../src/lib/ibs-cbs.ts";

test("baseIbsCbs: valor menos desconto, PIS, COFINS e ICMS, nunca negativa", () => {
  assert.equal(baseIbsCbs({ total: 1000 }), 1000);
  assert.equal(baseIbsCbs({ total: 1000, desconto: 50, pis: 16.5, cofins: 76, icms: 180 }), 677.5);
  assert.equal(baseIbsCbs({ total: 100, icms: 500 }), 0);
  assert.equal(baseIbsCbs({ total: 10.005 }), 10.01);
});

test("simularItemIbsCbs em branco usa tributação integral e bate com o cálculo da emissão", () => {
  const r = simularItemIbsCbs({ cst: "", cClassTrib: "", total: 1000, ano: 2026 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.base, 1000);
  assert.equal(r.resultado.cst, "000");
  assert.equal(r.resultado.cClassTrib, "000001");
  assert.deepEqual(
    r.resultado,
    calcularItemIbsCbs({ cst: "000", cClassTrib: "000001", baseCalculo: 1000, ano: 2026 }),
  );
  if (!r.resultado.grupo) throw new Error("esperava grupo");
  // 2026: CBS 0,9% e IBS 0,1% (estadual)
  assert.equal(r.resultado.vCBS, 9);
  assert.equal(r.resultado.vIBSUF, 1);
  assert.equal(r.resultado.vIBS, 1);
});

test("simularItemIbsCbs desconta ICMS/PIS/COFINS da base antes de calcular", () => {
  const r = simularItemIbsCbs({
    cst: "",
    cClassTrib: "",
    total: 1000,
    icms: 180,
    pis: 16.5,
    cofins: 76,
    ano: 2026,
  });
  assert.equal(r.ok, true);
  if (!r.ok || !r.resultado.grupo) throw new Error("esperava grupo");
  assert.equal(r.base, 727.5);
  assert.equal(r.resultado.vBC, 727.5);
});

test("simularItemIbsCbs devolve o motivo quando a combinação não é calculada ou o ano não tem alíquota", () => {
  const naoSuportada = simularItemIbsCbs({
    cst: "550",
    cClassTrib: "550001",
    total: 100,
    ano: 2026,
  });
  assert.equal(naoSuportada.ok, false);
  if (!naoSuportada.ok) assert.match(naoSuportada.motivo, /550/);
  const anoSemAliquota = simularItemIbsCbs({ cst: "", cClassTrib: "", total: 100, ano: 2027 });
  assert.equal(anoSemAliquota.ok, false);
  if (!anoSemAliquota.ok) assert.match(anoSemAliquota.motivo, /2027/);
  const inexistente = simularItemIbsCbs({
    cst: "999",
    cClassTrib: "999999",
    total: 100,
    ano: 2026,
  });
  assert.equal(inexistente.ok, false);
});

test("simularItemIbsCbs: CST sem grupo de valores (imunidade) não gera valores", () => {
  const r = simularItemIbsCbs({ cst: "410", cClassTrib: "410004", total: 100, ano: 2026 });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.resultado.grupo, false);
});

test("situacaoIbsCbs segue a regra da emissão por regime e data", () => {
  assert.equal(situacaoIbsCbs("presumido", "2026-11-12"), "obrigatorio");
  assert.equal(situacaoIbsCbs("real", "2026-08-03"), "obrigatorio");
  assert.equal(situacaoIbsCbs("real", "2026-08-02"), "opcional");
  for (const r of ["simples", "simples_excesso", "mei"])
    assert.equal(situacaoIbsCbs(r, "2026-11-12"), "aguardando_nt", r);
});

test("estimarIbsCbsPedido soma os itens com a conta da emissão e separa os que não são calculados", () => {
  const e = estimarIbsCbsPedido(
    [
      { id: "a", descricao: "Ração", total: 1000, cst: "", cClassTrib: "" },
      { id: "b", descricao: "Vacina", total: 500, cst: null, cClassTrib: null },
      { id: "c", descricao: "Item suspenso", total: 300, cst: "550", cClassTrib: "550001" },
    ],
    2026,
  );
  // 2026: CBS 0,9% e IBS 0,1%; a base do pedido é o valor do item
  assert.equal(e.totais.vBC, 1500);
  assert.equal(e.totais.vCBS, 13.5);
  assert.equal(e.totais.vIBS, 1.5);
  assert.equal(e.comErro.length, 1);
  assert.equal(e.comErro[0]!.id, "c");
  assert.match(e.comErro[0]!.motivo, /550/);
  assert.equal(e.itens.length, 3);
});

test("estimarIbsCbsPedido sem itens dá totais zerados", () => {
  const e = estimarIbsCbsPedido([], 2026);
  assert.equal(e.totais.vIBS, 0);
  assert.equal(e.totais.vCBS, 0);
  assert.deepEqual(e.comErro, []);
});
