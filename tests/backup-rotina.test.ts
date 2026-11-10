import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LOTE_MAXIMO_BACKUP,
  LOTE_PADRAO_BACKUP,
  POLITICA_PADRAO,
  caminhoDoBackup,
  diaDeBrasilia,
  MAX_TENTATIVAS_POR_DIA,
  loteDaRodada,
  ordenarFila,
  politicaDoCliente,
  selecionarParaApagar,
  tiposDoDia,
  type ExecucaoBackup,
} from "../src/lib/backup-rotina.ts";

const dia = (n: number) => new Date(Date.UTC(2026, 0, n, 12)).toISOString().slice(0, 10);

describe("rotina de backup: calendário", () => {
  it("o dia é o de Brasília, mesmo de madrugada em UTC", () => {
    assert.equal(diaDeBrasilia(new Date("2026-11-10T02:30:00Z")), "2026-11-09");
    assert.equal(diaDeBrasilia(new Date("2026-11-10T12:00:00Z")), "2026-11-10");
  });

  it("todo dia é diário; domingo também é semanal; dia 1º também é mensal", () => {
    assert.deepEqual(tiposDoDia("2026-11-10"), ["diario"]); // terça
    assert.deepEqual(tiposDoDia("2026-11-08"), ["diario", "semanal"]); // domingo
    assert.deepEqual(tiposDoDia("2026-12-01"), ["diario", "mensal"]); // terça, dia 1º
    assert.deepEqual(tiposDoDia("2026-11-01"), ["diario", "semanal", "mensal"]); // domingo e dia 1º
  });

  it("lote da rodada: padrão, limite e valores inválidos", () => {
    assert.equal(loteDaRodada(null), LOTE_PADRAO_BACKUP);
    assert.equal(loteDaRodada("abc"), LOTE_PADRAO_BACKUP);
    assert.equal(loteDaRodada("0"), LOTE_PADRAO_BACKUP);
    assert.equal(loteDaRodada("5"), 5);
    assert.equal(loteDaRodada("999"), LOTE_MAXIMO_BACKUP);
  });
});

describe("rotina de backup: política por segmento", () => {
  it("clínica guarda mais que o padrão; sem segmento conhecido vale o padrão", () => {
    assert.deepEqual(politicaDoCliente([]), POLITICA_PADRAO);
    assert.deepEqual(politicaDoCliente(["lavarapido"]), POLITICA_PADRAO);
    assert.deepEqual(politicaDoCliente(["clinica"]), { diarios: 14, semanais: 8, mensais: 24 });
  });

  it("cliente com vários segmentos fica com o maior prazo", () => {
    assert.deepEqual(politicaDoCliente(["lavarapido", "clinica"]), {
      diarios: 14,
      semanais: 8,
      mensais: 24,
    });
  });

  it("caminho: pasta do segmento e do cliente, sem caracteres estranhos", () => {
    assert.equal(
      caminhoDoBackup("t1", ["petshop", "clinica"], "2026-11-10"),
      "clinica/t1/2026-11-10.ndjson.gz",
    );
    assert.equal(caminhoDoBackup("t1", [], "2026-11-10"), "geral/t1/2026-11-10.ndjson.gz");
    assert.equal(caminhoDoBackup("t1", ["../x"], "2026-11-10"), "x/t1/2026-11-10.ndjson.gz");
  });
});

describe("rotina de backup: retenção", () => {
  // 40 dias seguidos a partir de 1º/jan/2026 (quinta); domingos são semanais, dia 1º é mensal
  const todos: ExecucaoBackup[] = Array.from({ length: 40 }, (_, i) => ({
    id: `e${i + 1}`,
    dia: dia(i + 1),
    tipos: tiposDoDia(dia(i + 1)),
    situacao: "concluido",
  }));

  it("mantém os N últimos diários e os semanais e mensais dentro dos limites", () => {
    const apagar = new Set(selecionarParaApagar(todos, POLITICA_PADRAO));
    const manter = todos.filter((e) => !apagar.has(e.id));
    // os 7 últimos dias (e34 a e40) ficam
    for (let i = 34; i <= 40; i++) assert.ok(!apagar.has(`e${i}`), `e${i}`);
    // dia 15 (quinta, não é domingo nem 1º) já saiu
    assert.ok(apagar.has("e15"));
    // domingos: 11, 18 e 25 de jan, 1º e 8 de fev → os 4 mais recentes ficam
    assert.ok(!apagar.has("e39")); // 8/fev
    assert.ok(!apagar.has("e32")); // 1º/fev (também mensal)
    assert.ok(!apagar.has("e25"));
    assert.ok(!apagar.has("e18"));
    assert.ok(apagar.has("e11")); // o quinto domingo mais recente sai
    assert.ok(apagar.has("e4"));
    // 1º/jan é o mensal mais antigo, mas 12 mensais cabem: continua
    assert.ok(!apagar.has("e1"));
    assert.ok(manter.length < todos.length);
  });

  it("política maior guarda mais", () => {
    const padrao = selecionarParaApagar(todos, POLITICA_PADRAO).length;
    const clinica = selecionarParaApagar(todos, politicaDoCliente(["clinica"])).length;
    assert.ok(clinica < padrao);
  });

  it("só considera concluídos: erro, em andamento e expirado nunca entram na conta", () => {
    const mistos: ExecucaoBackup[] = [
      { id: "a", dia: "2026-01-05", tipos: ["diario"], situacao: "erro" },
      { id: "b", dia: "2026-01-06", tipos: ["diario"], situacao: "em_andamento" },
      { id: "c", dia: "2026-01-07", tipos: ["diario"], situacao: "expirado" },
      { id: "d", dia: "2026-01-08", tipos: ["diario"], situacao: "concluido" },
    ];
    assert.deepEqual(selecionarParaApagar(mistos, { diarios: 1, semanais: 0, mensais: 0 }), []);
  });

  it("nunca apaga o backup mais recente, mesmo com política zerada de semanal e mensal", () => {
    const um: ExecucaoBackup[] = [
      { id: "x", dia: "2026-01-02", tipos: ["diario"], situacao: "concluido" },
      { id: "y", dia: "2026-01-03", tipos: ["diario"], situacao: "concluido" },
    ];
    assert.deepEqual(selecionarParaApagar(um, { diarios: 1, semanais: 0, mensais: 0 }), ["x"]);
  });
});

describe("rotina de backup: fila do dia", () => {
  it("quem nunca foi tentado vem antes de quem já falhou, mantendo a ordem original", () => {
    const falhas = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    assert.deepEqual(ordenarFila(["a", "b", "c", "d"], falhas), ["c", "d", "a", "b"]);
  });

  it("cliente que falhou demais no dia sai da fila; os outros não são barrados por ele", () => {
    const falhas = new Map([["a", MAX_TENTATIVAS_POR_DIA]]);
    assert.deepEqual(ordenarFila(["a", "b"], falhas), ["b"]);
    assert.deepEqual(ordenarFila([], new Map()), []);
  });
});
