import assert from "node:assert/strict";
import test from "node:test";
import { cnpjAlfaValido, limparDocumento, temCnpj } from "../src/lib/cnpj-alfa.ts";
import { semCnpj } from "../src/lib/cnae-regras.ts";

test("CNPJ numérico continua valendo", () => {
  assert.equal(cnpjAlfaValido("11.222.333/0001-81"), true);
  assert.equal(cnpjAlfaValido("11222333000182"), false);
  assert.equal(cnpjAlfaValido("00000000000000"), false);
});

test("CNPJ alfanumérico do exemplo da Receita (12.ABC.345/01DE-35)", () => {
  assert.equal(cnpjAlfaValido("12.ABC.345/01DE-35"), true);
  assert.equal(cnpjAlfaValido("12abc34501de35"), true);
  assert.equal(cnpjAlfaValido("12.ABC.345/01DE-36"), false);
  assert.equal(cnpjAlfaValido("12.ABC.345/01DE-AB"), false);
});

test("limpeza e presença de CNPJ", () => {
  assert.equal(limparDocumento("12.abc.345/01de-35"), "12ABC34501DE35");
  assert.equal(temCnpj("12.ABC.345/01DE-35"), true);
  assert.equal(temCnpj("12.ABC"), false);
  assert.equal(semCnpj({ cnpj: "12.ABC.345/01DE-35" }), false);
  assert.equal(semCnpj({ cnpj: "" }), true);
});
