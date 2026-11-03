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

// Mesmas tarifas e contas da seção 90 do smoke do banco.
import {
  cotarEstadia,
  noitesDaEstadia,
  precoDaNoite,
  ratearValor,
  type TarifaPreco,
} from "../src/lib/hotelaria.ts";

const marco: TarifaPreco = {
  id: "marco",
  vigencia_de: "2027-03-01",
  vigencia_ate: "2027-03-31",
  dias_semana: [],
  prioridade: 0,
  ativo: true,
  valor_diaria: 100,
  valor_adulto_extra: 40,
  valor_crianca: 20,
  minimo_noites: 1,
  pessoas_incluidas: 2,
};
const abril: TarifaPreco = {
  ...marco,
  id: "abril",
  vigencia_de: "2027-04-01",
  vigencia_ate: "2027-04-30",
  valor_diaria: 90,
  valor_adulto_extra: 0,
  valor_crianca: 0,
  minimo_noites: 3,
};

test("preço da noite: adulto além do incluído e criança pagam extra", () => {
  assert.equal(precoDaNoite(marco, 2, 0), 100);
  assert.equal(precoDaNoite(marco, 1, 0), 100);
  assert.equal(precoDaNoite(marco, 3, 0), 140);
  assert.equal(precoDaNoite(marco, 3, 1), 160);
  assert.equal(precoDaNoite({ ...marco, pessoas_incluidas: 1 }, 2, 0), 140);
  assert.equal(precoDaNoite({ ...marco, valor_diaria: 0.1, valor_crianca: 0.2 }, 2, 1), 0.3);
});

test("cotação: noite a noite, total e mínimo de noites da chegada", () => {
  const t = [marco, abril];
  assert.equal(cotarEstadia(t, "2027-03-01", "2027-03-04", 2, 0).total, 300);
  assert.equal(cotarEstadia(t, "2027-03-01", "2027-03-04", 3, 1).total, 480);
  assert.equal(cotarEstadia(t, "2027-04-01", "2027-04-04", 2, 0).total, 270);
  assert.deepEqual(noitesDaEstadia("2027-02-27", "2027-03-02"), [
    "2027-02-27",
    "2027-02-28",
    "2027-03-01",
  ]);
  assert.throws(() => cotarEstadia(t, "2027-04-01", "2027-04-03", 2, 0), /mínimo de 3|no mínimo 3/);
  assert.throws(
    () => cotarEstadia(t, "2027-02-27", "2027-03-02", 2, 0),
    /Sem tarifa para a noite de 27\/02\/2027/,
  );
  assert.throws(
    () => cotarEstadia(t, "2027-03-03", "2027-03-03", 2, 0),
    /saída precisa ser depois/,
  );
  assert.throws(() => cotarEstadia(t, "2027-03-01", "2028-03-05", 2, 0), /365/);
  // mínimo é o da noite de chegada: começar em março e entrar em abril não herda as 3 noites de abril
  assert.equal(cotarEstadia(t, "2027-03-31", "2027-04-02", 2, 0).total, 190);
});

test("valor acordado: rateio em centavos com a sobra na última noite", () => {
  assert.deepEqual(ratearValor(250, 3), [83.33, 83.33, 83.34]);
  assert.deepEqual(ratearValor(100, 3), [33.33, 33.33, 33.34]);
  assert.deepEqual(ratearValor(100, 4), [25, 25, 25, 25]);
  assert.deepEqual(ratearValor(0, 2), [0, 0]);
  assert.equal(
    ratearValor(250, 3).reduce((s, v) => s + Math.round(v * 100), 0),
    25000,
  );
  assert.throws(() => ratearValor(100, 0));
});
