import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acertoDaCaucao,
  avariaVazia,
  erroDaVistoria,
  totalDasAvarias,
  valorDigitado,
  valorSugeridoPerdaTotal,
  vistoriasParaEnvio,
  type VistoriaForm,
} from "../src/lib/vistoria-locacao.ts";

const vist = (avarias: VistoriaForm["avarias"], observacoes = ""): VistoriaForm => ({
  equipamentoId: "e1",
  nome: "Betoneira",
  valorAquisicao: 4000,
  avarias,
  observacoes,
});

describe("valorDigitado", () => {
  it("aceita vírgula e ponto; vazio é nulo; texto é NaN", () => {
    assert.equal(valorDigitado("120,50"), 120.5);
    assert.equal(valorDigitado("80"), 80);
    assert.equal(valorDigitado("  "), null);
    assert.ok(Number.isNaN(valorDigitado("abc")));
    assert.ok(Number.isNaN(valorDigitado("-5")));
  });
});

describe("acerto do dano com a caução", () => {
  it("dano maior que a caução: abate tudo e cobra a diferença", () => {
    assert.deepEqual(acertoDaCaucao(100, 150), { abatida: 100, aCobrar: 50, aDevolver: 0 });
  });
  it("dano menor que a caução: não cobra e devolve o resto", () => {
    assert.deepEqual(acertoDaCaucao(500, 300), { abatida: 300, aCobrar: 0, aDevolver: 200 });
  });
  it("sem dano devolve a caução inteira; sem caução cobra tudo", () => {
    assert.deepEqual(acertoDaCaucao(200, 0), { abatida: 0, aCobrar: 0, aDevolver: 200 });
    assert.deepEqual(acertoDaCaucao(0, 80), { abatida: 0, aCobrar: 80, aDevolver: 0 });
  });
  it("centavos não acumulam erro", () => {
    assert.deepEqual(acertoDaCaucao(0.1, 0.3), { abatida: 0.1, aCobrar: 0.2, aDevolver: 0 });
  });
});

describe("totais e conferência", () => {
  it("soma todas as avarias de todos os equipamentos", () => {
    const a = vist([{ descricao: "Cabo", valor: "120,50", perdaTotal: false }]);
    const b = vist([{ descricao: "Pintura", valor: "29,50", perdaTotal: false }, avariaVazia()]);
    assert.equal(totalDasAvarias([a, b]), 150);
  });
  it("avaria precisa de descrição e valor (zero vale)", () => {
    assert.equal(erroDaVistoria([vist([])]), null);
    assert.match(erroDaVistoria([vist([avariaVazia()])]) ?? "", /descreva/);
    assert.match(
      erroDaVistoria([vist([{ descricao: "Cabo", valor: "", perdaTotal: false }])]) ?? "",
      /valor/,
    );
    assert.match(
      erroDaVistoria([vist([{ descricao: "Cabo", valor: "abc", perdaTotal: false }])]) ?? "",
      /confira/,
    );
    assert.equal(
      erroDaVistoria([vist([{ descricao: "Arranhão leve", valor: "0", perdaTotal: false }])]),
      null,
    );
  });
  it("perda total sugere o valor de aquisição", () => {
    assert.equal(valorSugeridoPerdaTotal(4000), "4000,00");
    assert.equal(valorSugeridoPerdaTotal(0), "");
  });
});

describe("envio", () => {
  it("manda um item por equipamento, com o valor como número e sem espaços", () => {
    const r = vistoriasParaEnvio([
      vist([{ descricao: " Cabo ", valor: "120,50", perdaTotal: true }], " partido "),
    ]);
    assert.deepEqual(r, [
      {
        equipamento_id: "e1",
        observacoes: "partido",
        avarias: [{ descricao: "Cabo", valor: "120.5", perda_total: true }],
      },
    ]);
  });
});
