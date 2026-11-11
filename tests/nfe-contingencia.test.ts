import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UFS_SVC_RS,
  identEmissao,
  servicoEmOperacao,
  svcDaUf,
  validarJustificativaContingencia,
} from "../src/lib/nfe-contingencia.ts";

test("svcDaUf: cada UF cai em exatamente um ambiente e as 27 são cobertas", () => {
  const todas =
    "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");
  assert.equal(todas.length, 27);
  for (const uf of todas) assert.ok(svcDaUf(uf), uf);
  assert.deepEqual(svcDaUf("sp"), { tpEmis: 6, autorizador: "SVCAN", nome: "SVC-AN" });
  assert.deepEqual(svcDaUf(" PR "), { tpEmis: 7, autorizador: "SVCRS", nome: "SVC-RS" });
  for (const uf of UFS_SVC_RS) assert.equal(svcDaUf(uf)?.tpEmis, 7);
  assert.equal(svcDaUf("XX"), null);
  assert.equal(svcDaUf(null), null);
});

test("identEmissao: sem contingência é normal", () => {
  assert.deepEqual(identEmissao(null, "SP"), { tpEmis: 1 });
});

test("identEmissao: com contingência usa a SVC da UF, dhCont e xJust", () => {
  const estado = {
    justificativa: "Sefaz fora do ar desde as 10h",
    entrou_em: "2026-11-10T13:00:00.000Z",
  };
  assert.deepEqual(identEmissao(estado, "SP"), {
    tpEmis: 6,
    dhCont: "2026-11-10T13:00:00.000-00:00",
    xJust: "Sefaz fora do ar desde as 10h",
  });
  assert.equal(identEmissao(estado, "BA").tpEmis, 7);
});

test("identEmissao: UF desconhecida ou justificativa curta com contingência ativa é erro", () => {
  const estado = {
    justificativa: "Sefaz fora do ar desde as 10h",
    entrou_em: "2026-11-10T13:00:00Z",
  };
  assert.throws(() => identEmissao(estado, "XX"), /UF do emitente/);
  assert.throws(() => identEmissao({ ...estado, justificativa: "curta" }, "SP"), /pelo menos 15/);
});

test("validarJustificativaContingencia: 15 a 256 depois de normalizar", () => {
  assert.throws(() => validarJustificativaContingencia("curta"), /pelo menos 15/);
  assert.throws(() => validarJustificativaContingencia("x".repeat(257)), /no máximo 256/);
  assert.equal(
    validarJustificativaContingencia("  Sefaz\n fora   do ar hoje  "),
    "Sefaz fora do ar hoje",
  );
});

test("servicoEmOperacao só aceita o código 107", () => {
  assert.equal(servicoEmOperacao({ codigo_status: 107 }), true);
  assert.equal(servicoEmOperacao({ codigo_status: "107" }), true);
  assert.equal(servicoEmOperacao({ codigo_status: 108 }), false);
  assert.equal(servicoEmOperacao({ codigo_status: 109 }), false);
  assert.equal(servicoEmOperacao(null), false);
});
