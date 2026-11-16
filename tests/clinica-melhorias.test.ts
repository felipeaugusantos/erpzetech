import assert from "node:assert/strict";
import test from "node:test";
import { dataClinica, erroDataAtendimento, formDoAtendimento, evolucaoDoPeso, type AtendimentoClinico } from "../src/lib/clinica.ts";
import { podeSalvarCatalogo, precisaControleDose } from "../src/lib/vacina-produto.ts";
import { cadastroVazio, operacaoDoCadastroRapido } from "../src/lib/cadastro-rapido.ts";
import { abrirAtendimento, dadosParaSalvar } from "../src/lib/atendimento-offline.ts";

test("data de atendimento editável preserva a abertura original e usa Brasília", () => {
  const original = { aberto_em: "2026-11-16T01:00:00Z", data_atendimento: "2026-11-10", peso_kg: null } as AtendimentoClinico;
  assert.equal(formDoAtendimento(original).data_atendimento, "2026-11-10");
  assert.equal(original.aberto_em, "2026-11-16T01:00:00Z");
  assert.equal(dataClinica(original.aberto_em), "2026-11-15");
  assert.equal(erroDataAtendimento("2026-11-10", "2026-11-16"), null);
  assert.ok(erroDataAtendimento("2026-11-17", "2026-11-16"));
});

test("cada consulta tem peso próprio sem copiar automaticamente o cadastro", () => {
  const f = formDoAtendimento({ peso_kg: null, pet: { peso_kg: 12.5 } } as AtendimentoClinico);
  assert.equal(f.peso_kg, "");
  assert.equal(formDoAtendimento({ peso_kg: 12.345 } as AtendimentoClinico).peso_kg, "12,345");
  const { rascunho } = abrirAtendimento({ tipo: "visita_avulsa", paciente: { petId: "pet", petNome: "Thor", tutorNome: "Tutor" }, servicoId: "consulta" }, new Date("2026-11-16T12:00:00Z"));
  assert.equal(dadosParaSalvar({ ...rascunho.form, peso_kg: "12,345" })["peso_kg"], "12,345");
  assert.equal(rascunho.form.data_atendimento, "2026-11-16");
});

test("tutor e paciente são cadastrados juntos e vinculados na mesma operação", () => {
  const op = operacaoDoCadastroRapido({ ...cadastroVazio, tutorNome: "Maria", tutorTelefone: "16988547561", petNome: "Thor" }, undefined, { cliente: "tutor-id", pet: "pet-id" });
  assert.deepEqual((op.payload as { cliente: unknown }).cliente, { id: "tutor-id", nome: "Maria", telefone: "16988547561" });
  assert.equal((op.payload as { pet: { nome: string } }).pet.nome, "Thor");
});

test("produto existente sem lote aparece mas exige confirmação antes de salvar vacina", () => {
  const produto = { id: "v8", descricao: "V8 Canina", codigo_interno: "1", controla_estoque: true, controla_lote: false };
  assert.equal(precisaControleDose(produto), true);
  assert.equal(podeSalvarCatalogo("V8 Canina", produto, false), false);
  assert.equal(podeSalvarCatalogo("V8 Canina", produto, true), true);
  assert.equal(podeSalvarCatalogo("V8 Canina", undefined, true), false);
  assert.equal(podeSalvarCatalogo("V8 Canina", { ...produto, controla_lote: true }, false), true);
});

test("evolução do peso usa a data corrigida da consulta", () => {
  assert.deepEqual(evolucaoDoPeso([
    { aberto_em: "2026-11-16T12:00:00Z", data_atendimento: "2026-11-10", peso_kg: 12.345 },
    { aberto_em: "2026-11-12T12:00:00Z", data_atendimento: "2026-11-12", peso_kg: 13 },
  ]).map((p) => p.em), ["2026-11-10", "2026-11-12"]);
});