import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  novaOperacao,
  ordenar,
  reabrir,
  resumoDaFila,
  situacaoNaFila,
  sincronizar,
  type MudancaFila,
  type OperacaoFila,
} from "../src/lib/fila-clinica.ts";

const rede = (m: string) => /fetch|network|failed|load failed|internet/i.test(m);
const t = (n: number) => new Date(2026, 9, 19, 10, n, 0);
const op = (id: string, n: number, dependeDe: string[] = []) =>
  novaOperacao({ tipo: "teste", descricao: `op ${id}`, payload: { id }, dependeDe }, id, t(n));

describe("fila: ordem e situação", () => {
  it("ordena pela hora em que foi feita", () => {
    assert.deepEqual(
      ordenar([op("c", 3), op("a", 1), op("b", 2)]).map((o) => o.id),
      ["a", "b", "c"],
    );
  });
  it("pronta, aguardando e bloqueada", () => {
    const a = op("a", 1);
    const b = op("b", 2, ["a"]);
    const c = op("c", 3, ["b"]);
    const fila = [a, b, c];
    assert.equal(situacaoNaFila(a, fila), "pronta");
    assert.equal(situacaoNaFila(b, fila), "aguardando");
    assert.equal(situacaoNaFila(c, fila), "aguardando");
    const recusada = [{ ...a, estado: "recusada" as const, erro: "x" }, b, c];
    assert.equal(situacaoNaFila(recusada[0]!, recusada), "recusada");
    assert.equal(situacaoNaFila(b, recusada), "bloqueada");
    assert.equal(situacaoNaFila(c, recusada), "bloqueada");
  });
  it("dependência que já saiu da fila não segura mais", () => {
    assert.equal(situacaoNaFila(op("b", 2, ["a"]), [op("b", 2, ["a"])]), "pronta");
  });
  it("resumo conta cada situação", () => {
    const a = { ...op("a", 1), estado: "recusada" as const };
    const r = resumoDaFila([a, op("b", 2, ["a"]), op("c", 3), op("d", 4, ["c"])]);
    assert.deepEqual(r, { total: 4, prontas: 1, aguardando: 1, bloqueadas: 1, recusadas: 1 });
  });
  it("reabrir só mexe em operação recusada", () => {
    const a = { ...op("a", 1), estado: "recusada" as const, erro: "x" };
    const fila = reabrir([a, op("b", 2)], "a");
    assert.equal(fila[0]!.estado, "pendente");
    assert.equal(fila[0]!.erro, null);
    assert.equal(reabrir([op("b", 2)], "b")[0]!.estado, "pendente");
  });
});

describe("sincronizar", () => {
  it("envia em ordem, tira da fila o que saiu e avisa cada mudança", async () => {
    const enviadas: string[] = [];
    const mudancas: MudancaFila[] = [];
    const r = await sincronizar(
      [op("b", 2, ["a"]), op("a", 1), op("c", 3)],
      async (o) => void enviadas.push(o.id),
      {
        ehErroDeRede: rede,
        aoMudar: (m) => void mudancas.push(m),
      },
    );
    assert.deepEqual(enviadas, ["a", "b", "c"]);
    assert.equal(r.enviadas, 3);
    assert.equal(r.fila.length, 0);
    assert.equal(r.interrompida, false);
    assert.deepEqual(
      mudancas.map((m) => m.tipo),
      ["remover", "remover", "remover"],
    );
  });

  it("a chave de repetição que vai ao banco é o id da operação", async () => {
    let chave = "";
    await sincronizar([op("abc-123", 1)], async (o) => void (chave = o.id), { ehErroDeRede: rede });
    assert.equal(chave, "abc-123");
  });

  it("erro de conexão interrompe sem marcar ninguém como recusado", async () => {
    const enviadas: string[] = [];
    const r = await sincronizar(
      [op("a", 1), op("b", 2), op("c", 3)],
      async (o) => {
        if (o.id === "b") throw new Error("Failed to fetch");
        enviadas.push(o.id);
      },
      { ehErroDeRede: rede },
    );
    assert.deepEqual(enviadas, ["a"]);
    assert.equal(r.interrompida, true);
    assert.deepEqual(
      r.fila.map((o) => [o.id, o.estado, o.tentativas]),
      [
        ["b", "pendente", 0],
        ["c", "pendente", 0],
      ],
    );
  });

  it("recusa do banco guarda o erro, bloqueia quem depende e segue com o resto", async () => {
    const enviadas: string[] = [];
    const mudancas: MudancaFila[] = [];
    const r = await sincronizar(
      [op("a", 1), op("b", 2, ["a"]), op("c", 3)],
      async (o) => {
        if (o.id === "a") throw new Error("O lote acabou");
        enviadas.push(o.id);
      },
      { ehErroDeRede: rede, agora: () => t(30), aoMudar: (m) => void mudancas.push(m) },
    );
    assert.deepEqual(enviadas, ["c"]);
    assert.equal(r.recusadas, 1);
    assert.equal(r.enviadas, 1);
    assert.equal(r.interrompida, false);
    const a = r.fila.find((o) => o.id === "a") as OperacaoFila;
    assert.equal(a.estado, "recusada");
    assert.equal(a.erro, "O lote acabou");
    assert.equal(a.tentativas, 1);
    assert.equal(a.ultimaTentativaEm, t(30).toISOString());
    assert.deepEqual(r.fila.map((o) => o.id).sort(), ["a", "b"]);
    assert.equal(
      situacaoNaFila(r.fila.find((o) => o.id === "b") as OperacaoFila, r.fila),
      "bloqueada",
    );
    assert.deepEqual(
      mudancas.map((m) => m.tipo),
      ["atualizar", "remover"],
    );
  });

  it("operação recusada nunca some sozinha e só sai depois de reaberta e enviada", async () => {
    const falha = async () => {
      throw new Error("Recusado");
    };
    let r = await sincronizar([op("a", 1)], falha, { ehErroDeRede: rede });
    r = await sincronizar(r.fila, falha, { ehErroDeRede: rede });
    assert.equal(r.fila.length, 1);
    assert.equal(r.fila[0]!.estado, "recusada");
    assert.equal(r.enviadas, 0);
    const reaberta = reabrir(r.fila, "a");
    r = await sincronizar(reaberta, async () => undefined, { ehErroDeRede: rede });
    assert.equal(r.fila.length, 0);
    assert.equal(r.enviadas, 1);
  });

  it("não tenta de novo na mesma rodada a operação que acabou de ser recusada", async () => {
    let chamadas = 0;
    await sincronizar(
      [op("a", 1)],
      async () => {
        chamadas++;
        throw new Error("Recusado");
      },
      { ehErroDeRede: rede },
    );
    assert.equal(chamadas, 1);
  });

  it("a mudança é gravada antes de seguir (se parar no meio, o que saiu já foi registrado)", async () => {
    const mudancas: string[] = [];
    await sincronizar(
      [op("a", 1), op("b", 2)],
      async (o) => {
        if (o.id === "b") throw new Error("Failed to fetch");
      },
      {
        ehErroDeRede: rede,
        aoMudar: (m) =>
          void mudancas.push(m.tipo === "remover" ? `saiu ${m.id}` : `ficou ${m.op.id}`),
      },
    );
    assert.deepEqual(mudancas, ["saiu a"]);
  });
});
