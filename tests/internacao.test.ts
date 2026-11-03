import assert from "node:assert/strict";
import { test } from "node:test";

import {
  diasInternado,
  rotuloSituacaoInternacao,
  rotuloTipoOcorrencia,
  variacaoDePeso,
} from "../src/lib/internacao.ts";

test("dias de internação contam o dia da admissão como o 1º (relógio de Brasília)", () => {
  assert.equal(diasInternado("2026-11-02T13:00:00Z", new Date("2026-11-02T20:00:00Z")), 1);
  assert.equal(diasInternado("2026-11-02T13:00:00Z", new Date("2026-11-03T13:00:00Z")), 2);
  // 01h UTC ainda é o dia anterior em Brasília
  assert.equal(diasInternado("2026-11-02T22:00:00Z", new Date("2026-11-03T01:30:00Z")), 1);
  assert.equal(diasInternado("2026-11-02T22:00:00Z", new Date("2026-11-03T03:30:00Z")), 2);
  assert.equal(diasInternado("2026-11-05T10:00:00Z", new Date("2026-11-01T10:00:00Z")), 1);
});

test("variação de peso desde a primeira pesagem", () => {
  assert.equal(variacaoDePeso([{ peso_kg: 8, created_at: "2026-11-02T10:00:00Z" }]), null);
  assert.equal(
    variacaoDePeso([
      { peso_kg: 7.6, created_at: "2026-11-04T10:00:00Z" },
      { peso_kg: 8.4, created_at: "2026-11-02T10:00:00Z" },
      { peso_kg: 8, created_at: "2026-11-03T10:00:00Z" },
    ]),
    -0.8,
  );
});

test("rótulos da internação", () => {
  assert.equal(rotuloSituacaoInternacao("obito"), "Óbito");
  assert.equal(rotuloSituacaoInternacao("internado"), "Internado");
  assert.equal(rotuloTipoOcorrencia("transferencia"), "Transferência");
  assert.equal(rotuloTipoOcorrencia("medicacao"), "Medicação");
});

import {
  atrasoEmMinutos,
  corDaExecucao,
  descricaoDaFrequencia,
  textoDoPrazo,
} from "../src/lib/internacao.ts";

const agora = "2026-11-03T12:00:00Z";
const dose = (
  min: number,
  situacao: "pendente" | "executada" | "nao_executada" | "cancelada" = "pendente",
) => ({
  situacao,
  previsto_em: new Date(new Date(agora).getTime() + min * 60_000).toISOString(),
});

test("cor da dose no mapa de execuções", () => {
  assert.equal(corDaExecucao(dose(180), agora), "azul");
  assert.equal(corDaExecucao(dose(61), agora), "azul");
  assert.equal(corDaExecucao(dose(60), agora), "amarelo");
  assert.equal(corDaExecucao(dose(0), agora), "amarelo");
  assert.equal(corDaExecucao(dose(-15), agora), "amarelo");
  assert.equal(corDaExecucao(dose(-16), agora), "vermelho");
  assert.equal(corDaExecucao(dose(-600), agora), "vermelho");
  assert.equal(corDaExecucao(dose(-600, "executada"), agora), "verde");
  assert.equal(corDaExecucao(dose(-600, "nao_executada"), agora), "laranja");
  assert.equal(corDaExecucao(dose(30, "cancelada"), agora), "cinza");
});

test("atraso e texto do prazo", () => {
  assert.equal(atrasoEmMinutos("2026-11-03T11:30:00Z", agora), 30);
  assert.equal(textoDoPrazo(dose(40).previsto_em, agora), "em 40 min");
  assert.equal(textoDoPrazo(dose(150).previsto_em, agora), "em 2 h 30 min");
  assert.equal(textoDoPrazo(dose(0).previsto_em, agora), "agora");
  assert.equal(textoDoPrazo(dose(-25).previsto_em, agora), "atrasada 25 min");
  assert.equal(textoDoPrazo(dose(-120).previsto_em, agora), "atrasada 2 h");
});

test("descrição da frequência da prescrição", () => {
  assert.equal(descricaoDaFrequencia({ frequencia_horas: null, dias: null }), "Dose única");
  assert.equal(descricaoDaFrequencia({ frequencia_horas: 8, dias: 1 }), "A cada 8 h por 1 dia");
  assert.equal(descricaoDaFrequencia({ frequencia_horas: 12, dias: 5 }), "A cada 12 h por 5 dias");
});
