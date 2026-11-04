import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GRAVIDADES,
  ordenarFila,
  pesoGravidade,
  podeTransicionar,
  posicaoNaFila,
  type EntradaFila,
} from "../src/lib/fila-atendimento.ts";

const entrada = (
  id: string,
  gravidade: string,
  chegada_em: string,
  situacao: EntradaFila["situacao"] = "aguardando",
  encerrado_em: string | null = null,
): EntradaFila => ({ id, situacao, gravidade, chegada_em, encerrado_em });

describe("pesoGravidade", () => {
  it("emergência vem antes de urgente, que vem antes de comum", () => {
    assert.ok(pesoGravidade("emergencia") < pesoGravidade("urgente"));
    assert.ok(pesoGravidade("urgente") < pesoGravidade("comum"));
  });

  it("gravidade desconhecida vai para o fim", () => {
    assert.ok(pesoGravidade("outra") > pesoGravidade("comum"));
  });

  it("as três gravidades existem com rótulo", () => {
    assert.deepEqual(
      GRAVIDADES.map((g) => g.value),
      ["emergencia", "urgente", "comum"],
    );
  });
});

describe("podeTransicionar", () => {
  it("quem aguarda pode ser chamado ou desistir", () => {
    assert.equal(podeTransicionar("aguardando", "em_atendimento"), true);
    assert.equal(podeTransicionar("aguardando", "desistiu"), true);
    assert.equal(podeTransicionar("aguardando", "atendido"), false);
  });

  it("em atendimento pode concluir ou voltar para a fila", () => {
    assert.equal(podeTransicionar("em_atendimento", "atendido"), true);
    assert.equal(podeTransicionar("em_atendimento", "aguardando"), true);
    assert.equal(podeTransicionar("em_atendimento", "desistiu"), false);
  });

  it("atendido e desistiu são finais", () => {
    assert.equal(podeTransicionar("atendido", "aguardando"), false);
    assert.equal(podeTransicionar("desistiu", "aguardando"), false);
  });
});

describe("ordenarFila", () => {
  it("quem aguarda vem primeiro, por gravidade e depois por chegada", () => {
    const fila = ordenarFila([
      entrada("comum-antigo", "comum", "2026-11-04T08:00:00-03:00"),
      entrada("emergencia", "emergencia", "2026-11-04T10:00:00-03:00"),
      entrada("urgente", "urgente", "2026-11-04T09:00:00-03:00"),
      entrada("comum-novo", "comum", "2026-11-04T09:30:00-03:00"),
      entrada(
        "atendido",
        "comum",
        "2026-11-04T07:00:00-03:00",
        "atendido",
        "2026-11-04T08:30:00-03:00",
      ),
    ]);
    assert.deepEqual(
      fila.map((f) => f.id),
      ["emergencia", "urgente", "comum-antigo", "comum-novo", "atendido"],
    );
  });

  it("em atendimento fica entre quem aguarda e os encerrados; encerrados do mais novo para o mais antigo", () => {
    const fila = ordenarFila([
      entrada(
        "atendido-antigo",
        "comum",
        "2026-11-04T07:00:00-03:00",
        "atendido",
        "2026-11-04T08:00:00-03:00",
      ),
      entrada("em-aten", "comum", "2026-11-04T09:00:00-03:00", "em_atendimento"),
      entrada("aguardando", "comum", "2026-11-04T10:00:00-03:00"),
      entrada(
        "desistiu-novo",
        "urgente",
        "2026-11-04T08:00:00-03:00",
        "desistiu",
        "2026-11-04T09:30:00-03:00",
      ),
    ]);
    assert.deepEqual(
      fila.map((f) => f.id),
      ["aguardando", "em-aten", "desistiu-novo", "atendido-antigo"],
    );
  });
});

describe("posicaoNaFila", () => {
  const fila = ordenarFila([
    entrada("a", "comum", "2026-11-04T08:00:00-03:00"),
    entrada("b", "emergencia", "2026-11-04T10:00:00-03:00"),
    entrada("c", "urgente", "2026-11-04T09:00:00-03:00"),
  ]);

  it("conta só quem aguarda, na ordem de atendimento", () => {
    assert.equal(posicaoNaFila(fila, "b"), 1);
    assert.equal(posicaoNaFila(fila, "c"), 2);
    assert.equal(posicaoNaFila(fila, "a"), 3);
  });

  it("quem não está aguardando (ou não está na fila) não tem posição", () => {
    const comAtendido = [
      ...fila,
      entrada("x", "comum", "2026-11-04T07:00:00-03:00", "atendido", "2026-11-04T08:00:00-03:00"),
    ];
    assert.equal(posicaoNaFila(comAtendido, "x"), 0);
    assert.equal(posicaoNaFila(fila, "inexistente"), 0);
  });
});
