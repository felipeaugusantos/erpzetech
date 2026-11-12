import assert from "node:assert/strict";
import { test } from "node:test";

import { dadosTutorParaSalvar, dadosTutorVazios, erroDoTutorNovo, nomeParaComparar, tutoresParecidos } from "../src/lib/tutor-novo.ts";

test("CPF do tutor salva como pessoa física, sem CNPJ", () => {
  const dados = dadosTutorParaSalvar({ ...dadosTutorVazios, documento: "529.982.247-25" });
  assert.equal(dados.tipo, "PF");
  assert.equal(dados.cpf, "52998224725");
  assert.equal(dados.cnpj, null);
});

test("CNPJ do tutor salva como pessoa jurídica, sem CPF", () => {
  const dados = dadosTutorParaSalvar({ ...dadosTutorVazios, documento: "11.222.333/0001-81" });
  assert.equal(dados.tipo, "PJ");
  assert.equal(dados.cnpj, "11222333000181");
  assert.equal(dados.cpf, null);
});

test("endereço do tutor mantém todos os campos e normaliza CEP e UF", () => {
  assert.deepEqual(dadosTutorParaSalvar({ ...dadosTutorVazios,
    cep: "14000-000", endereco: " Rua A ", numero: " 20 ", complemento: " Sala 2 ",
    bairro: " Centro ", cidade: " Ribeirão Preto ", estado: "sp",
  }), { tipo: "PF", cpf: null, cnpj: null, cep: "14000000", endereco: "Rua A", numero: "20",
    complemento: "Sala 2", bairro: "Centro", cidade: "Ribeirão Preto", estado: "SP" });
});

test("confere nome e telefone do tutor novo", () => {
  assert.equal(erroDoTutorNovo("Maria Silva", "(16) 99999-0000"), null);
  assert.equal(erroDoTutorNovo("Maria", ""), null);
  assert.match(erroDoTutorNovo("M", "") ?? "", /nome do tutor/);
  assert.match(erroDoTutorNovo("a".repeat(121), "") ?? "", /nome do tutor/);
  assert.match(erroDoTutorNovo("Maria", "9999") ?? "", /Telefone inválido/);
});

test("compara nomes sem acento, caixa nem espaços repetidos", () => {
  assert.equal(nomeParaComparar("  JOÃO   da  Silva "), "joao da silva");
});

const tutores = [
  { id: "1", nome: "João da Silva", telefone: "(16) 99999-0000" },
  { id: "2", nome: "Maria Souza", telefone: "16 98888-1111" },
  { id: "3", nome: "Ana", telefone: null },
];

test("acha tutor parecido pelo telefone, mesmo escrito de outro jeito", () => {
  assert.deepEqual(
    tutoresParecidos(tutores, "Outro nome", "+55 16 99999 0000").map((t) => t.id),
    ["1"],
  );
});

test("acha tutor parecido pelo nome igual, sem acento nem caixa", () => {
  assert.deepEqual(
    tutoresParecidos(tutores, "joao DA silva", "").map((t) => t.id),
    ["1"],
  );
});

test("DDD diferente com o mesmo número não é o mesmo tutor", () => {
  const lista = [
    { id: "a", nome: "Tutor A", telefone: "(16) 99999-0000" },
    { id: "b", nome: "Tutor B", telefone: "(66) 99999-0000" },
  ];
  assert.deepEqual(
    tutoresParecidos(lista, "Novo", "(66) 99999-0000").map((t) => t.id),
    ["b"],
  );
  assert.deepEqual(
    tutoresParecidos(lista, "Novo", "55 66 99999 0000").map((t) => t.id),
    ["b"],
  );
  assert.deepEqual(tutoresParecidos(lista, "Novo", "(11) 99999-0000"), []);
});

test("nome parecido mas diferente, ou telefone curto, não conta", () => {
  assert.deepEqual(tutoresParecidos(tutores, "João Silva", "1699"), []);
  assert.deepEqual(tutoresParecidos(tutores, "Ana Paula", ""), []);
});
