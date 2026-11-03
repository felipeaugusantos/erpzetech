import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cnaesDaEmpresa,
  moduloLiberadoEmpresa,
  moduloLiberadoPorCnae,
} from "../src/lib/cnae-regras.ts";
import {
  diaDaSemana,
  diasEntre,
  erroDocumento,
  escolherTarifa,
  normalizarDocumento,
  type Tarifa,
} from "../src/lib/hotelaria.ts";

const libera = (cnae: string) => moduloLiberadoPorCnae(cnaesDaEmpresa({ cnae }), "hotelaria");

test("CNAE: hotéis e outros alojamentos liberam; restaurante, lava-rápido e comércio não", () => {
  assert.equal(libera("5510-8/01"), true);
  assert.equal(libera("55.10-8/03"), true);
  assert.equal(libera("5590-6/01"), true);
  assert.equal(libera("5611-2/01"), false);
  assert.equal(libera("4520-0/06"), false);
  assert.equal(libera("4711-3/02"), false);
  assert.equal(libera("5500-0/00"), false);
});

test("módulo: ramo, liberação explícita e escolha sem CNPJ liberam; com CNPJ a escolha manual não vale", () => {
  const comCnpj = { cnpj: "11.222.333/0001-81" };
  assert.equal(
    moduloLiberadoEmpresa({ ...comCnpj, ramo_atividade: "hotelaria" }, "hotelaria"),
    true,
  );
  assert.equal(
    moduloLiberadoEmpresa({ ...comCnpj, modulos_liberados: ["hotelaria"] }, "hotelaria"),
    true,
  );
  assert.equal(moduloLiberadoEmpresa({ ...comCnpj, cnae: "5510-8/01" }, "hotelaria"), true);
  assert.equal(
    moduloLiberadoEmpresa({ cnpj: "", modulos_sem_cnpj: ["hotelaria"] }, "hotelaria"),
    true,
  );
  assert.equal(
    moduloLiberadoEmpresa({ ...comCnpj, modulos_sem_cnpj: ["hotelaria"] }, "hotelaria"),
    false,
  );
  assert.equal(
    moduloLiberadoEmpresa({ ...comCnpj, ramo_atividade: "restaurante" }, "hotelaria"),
    false,
  );
  assert.equal(
    moduloLiberadoEmpresa({ ...comCnpj, ramo_atividade: "hotelaria" }, "restaurante"),
    false,
  );
});

test("documento: CPF conferido pelos dígitos, passaporte normalizado, vazio é aceito", () => {
  assert.equal(normalizarDocumento("cpf", "529.982.247-25"), "52998224725");
  assert.equal(normalizarDocumento("passaporte", "ab-123 456"), "AB123456");
  assert.equal(erroDocumento("cpf", "529.982.247-25"), null);
  assert.notEqual(erroDocumento("cpf", "12345678900"), null);
  assert.notEqual(erroDocumento("cpf", "111.111.111-11"), null);
  assert.equal(erroDocumento("passaporte", "AB 123456"), null);
  assert.notEqual(erroDocumento("rg", "12"), null);
  assert.equal(erroDocumento(null, ""), null);
  assert.notEqual(erroDocumento("rg", ""), null);
  assert.notEqual(erroDocumento(null, "123456"), null);
});

test("datas: dia da semana e diferença em dias não dependem do fuso", () => {
  assert.equal(diaDaSemana("2027-01-01"), 5);
  assert.equal(diaDaSemana("2027-07-14"), 3);
  assert.equal(diaDaSemana("2027-07-17"), 6);
  assert.equal(diasEntre("2027-07-01", "2027-07-31"), 30);
  assert.equal(diasEntre("2027-03-13", "2027-03-15"), 2);
});

// As mesmas tarifas e noites da seção 89 do smoke do banco.
const A: Tarifa = {
  id: "a",
  vigencia_de: "2027-01-01",
  vigencia_ate: "2027-12-31",
  dias_semana: [],
  prioridade: 0,
  ativo: true,
};
const B: Tarifa = { ...A, id: "b", dias_semana: [5, 6], prioridade: 1 };
const C: Tarifa = { ...A, id: "c", vigencia_de: "2027-12-30", prioridade: 5 };
const D: Tarifa = { ...A, id: "d", vigencia_de: "2027-07-01", vigencia_ate: "2027-07-31" };
const todas = [A, B, C, D];

test("tarifa da noite: prioridade, dia da semana e vigência menor no empate", () => {
  assert.equal(escolherTarifa(todas, "2027-01-04")?.id, "a");
  assert.equal(escolherTarifa(todas, "2027-01-01")?.id, "b");
  assert.equal(escolherTarifa(todas, "2027-01-02")?.id, "b");
  assert.equal(escolherTarifa(todas, "2027-07-14")?.id, "d");
  assert.equal(escolherTarifa(todas, "2027-07-17")?.id, "b");
  assert.equal(escolherTarifa(todas, "2027-12-31")?.id, "c");
});

test("tarifa da noite: fora da vigência não há tarifa e tarifa inativa não vale", () => {
  assert.equal(escolherTarifa(todas, "2026-12-31"), null);
  assert.equal(escolherTarifa(todas, "2028-01-01"), null);
  assert.equal(escolherTarifa([A, B, C, { ...D, ativo: false }], "2027-07-14")?.id, "a");
  assert.equal(escolherTarifa([], "2027-07-14"), null);
});

test("tarifa da noite: empate total é decidido sempre do mesmo jeito, qualquer que seja a ordem", () => {
  const x: Tarifa = { ...A, id: "x" };
  const y: Tarifa = { ...A, id: "y" };
  assert.equal(escolherTarifa([y, x], "2027-02-02")?.id, "x");
  assert.equal(escolherTarifa([x, y], "2027-02-02")?.id, "x");
  // começou mais tarde (mesma duração) vence
  const mais_tarde: Tarifa = {
    ...A,
    id: "z",
    vigencia_de: "2027-02-01",
    vigencia_ate: "2027-12-31",
  };
  const antes: Tarifa = { ...A, id: "w", vigencia_de: "2027-01-01", vigencia_ate: "2027-12-01" };
  assert.equal(diasEntre(mais_tarde.vigencia_de, mais_tarde.vigencia_ate), 333);
  assert.equal(diasEntre(antes.vigencia_de, antes.vigencia_ate), 334);
  assert.equal(escolherTarifa([antes, mais_tarde], "2027-03-03")?.id, "z");
});
