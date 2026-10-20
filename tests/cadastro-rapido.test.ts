import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cadastroVazio,
  erroDoCadastroRapido,
  operacaoDoCadastroRapido,
  pacientesLocais,
  type FormCadastroRapido,
} from "../src/lib/cadastro-rapido.ts";
import { novaOperacao } from "../src/lib/fila-clinica.ts";

const hoje = new Date("2026-10-20T12:00:00");
const ok: FormCadastroRapido = {
  ...cadastroVazio,
  tutorNome: "Maria da Fazenda",
  tutorTelefone: "(16) 98888-1111",
  petNome: "Toby",
};

describe("erroDoCadastroRapido", () => {
  it("tutor novo com nome e pet passa; telefone é opcional", () => {
    assert.equal(erroDoCadastroRapido(ok, hoje), null);
    assert.equal(erroDoCadastroRapido({ ...ok, tutorTelefone: "" }, hoje), null);
  });
  it("tutor existente não pede nome nem telefone", () => {
    assert.equal(
      erroDoCadastroRapido({ ...ok, tutorId: "abc", tutorNome: "", tutorTelefone: "" }, hoje),
      null,
    );
  });
  it("confere o tutor novo", () => {
    assert.match(erroDoCadastroRapido({ ...ok, tutorNome: "M" }, hoje) ?? "", /nome do tutor/);
    assert.match(erroDoCadastroRapido({ ...ok, tutorTelefone: "12345" }, hoje) ?? "", /DDD/);
    assert.equal(erroDoCadastroRapido({ ...ok, tutorTelefone: "16 98888 1111" }, hoje), null);
  });
  it("confere o pet", () => {
    assert.match(erroDoCadastroRapido({ ...ok, petNome: "  " }, hoje) ?? "", /nome do pet/);
    assert.match(erroDoCadastroRapido({ ...ok, peso: "0" }, hoje) ?? "", /Peso/);
    assert.match(erroDoCadastroRapido({ ...ok, peso: "201" }, hoje) ?? "", /Peso/);
    assert.match(erroDoCadastroRapido({ ...ok, peso: "abc" }, hoje) ?? "", /Peso/);
    assert.equal(erroDoCadastroRapido({ ...ok, peso: "12,5" }, hoje), null);
    assert.match(erroDoCadastroRapido({ ...ok, nascimento: "2026-12-01" }, hoje) ?? "", /futuro/);
    assert.equal(erroDoCadastroRapido({ ...ok, nascimento: "2023-03-10" }, hoje), null);
  });
});

describe("operacaoDoCadastroRapido", () => {
  const ids = { operacao: "op-1", cliente: "cli-1", pet: "pet-1" };
  it("tutor novo: os ids nascem no notebook e a chave de repetição é o id da operação", () => {
    const op = operacaoDoCadastroRapido(
      {
        ...ok,
        raca: "SRD",
        sexo: "macho",
        nascimento: "2023-03-10",
        peso: "12,5",
        castrado: "sim",
        alergias: "frango",
      },
      undefined,
      ids,
      hoje,
    );
    assert.equal(op.id, "op-1");
    assert.equal(op.tipo, "cadastro_rapido");
    assert.equal(op.descricao, "Cadastro: Toby (tutor Maria da Fazenda)");
    assert.deepEqual(op.dependeDe, []);
    assert.deepEqual(op.payload, {
      cliente: { id: "cli-1", nome: "Maria da Fazenda", telefone: "(16) 98888-1111" },
      pet: {
        id: "pet-1",
        nome: "Toby",
        especie: "cao",
        raca: "SRD",
        sexo: "macho",
        nascimento: "2023-03-10",
        peso_kg: "12.5",
        castrado: true,
        alergias: "frango",
      },
    });
  });
  it("tutor existente usa só o id dele e não manda campos em branco", () => {
    const op = operacaoDoCadastroRapido(
      { ...ok, tutorId: "tutor-9", especie: "gato", castrado: "nao" },
      "Ana",
      ids,
      hoje,
    );
    assert.deepEqual(op.payload, {
      cliente_id: "tutor-9",
      pet: { id: "pet-1", nome: "Toby", especie: "gato", castrado: false },
    });
    assert.equal(op.descricao, "Cadastro: Toby (tutor Ana)");
  });
  it("sem ids informados gera ids diferentes a cada operação", () => {
    const a = operacaoDoCadastroRapido(ok, undefined, {}, hoje);
    const b = operacaoDoCadastroRapido(ok, undefined, {}, hoje);
    assert.notEqual(a.id, b.id);
    assert.notEqual(
      (a.payload as { pet: { id: string } }).pet.id,
      (b.payload as { pet: { id: string } }).pet.id,
    );
  });
});

describe("pacientesLocais", () => {
  it("lista os pets cadastrados sem internet que ainda estão na fila", () => {
    const novo = operacaoDoCadastroRapido(
      ok,
      undefined,
      { operacao: "op-1", cliente: "cli-1", pet: "pet-1" },
      hoje,
    );
    const existente = operacaoDoCadastroRapido(
      { ...ok, tutorId: "tutor-9", petNome: "Mimi", especie: "gato" },
      undefined,
      { operacao: "op-2", pet: "pet-2" },
      hoje,
    );
    const outra = novaOperacao({ tipo: "outra_coisa", descricao: "x", payload: {} }, "op-3", hoje);
    const lista = pacientesLocais([novo, existente, outra], { "tutor-9": "Ana" });
    assert.deepEqual(lista, [
      {
        petId: "pet-1",
        petNome: "Toby",
        especie: "cao",
        tutorId: "cli-1",
        tutorNome: "Maria da Fazenda",
        operacaoId: "op-1",
      },
      {
        petId: "pet-2",
        petNome: "Mimi",
        especie: "gato",
        tutorId: "tutor-9",
        tutorNome: "Ana",
        operacaoId: "op-2",
      },
    ]);
  });
  it("ignora operação com payload fora do formato", () => {
    const ruim = novaOperacao(
      { tipo: "cadastro_rapido", descricao: "x", payload: { pet: {} } },
      "op-4",
      hoje,
    );
    assert.deepEqual(pacientesLocais([ruim]), []);
  });
});
