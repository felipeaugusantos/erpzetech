import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  chaveBearer,
  chaveTvConfere,
  montarBackupTv,
  montarClientesSemUsoTv,
  montarResumoTv,
  saudeDeErros,
} from "../src/lib/monitoramento-tv.ts";

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
      serie: [
        { dia: "2026-11-17", erros_novos: 1, acoes: 10, usuarios_ativos: 2, cliente: "Loja X" },
      ],
      top_erros: [
        {
          rota: "/caixa",
          origem: "navegador",
          ocorrencias: 9,
          cliente: "Loja Y",
          mensagem: "x@y.com",
        },
        {},
        {},
        { rota: "/quarto" },
      ],
    });
    assert.equal(r.saude, "amarelo");
    assert.equal(r.top_erros.length, 3);
    assert.doesNotMatch(JSON.stringify(r), /Secreta|Loja|x@y/);
    assert.equal(r.serie[0]?.acoes, 10);
  });

  it("entrada inválida vira zeros, não erro", () => {
    const r = montarResumoTv(null);
    assert.equal(r.erros_abertos, 0);
    assert.deepEqual(r.serie, []);
    assert.equal(r.saude, "verde");
  });
});

describe("painel de TV: lista nominal de clientes sem uso", () => {
  it("passa só nome e dias, corta nome longo e preserva 'nunca usou' (null)", () => {
    const lista = montarClientesSemUsoTv([
      { nome: "Loja Boa", dias_sem_uso: 12, email: "a@b.com", documento: "123" },
      { nome: "Clínica Nova", dias_sem_uso: null },
      { nome: `Nome com mais de sessenta caracteres para testar o corte do painel de TV` },
      { nome: "   ", dias_sem_uso: 4 },
      "lixo",
      { dias_sem_uso: 9 },
    ]);
    assert.deepEqual(lista, [
      { nome: "Loja Boa", dias_sem_uso: 12 },
      { nome: "Clínica Nova", dias_sem_uso: null },
      { nome: "Nome com mais de sessenta caracteres para testar o corte do", dias_sem_uso: null },
    ]);
    assert.equal(JSON.stringify(lista).includes("a@b.com"), false);
    assert.equal(JSON.stringify(lista).includes("123"), false);
  });

  it("limita a 20 e entrada inválida vira lista vazia", () => {
    const muitos = Array.from({ length: 30 }, (_, i) => ({
      nome: `Cliente ${i + 1}`,
      dias_sem_uso: i,
    }));
    assert.equal(montarClientesSemUsoTv(muitos).length, 20);
    assert.deepEqual(montarClientesSemUsoTv("lixo"), []);
    assert.deepEqual(montarResumoTv(null).clientes_sem_uso, []);
  });

  it("dias inválidos viram null, nunca número negativo", () => {
    assert.deepEqual(montarClientesSemUsoTv([{ nome: "Loja", dias_sem_uso: -3 }]), [
      { nome: "Loja", dias_sem_uso: null },
    ]);
    assert.deepEqual(montarClientesSemUsoTv([{ nome: "Loja", dias_sem_uso: "9" }]), [
      { nome: "Loja", dias_sem_uso: 9 },
    ]);
  });

  it("o resumo leva a lista e continua sem deixar passar campo desconhecido", () => {
    const r = montarResumoTv({
      clientes_sem_uso: [{ nome: "Loja Parada", dias_sem_uso: 21, email: "x@y.com" }],
    });
    assert.deepEqual(r.clientes_sem_uso, [{ nome: "Loja Parada", dias_sem_uso: 21 }]);
    assert.equal(JSON.stringify(r).includes("x@y.com"), false);
  });
});

describe("painel de TV: backup por cliente", () => {
  it("copia só contagens e datas válidas", () => {
    const b = montarBackupTv({
      clientes_ativos: 5,
      em_dia: 4,
      atrasados: 1,
      sem_backup: 0,
      com_erro: 1,
      ultimo_em: "2026-11-17T05:15:11.633+00:00",
      mais_antigo_em: "2026-11-16T05:00:00+00:00",
      caminho: "geral/abc/2026-11-17.ndjson.gz",
      cliente: "Clínica Secreta",
    });
    assert.deepEqual(Object.keys(b).sort(), [
      "atrasados",
      "clientes_ativos",
      "com_erro",
      "em_dia",
      "mais_antigo_em",
      "sem_backup",
      "ultimo_em",
    ]);
    assert.equal(b.em_dia, 4);
    assert.equal(JSON.stringify(b).includes("Secreta"), false);
    assert.equal(JSON.stringify(b).includes("ndjson"), false);
  });

  it("sem dado ou com lixo vira zero e data nula", () => {
    const b = montarBackupTv({ em_dia: -3, ultimo_em: "ontem", mais_antigo_em: 5 });
    assert.equal(b.em_dia, 0);
    assert.equal(b.ultimo_em, null);
    assert.equal(b.mais_antigo_em, null);
    assert.equal(montarResumoTv(undefined).backup.clientes_ativos, 0);
  });
});
