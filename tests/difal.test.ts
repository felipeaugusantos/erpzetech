import assert from "node:assert/strict";
import { test } from "node:test";
import { calcularDifal, exigeDifal, validarRegraUf } from "../src/lib/difal.ts";

const base = {
  interestadual: true,
  indFinal: 1,
  indIEDest: 9,
  finalidade: 1,
  crt: 3,
  grupoIcms: "ICMS00",
};

test("exigeDifal só na venda interestadual a consumidor final não contribuinte, regime normal, ICMS00", () => {
  assert.equal(exigeDifal(base), true);
  assert.equal(exigeDifal({ ...base, interestadual: false }), false);
  assert.equal(exigeDifal({ ...base, indFinal: 0 }), false);
  assert.equal(exigeDifal({ ...base, indIEDest: 1 }), false);
  assert.equal(exigeDifal({ ...base, indIEDest: 2 }), false);
  assert.equal(exigeDifal({ ...base, finalidade: 4 }), false);
  assert.equal(exigeDifal({ ...base, crt: 1 }), false);
  assert.equal(exigeDifal({ ...base, grupoIcms: "ICMS60" }), false);
});

test("base única: DIFAL = base × (interna − interestadual) e FCP sobre a base", () => {
  const r = calcularDifal({
    base: 1000,
    aliqInter: 12,
    regra: { aliquota_interna: 18, fcp: 2, metodo: "unica" },
  });
  assert.equal(r.vICMSUFDest, 60);
  assert.equal(r.vFCPUFDest, 20);
  assert.deepEqual(r.grupo, {
    vBCUFDest: 1000,
    vBCFCPUFDest: 1000,
    pFCPUFDest: 2,
    pICMSUFDest: 18,
    pICMSInter: 12,
    pICMSInterPart: 100,
    vFCPUFDest: 20,
    vICMSUFDest: 60,
    vICMSUFRemet: 0,
  });
});

test("base dupla: base do destino por dentro e DIFAL = ICMS destino − ICMS origem", () => {
  const r = calcularDifal({
    base: 1000,
    aliqInter: 12,
    regra: { aliquota_interna: 18, fcp: 0, metodo: "dupla" },
  });
  // (1000 − 120) / 0,82 = 1073,17; ICMS destino 193,17 − 120 = 73,17
  assert.equal(r.grupo.vBCUFDest, 1073.17);
  assert.equal(r.vICMSUFDest, 73.17);
  assert.equal(r.vFCPUFDest, 0);
});

test("interna menor ou igual à interestadual não gera DIFAL negativo", () => {
  const r = calcularDifal({
    base: 500,
    aliqInter: 12,
    regra: { aliquota_interna: 12, fcp: 0, metodo: "unica" },
  });
  assert.equal(r.vICMSUFDest, 0);
  const r2 = calcularDifal({
    base: 500,
    aliqInter: 12,
    regra: { aliquota_interna: 7, fcp: 0, metodo: "unica" },
  });
  assert.equal(r2.vICMSUFDest, 0);
});

test("calcularDifal recusa alíquota interna inválida", () => {
  assert.throws(
    () =>
      calcularDifal({
        base: 1,
        aliqInter: 12,
        regra: { aliquota_interna: 0, fcp: 0, metodo: "unica" },
      }),
    /inválida/,
  );
  assert.throws(
    () =>
      calcularDifal({
        base: 1,
        aliqInter: 12,
        regra: { aliquota_interna: 100, fcp: 0, metodo: "dupla" },
      }),
    /inválida/,
  );
});

test("validarRegraUf normaliza e recusa o que não faz sentido", () => {
  assert.deepEqual(
    validarRegraUf({ uf: " mg ", aliquotaInterna: "18", fcp: "2", metodo: "unica" }),
    {
      uf: "MG",
      aliquota_interna: 18,
      fcp: 2,
      metodo: "unica",
    },
  );
  assert.equal(
    validarRegraUf({ uf: "RJ", aliquotaInterna: 22, fcp: undefined, metodo: "dupla" }).fcp,
    0,
  );
  assert.throws(
    () => validarRegraUf({ uf: "XX", aliquotaInterna: 18, fcp: 0, metodo: "unica" }),
    /UF inválida/,
  );
  assert.throws(
    () => validarRegraUf({ uf: "SP", aliquotaInterna: 0, fcp: 0, metodo: "unica" }),
    /entre 0 e 40/,
  );
  assert.throws(
    () => validarRegraUf({ uf: "SP", aliquotaInterna: 18, fcp: 11, metodo: "unica" }),
    /FCP/,
  );
  assert.throws(
    () => validarRegraUf({ uf: "SP", aliquotaInterna: 18, fcp: 0, metodo: "x" }),
    /método/,
  );
});
