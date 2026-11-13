import assert from "node:assert/strict";
import { test } from "node:test";
import { aplicarEnderecoCep, consultarCep, normalizarCep } from "../src/lib/cep.ts";

test("CEP aceita máscara e exige oito números antes de consultar", async () => {
  assert.equal(normalizarCep("14015-020"), "14015020");
  await assert.rejects(() => consultarCep("14015"), /8 números/);
});

test("preenche rua, bairro, cidade e UF e preserva número e complemento", () => {
  const inicio = { endereco: "", bairro: "", cidade: "", estado: "", numero: "20", complemento: "Sala 2" };
  const encontrado = { endereco: "Rua A", bairro: "Centro", cidade: "Ribeirão Preto", estado: "SP" };
  assert.deepEqual(aplicarEnderecoCep(inicio, inicio, encontrado), { ...encontrado, numero: "20", complemento: "Sala 2" });
});

test("consulta não sobrescreve endereço editado enquanto aguardava resposta", () => {
  const inicio = { endereco: "", bairro: "", cidade: "", estado: "" };
  const atual = { ...inicio, endereco: "Rua digitada" };
  assert.equal(aplicarEnderecoCep(atual, inicio, { endereco: "Outra rua", bairro: "Centro", cidade: "São Paulo", estado: "SP" }).endereco, "Rua digitada");
});

test("CEP de cidade sem rua e bairro não apaga os campos já preenchidos", () => {
  const inicio = { endereco: "Rua cadastrada", bairro: "Bairro cadastrado", cidade: "Cidade anterior", estado: "MG" };
  assert.deepEqual(aplicarEnderecoCep(inicio, inicio, { endereco: "", bairro: "", cidade: "Araraquara", estado: "SP" }), {
    endereco: "Rua cadastrada", bairro: "Bairro cadastrado", cidade: "Araraquara", estado: "SP",
  });
});