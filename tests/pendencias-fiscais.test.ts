import assert from "node:assert/strict";
import test from "node:test";

import {
  MINUTOS_SEM_RETORNO,
  classificarNota,
  contarPorTipo,
  rotuloProvedor,
  type NotaPendente,
} from "../src/lib/pendencias-fiscais.ts";

const agora = new Date("2026-10-16T12:00:00Z");
const nota = (parcial: Partial<NotaPendente>): NotaPendente => ({
  situacao: "autorizada",
  modelo: "nfe",
  updated_at: "2026-10-16T11:59:00Z",
  transmitida_em: null,
  ...parcial,
});

test("nota autorizada ou cancelada não é pendência", () => {
  assert.equal(classificarNota(nota({ situacao: "autorizada" }), agora), null);
  assert.equal(classificarNota(nota({ situacao: "cancelada" }), agora), null);
  assert.equal(classificarNota(nota({ situacao: "pronta" }), agora), null);
});

test("rejeitada e em contingência são pendências", () => {
  assert.equal(classificarNota(nota({ situacao: "rejeitada" }), agora), "rejeitada");
  assert.equal(
    classificarNota(nota({ situacao: "contingencia", modelo: "nfce" }), agora),
    "contingencia",
  );
});

test("rascunho só é pendência na NFC-e (o da NF-e é trabalho em andamento)", () => {
  assert.equal(classificarNota(nota({ situacao: "rascunho", modelo: "nfce" }), agora), "rascunho");
  assert.equal(classificarNota(nota({ situacao: "rascunho", modelo: "nfe" }), agora), null);
});

test("nota enviada espera o prazo antes de virar pendência", () => {
  const dentro = new Date(agora.getTime() - (MINUTOS_SEM_RETORNO - 1) * 60_000).toISOString();
  const fora = new Date(agora.getTime() - (MINUTOS_SEM_RETORNO + 1) * 60_000).toISOString();
  assert.equal(
    classificarNota(nota({ situacao: "transmitida", transmitida_em: dentro }), agora),
    null,
  );
  assert.equal(
    classificarNota(nota({ situacao: "transmitida", transmitida_em: fora }), agora),
    "sem_retorno",
  );
});

test("sem data de envio usa a última atualização; data inválida conta como pendência", () => {
  assert.equal(
    classificarNota(nota({ situacao: "transmitida", updated_at: "2026-10-16T10:00:00Z" }), agora),
    "sem_retorno",
  );
  assert.equal(
    classificarNota(nota({ situacao: "transmitida", transmitida_em: "ontem" }), agora),
    "sem_retorno",
  );
});

test("contarPorTipo soma cada tipo", () => {
  const total = contarPorTipo(
    [
      nota({ situacao: "rejeitada" }),
      nota({ situacao: "rejeitada" }),
      nota({ situacao: "contingencia" }),
      nota({ situacao: "autorizada" }),
    ],
    agora,
  );
  assert.deepEqual(total, { rejeitada: 2, contingencia: 1, sem_retorno: 0, rascunho: 0 });
});

test("provedor conhecido ganha nome em português; desconhecido aparece como veio", () => {
  assert.equal(rotuloProvedor("pix"), "Pix");
  assert.equal(rotuloProvedor("asaas"), "asaas");
});
