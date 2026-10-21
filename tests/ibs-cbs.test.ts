import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLASSIFICACOES,
  SITUACOES,
  aliquotasDoAno,
  calcularItemIbsCbs,
  classificacaoDe,
  crtDoRegime,
  exigenciaIbsCbs,
  grupoIbsCbsDoItem,
  grupoTotalIbsCbs,
  motivoNaoSuportada,
  totaisIbsCbs,
} from "../src/lib/ibs-cbs.ts";

test("tabelas do Informe Técnico carregadas", () => {
  assert.equal(CLASSIFICACOES.length, 173);
  assert.equal(SITUACOES.length, 18);
  assert.equal(classificacaoDe("000001")?.cst, "000");
  assert.equal(classificacaoDe("200003")?.pRedIBS, 100);
  assert.equal(classificacaoDe("200034")?.pRedCBS, 60);
});

test("alíquotas de transição", () => {
  assert.deepEqual(aliquotasDoAno(2026), { ibsUF: 0.1, ibsMun: 0, cbs: 0.9 });
  assert.equal(aliquotasDoAno(2027)?.cbs, null);
  assert.equal(aliquotasDoAno(2030), null);
});

test("quem precisa informar o grupo IBS/CBS", () => {
  assert.equal(crtDoRegime("presumido"), 3);
  assert.equal(crtDoRegime("simples"), 1);
  assert.equal(exigenciaIbsCbs(3, "2026-10-21"), "obrigatorio");
  assert.equal(exigenciaIbsCbs(3, "2026-07-01"), "opcional");
  assert.equal(exigenciaIbsCbs(1, "2026-10-21"), "aguardando_nt");
});

test("tributação integral: R$ 1.000 em 2026 → IBS UF 1,00 e CBS 9,00", () => {
  const r = calcularItemIbsCbs({ cst: "000", cClassTrib: "000001", baseCalculo: 1000, ano: 2026 });
  if (!r.grupo) return assert.fail("sem grupo");
  assert.equal(r.vIBSUF, 1);
  assert.equal(r.vIBSMun, 0);
  assert.equal(r.vIBS, 1);
  assert.equal(r.vCBS, 9);
  assert.deepEqual(grupoIbsCbsDoItem(r), {
    CST: "000",
    cClassTrib: "000001",
    gIBSCBS: {
      vBC: 1000,
      gIBSUF: { pIBSUF: 0.1, vIBSUF: 1 },
      gIBSMun: { pIBSMun: 0, vIBSMun: 0 },
      vIBS: 1,
      gCBS: { pCBS: 0.9, vCBS: 9 },
    },
  });
});

test("alíquota reduzida 60%: leva o grupo gRed com a alíquota efetiva", () => {
  const r = calcularItemIbsCbs({ cst: "200", cClassTrib: "200034", baseCalculo: 100, ano: 2026 });
  if (!r.grupo) return assert.fail("sem grupo");
  assert.deepEqual(r.redCBS, { pRedAliq: 60, pAliqEfet: 0.36 });
  assert.equal(r.vCBS, 0.36);
  assert.equal(r.pCBS, 0.9);
  const g = grupoIbsCbsDoItem(r) as { gIBSCBS: { gCBS: { gRed: unknown } } };
  assert.deepEqual(g.gIBSCBS.gCBS.gRed, { pRedAliq: 60, pAliqEfet: 0.36 });
});

test("redução de 100% zera o imposto", () => {
  const r = calcularItemIbsCbs({ cst: "200", cClassTrib: "200003", baseCalculo: 100, ano: 2026 });
  if (!r.grupo) return assert.fail("sem grupo");
  assert.equal(r.vCBS, 0);
  assert.equal(r.vIBS, 0);
});

test("imunidade e isenção: só CST e cClassTrib", () => {
  const r = calcularItemIbsCbs({ cst: "410", cClassTrib: "410999", baseCalculo: 100, ano: 2026 });
  assert.deepEqual(grupoIbsCbsDoItem(r), { CST: "410", cClassTrib: "410999" });
});

test("combinações que o sistema ainda não calcula são recusadas com o motivo", () => {
  assert.match(motivoNaoSuportada("510", "510001") ?? "", /ainda não é calculado/);
  assert.match(motivoNaoSuportada("000", "200003") ?? "", /pertence ao CST 200/);
  assert.match(motivoNaoSuportada("000", "999999") ?? "", /não existe/);
  assert.match(motivoNaoSuportada("550", "550001") ?? "", /ainda não é calculado/);
  assert.throws(() =>
    calcularItemIbsCbs({ cst: "620", cClassTrib: "620001", baseCalculo: 1, ano: 2026 }),
  );
  assert.throws(
    () => calcularItemIbsCbs({ cst: "000", cClassTrib: "000001", baseCalculo: 1, ano: 2027 }),
    /ainda não foram publicadas/,
  );
});

test("totais da nota somam os itens e o grupo total segue o leiaute", () => {
  const a = calcularItemIbsCbs({ cst: "000", cClassTrib: "000001", baseCalculo: 33.33, ano: 2026 });
  const b = calcularItemIbsCbs({ cst: "000", cClassTrib: "000001", baseCalculo: 66.67, ano: 2026 });
  const c = calcularItemIbsCbs({ cst: "410", cClassTrib: "410999", baseCalculo: 50, ano: 2026 });
  const t = totaisIbsCbs([a, b, c]);
  assert.deepEqual(t, { vBC: 100, vIBSUF: 0.1, vIBSMun: 0, vIBS: 0.1, vCBS: 0.9 });
  const g = grupoTotalIbsCbs(t);
  assert.equal(g.vBCIBSCBS, 100);
  assert.equal(g.gCBS.vCBS, 0.9);
});
