import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { chaveBearer, chaveTvConfere, montarResumoTv, saudeDeErros } from "../src/lib/monitoramento-tv.ts";

describe("painel de TV: chave de leitura", () => {
  const chave = "chave-de-teste-com-mais-de-20-caracteres";
  const hash = createHash("sha256").update(chave).digest("hex");

  it("aceita só a chave que bate com o hash", () => {
    assert.equal(chaveTvConfere(chave, hash), true);
    assert.equal(chaveTvConfere(chave + "x", hash), false);
    assert.equal(chaveTvConfere("outra-chave-qualquer-bem-longa", hash), false);
  });

  it("recusa chave ausente ou hash inválido", () => {
    assert.equal(chaveTvConfere(null, hash), false);
    assert.equal(chaveTvConfere("", hash), false);
    assert.equal(chaveTvConfere(chave, "nao-e-hash"), false);
  });

  it("lê só o formato Bearer com chave de tamanho razoável", () => {
    assert.equal(chaveBearer(`Bearer ${chave}`), chave);
    assert.equal(chaveBearer(chave), null);
    assert.equal(chaveBearer("Bearer curta"), null);
    assert.equal(chaveBearer(null), null);
  });
});

describe("painel de TV: saúde e resposta agregada", () => {
  it("saúde pela quantidade de erros novos na última hora", () => {
    assert.equal(saudeDeErros(0), "verde");
    assert.equal(saudeDeErros(1), "amarelo");
    assert.equal(saudeDeErros(9), "amarelo");
    assert.equal(saudeDeErros(10), "vermelho");
  });

  it("copia só os campos conhecidos e nunca deixa passar nome de cliente", () => {
    const r = montarResumoTv({
      gerado_em: "2026-11-17T10:00:00Z",
      erros_abertos: 4,
      erros_novos_1h: 2,
      erros_novos_24h: 5,
      usuarios_ativos_24h: 7,
      acoes_24h: 120,
      clientes_ativos_24h: 3,
      clientes_sem_uso_7d: 1,
      cliente: "Clínica Secreta",
      serie: [{ dia: "2026-11-17", erros_novos: 1, acoes: 10, usuarios_ativos: 2, cliente: "Loja X" }],
      top_erros: [
        { rota: "/caixa", origem: "navegador", ocorrencias: 9, cliente: "Loja Y", mensagem: "x@y.com" },
        {}, {}, { rota: "/quarto" },
      ],
    });
    assert.equal(r.saude, "amarelo");
    assert.equal(r.top_erros.length, 3);
    assert.doesNotMatch(JSON.stringify(r), /Secreta|Loja|x@y/);
    assert.equal(r.serie[0].acoes, 10);
  });

  it("entrada inválida vira zeros, não erro", () => {
    const r = montarResumoTv(null);
    assert.equal(r.erros_abertos, 0);
    assert.deepEqual(r.serie, []);
    assert.equal(r.saude, "verde");
  });
});
