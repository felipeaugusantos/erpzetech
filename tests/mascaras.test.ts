import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aplicarMascara,
  mascaraCep,
  mascaraCnpj,
  mascaraCpf,
  mascaraCpfCnpj,
  mascaraTelefone,
} from "../src/lib/mascaras.ts";

test("telefone: fixo, celular, digitando e colando", () => {
  assert.equal(mascaraTelefone("1633334444"), "(16) 3333-4444");
  assert.equal(mascaraTelefone("16999994444"), "(16) 99999-4444");
  assert.equal(mascaraTelefone("+55 (16) 99999-4444"), "(16) 99999-4444");
  assert.equal(mascaraTelefone("5516999994444"), "(16) 99999-4444");
  // passou de 11 dígitos: o excesso é cortado
  assert.equal(mascaraTelefone("16 3333 4444 99"), "(16) 33334-4449");
});

test("telefone: apagando não deixa pontuação sobrando", () => {
  assert.equal(mascaraTelefone(""), "");
  assert.equal(mascaraTelefone("1"), "(1");
  assert.equal(mascaraTelefone("16"), "(16");
  assert.equal(mascaraTelefone("(16) "), "(16");
  assert.equal(mascaraTelefone("163"), "(16) 3");
  assert.equal(mascaraTelefone("(16) 3333-"), "(16) 3333");
  assert.equal(mascaraTelefone("(16) 3333-4"), "(16) 3333-4");
});

test("cpf", () => {
  assert.equal(mascaraCpf("52998224725"), "529.982.247-25");
  assert.equal(mascaraCpf("529.982.247-25"), "529.982.247-25");
  assert.equal(mascaraCpf("5299"), "529.9");
  assert.equal(mascaraCpf("529982247259999"), "529.982.247-25");
  assert.equal(mascaraCpf(""), "");
});

test("cnpj", () => {
  assert.equal(mascaraCnpj("11222333000181"), "11.222.333/0001-81");
  assert.equal(mascaraCnpj("11.222.333/0001-81"), "11.222.333/0001-81");
  assert.equal(mascaraCnpj("112"), "11.2");
  assert.equal(mascaraCnpj("112223330001"), "11.222.333/0001");
  assert.equal(mascaraCnpj("112223330001819999"), "11.222.333/0001-81");
});

test("cnpj alfanumérico mantém as letras (maiúsculas) e só números nos dígitos verificadores", () => {
  assert.equal(mascaraCnpj("00000000E08G12"), "00.000.000/E08G-12");
  assert.equal(mascaraCnpj("00.000.000/e08g-12"), "00.000.000/E08G-12");
  assert.equal(mascaraCnpj("12ABC34501DE35"), "12.ABC.345/01DE-35");
  // letra nos 2 últimos caracteres não entra
  assert.equal(mascaraCnpj("00000000E08GAB12"), "00.000.000/E08G-12");
  assert.equal(mascaraCnpj("00000000E08G"), "00.000.000/E08G");
});

test("cpf ou cnpj: letra ou mais de 11 caracteres vira CNPJ, número curto continua CPF", () => {
  assert.equal(mascaraCpfCnpj("00000000E08G12"), "00.000.000/E08G-12");
  assert.equal(mascaraCpfCnpj("12AB"), "12.AB");
  assert.equal(mascaraCpfCnpj("529982247"), "529.982.247");
});

test("cpf ou cnpj muda sozinho pelo tamanho", () => {
  assert.equal(mascaraCpfCnpj("52998224725"), "529.982.247-25");
  assert.equal(mascaraCpfCnpj("529982247251"), "52.998.224/7251");
  assert.equal(mascaraCpfCnpj("11222333000181"), "11.222.333/0001-81");
});

test("cep", () => {
  assert.equal(mascaraCep("14800000"), "14800-000");
  assert.equal(mascaraCep("14800"), "14800");
  assert.equal(mascaraCep("14800-0"), "14800-0");
  assert.equal(mascaraCep("148000001234"), "14800-000");
});

test("aplicarMascara escolhe pelo tipo", () => {
  assert.equal(aplicarMascara("cep", "14800000"), "14800-000");
  assert.equal(aplicarMascara("telefone", "16999994444"), "(16) 99999-4444");
  assert.equal(aplicarMascara("cpf", "52998224725"), "529.982.247-25");
});
