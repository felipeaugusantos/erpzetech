import assert from "node:assert/strict";
import { test } from "node:test";
import { erroIcmsCrt } from "../src/lib/crt.ts";
import { crtDoRegime, exigenciaIbsCbs } from "../src/lib/ibs-cbs.ts";

test("crtDoRegime: cada regime da empresa tem o seu CRT", () => {
  assert.equal(crtDoRegime("simples"), 1);
  assert.equal(crtDoRegime("simples_excesso"), 2);
  assert.equal(crtDoRegime("presumido"), 3);
  assert.equal(crtDoRegime("real"), 3);
  assert.equal(crtDoRegime("mei"), 4);
  assert.equal(crtDoRegime(null), 3);
  assert.equal(crtDoRegime(undefined), 3);
});

test("IBS/CBS: só o CRT 3 é obrigatório em 2026; CRT 1, 2 e 4 aguardam a NT (2027)", () => {
  assert.equal(exigenciaIbsCbs(3, "2026-08-03"), "obrigatorio");
  for (const crt of [1, 2, 4] as const)
    assert.equal(exigenciaIbsCbs(crt, "2026-11-10"), "aguardando_nt");
});

test("CRT 1 e 4 exigem CSOSN (3 dígitos); vazio cai no padrão do Simples", () => {
  for (const crt of [1, 4] as const) {
    assert.equal(erroIcmsCrt(crt, "102", "Parafuso"), null);
    assert.equal(erroIcmsCrt(crt, "500", "Parafuso"), null);
    assert.equal(erroIcmsCrt(crt, "", "Parafuso"), null);
    assert.equal(erroIcmsCrt(crt, null, "Parafuso"), null);
    assert.match(erroIcmsCrt(crt, "00", "Parafuso")!, /Parafuso.*CSOSN de 3 dígitos/);
  }
});

test("CRT 2 e 3 exigem CST (2 dígitos); CSOSN e vazio são erro com o produto", () => {
  for (const crt of [2, 3] as const) {
    assert.equal(erroIcmsCrt(crt, "00", "Cabo"), null);
    assert.equal(erroIcmsCrt(crt, "60", "Cabo"), null);
    assert.match(erroIcmsCrt(crt, "102", "Cabo")!, /Cabo.*CST de 2 dígitos/);
    assert.match(erroIcmsCrt(crt, "", "Cabo")!, /Cabo.*sem CST/);
    assert.match(erroIcmsCrt(crt, null, "Cabo")!, /sem CST/);
  }
});
