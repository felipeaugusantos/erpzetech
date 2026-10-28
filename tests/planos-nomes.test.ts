import assert from "node:assert/strict";
import { test } from "node:test";

import { NOME_DO_PLANO, comNomeDeExibicao, nomeDoPlano } from "../src/lib/planos-nomes.ts";

test("nomes de exibição dos três planos", () => {
  assert.deepEqual(NOME_DO_PLANO, {
    balcao: "Essencial",
    loja: "Profissional",
    rede: "Empresarial",
  });
  assert.equal(nomeDoPlano("balcao"), "Essencial");
  assert.equal(nomeDoPlano("loja"), "Profissional");
  assert.equal(nomeDoPlano("rede"), "Empresarial");
});

test("valor que não é de um plano volta como veio", () => {
  assert.equal(nomeDoPlano("nao_sei"), "nao_sei");
  assert.equal(nomeDoPlano(""), "");
  assert.equal(nomeDoPlano(null), "");
});

test("plano do banco: troca o nome original e o item 'Tudo do …', mantém o resto", () => {
  const loja = {
    codigo: "loja",
    nome: "Loja",
    valor_mensal: 299,
    resumo: "1 loja, depósitos ilimitados, 15 usuários",
    recursos: ["Tudo do Balcão", "NF-e"],
  };
  const r = comNomeDeExibicao(loja);
  assert.equal(r.nome, "Profissional");
  assert.deepEqual(r.recursos, ["Tudo do Essencial", "NF-e"]);
  assert.equal(r.codigo, "loja");
  assert.equal(r.valor_mensal, 299);
  assert.equal(r.resumo, "1 loja, depósitos ilimitados, 15 usuários");

  const rede = comNomeDeExibicao({
    codigo: "rede",
    nome: "Rede",
    recursos: ["Tudo do Loja", "Balanço fiscal"],
  });
  assert.equal(rede.nome, "Empresarial");
  assert.deepEqual(rede.recursos, ["Tudo do Profissional", "Balanço fiscal"]);
});

test("nome editado pela equipe e plano fora dos três não são alterados", () => {
  const editado = { codigo: "loja", nome: "Loja Premium", recursos: [] as string[] };
  assert.equal(comNomeDeExibicao(editado).nome, "Loja Premium");
  const outro = { codigo: "especial", nome: "Rede", recursos: ["Tudo do Loja"] };
  assert.deepEqual(comNomeDeExibicao(outro), outro);
  // frases que só contêm as palavras não são plano
  const frase = { codigo: "balcao", nome: "Balcão", recursos: ["Orçamento no balcão", "1 loja"] };
  assert.deepEqual(comNomeDeExibicao(frase).recursos, ["Orçamento no balcão", "1 loja"]);
});
