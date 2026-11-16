import assert from "node:assert/strict";
import test from "node:test";
import { cadastroVazio, operacaoDoCadastroRapido, type CadastroRapidoPayload } from "../src/lib/cadastro-rapido.ts";

test("cadastro do paciente envia documentos, endereço e contatos do tutor novo", () => {
  const op = operacaoDoCadastroRapido({ ...cadastroVazio, tutorNome: "Tutor teste", petNome: "Paciente teste", tutorTelefone: "16999990000", tutorTipo: "PF", tutorAceitaMensagens: false,
    tutorDados: { documento: "529.982.247-25", cep: "14010-000", endereco: "Rua teste", numero: "123", complemento: "Casa", bairro: "Centro", cidade: "Ribeirão Preto", estado: "sp", email: "teste@example.com", whatsapp: "16988880000" } });
  const cli = (op.payload as CadastroRapidoPayload).cliente;
  assert.equal(cli?.cpf, "52998224725");
  assert.equal(cli?.cnpj, null);
  assert.equal(cli?.cep, "14010000");
  assert.equal(cli?.endereco, "Rua teste");
  assert.equal(cli?.numero, "123");
  assert.equal(cli?.complemento, "Casa");
  assert.equal(cli?.bairro, "Centro");
  assert.equal(cli?.cidade, "Ribeirão Preto");
  assert.equal(cli?.estado, "SP");
  assert.equal(cli?.email, "teste@example.com");
  assert.equal(cli?.whatsapp, "16988880000");
  assert.equal(cli?.aceita_mensagens, false);
});
test("escolher tutor existente não envia mudanças ao cadastro dele", () => {
  const op = operacaoDoCadastroRapido({ ...cadastroVazio, tutorId: "tutor-existente", petNome: "Segundo pet", tutorDados: { documento: "", cep: "", endereco: "Não substituir", numero: "", complemento: "", bairro: "", cidade: "", estado: "" } });
  assert.equal((op.payload as CadastroRapidoPayload).cliente_id, "tutor-existente");
  assert.equal((op.payload as CadastroRapidoPayload).cliente, undefined);
});