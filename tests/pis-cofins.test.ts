import assert from "node:assert/strict";
import { test } from "node:test";
import { grupoDoCst, grupoPisCofins } from "../src/lib/pis-cofins.ts";

test("grupoDoCst cobre a tabela de CST e recusa o que não existe", () => {
  for (const c of ["01", "02"]) assert.equal(grupoDoCst(c), "Aliq");
  assert.equal(grupoDoCst("03"), "Qtde");
  for (const c of ["04", "05", "06", "07", "08", "09"]) assert.equal(grupoDoCst(c), "NT");
  for (const c of ["49", "50", "56", "60", "67", "70", "75", "98", "99"])
    assert.equal(grupoDoCst(c), "Outr");
  for (const c of [
    "00",
    "10",
    "48",
    "57",
    "59",
    "68",
    "69",
    "76",
    "97",
    "100",
    "",
    null,
    undefined,
    "1",
  ])
    assert.equal(grupoDoCst(c), null, String(c));
});

test("CST 01 vai em PISAliq com base, alíquota e valor", () => {
  const r = grupoPisCofins("PIS", { cst: "01", base: 1000, aliquota: 1.65 });
  assert.deepEqual(r, {
    grupo: { PISAliq: { CST: "01", vBC: 1000, pPIS: 1.65, vPIS: 16.5 } },
    valor: 16.5,
  });
});

test("COFINS usa os campos próprios e o mesmo cálculo", () => {
  const r = grupoPisCofins("COFINS", { cst: "02", base: 333.33, aliquota: 7.6 });
  assert.deepEqual(Object.keys(r.grupo), ["COFINSAliq"]);
  const corpo = r.grupo["COFINSAliq"] as Record<string, unknown>;
  assert.equal(corpo["pCOFINS"], 7.6);
  assert.equal(corpo["vCOFINS"], 25.33);
  assert.equal(r.valor, 25.33);
});

test("CST de não incidência (04 a 09) leva só o CST e valor zero", () => {
  for (const cst of ["04", "06", "09"]) {
    assert.deepEqual(grupoPisCofins("PIS", { cst, base: 500, aliquota: 1.65 }), {
      grupo: { PISNT: { CST: cst } },
      valor: 0,
    });
    assert.deepEqual(grupoPisCofins("COFINS", { cst, base: 500, aliquota: 7.6 }), {
      grupo: { COFINSNT: { CST: cst } },
      valor: 0,
    });
  }
});

test("CST 49/99 vai em Outr, inclusive com alíquota zero (Simples)", () => {
  assert.deepEqual(grupoPisCofins("PIS", { cst: "99", base: 200, aliquota: 0 }), {
    grupo: { PISOutr: { CST: "99", vBC: 200, pPIS: 0, vPIS: 0 } },
    valor: 0,
  });
  const r = grupoPisCofins("COFINS", { cst: "49", base: 200, aliquota: 3 });
  assert.deepEqual(Object.keys(r.grupo), ["COFINSOutr"]);
  assert.equal(r.valor, 6);
});

test("CST inválido e CST 03 são recusados com o motivo", () => {
  assert.throws(
    () => grupoPisCofins("PIS", { cst: "10", base: 1, aliquota: 1 }),
    /CST de PIS inválido/,
  );
  assert.throws(
    () => grupoPisCofins("COFINS", { cst: "", base: 1, aliquota: 1 }),
    /CST de COFINS inválido/,
  );
  assert.throws(() => grupoPisCofins("PIS", { cst: "03", base: 1, aliquota: 1 }), /CST 03 de PIS/);
});

test("o valor é arredondado em 2 casas pela base e alíquota informadas", () => {
  assert.equal(grupoPisCofins("PIS", { cst: "01", base: 99.99, aliquota: 0.65 }).valor, 0.65);
  assert.equal(grupoPisCofins("PIS", { cst: "01", base: 10.07, aliquota: 1.65 }).valor, 0.17);
});
