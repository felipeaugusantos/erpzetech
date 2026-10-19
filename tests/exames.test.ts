import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agruparCampos,
  erroDaFaixa,
  erroDoCampo,
  numeroOuNulo,
  opcoesDoTexto,
  rotuloFaixa,
  type CampoExame,
  type FormCampo,
} from "../src/lib/exames.ts";

const campo = (id: string, ordem: number, grupo: string | null): CampoExame => ({
  id,
  ordem,
  grupo,
  nome: id,
  unidade: null,
  forma: "numero",
  casas: 1,
  opcoes: null,
  observacao: null,
  ativo: true,
  total_campo_id: null,
  pct_campo_id: null,
  referencias: [],
});

const base: FormCampo = {
  nome: "Hemoglobina",
  grupo: "Eritrograma",
  unidade: "g/dL",
  forma: "numero",
  casas: "1",
  opcoes: "",
  total_campo_id: "",
  pct_campo_id: "",
};

describe("numeroOuNulo", () => {
  it("aceita vírgula e ponto", () => {
    assert.equal(numeroOuNulo("13,3"), 13.3);
    assert.equal(numeroOuNulo(" 13.3 "), 13.3);
    assert.equal(numeroOuNulo("0"), 0);
  });
  it("vazio é nulo e texto avisa com NaN", () => {
    assert.equal(numeroOuNulo(""), null);
    assert.equal(numeroOuNulo("  "), null);
    assert.ok(Number.isNaN(numeroOuNulo("abc")));
    assert.ok(Number.isNaN(numeroOuNulo("1,2,3")));
  });
});

describe("rotuloFaixa", () => {
  it("mostra os dois lados, só um lado ou traço", () => {
    assert.equal(rotuloFaixa({ minimo: 12, maximo: 18 }, "g/dL"), "12 a 18 g/dL");
    assert.equal(rotuloFaixa({ minimo: null, maximo: 9000 }), "até 9000");
    assert.equal(rotuloFaixa({ minimo: 0.7, maximo: null }, "mg/dL"), "a partir de 0,7 mg/dL");
    assert.equal(rotuloFaixa(undefined), "—");
    assert.equal(rotuloFaixa({ minimo: null, maximo: null }), "—");
  });
});

describe("agruparCampos", () => {
  it("mantém a ordem do modelo e junta por grupo", () => {
    const g = agruparCampos([
      campo("c", 2, "B"),
      campo("a", 0, "A"),
      campo("d", 3, "A"),
      campo("b", 1, null),
    ]);
    assert.deepEqual(
      g.map((x) => [x.grupo, x.campos.map((c) => c.id)]),
      [
        ["A", ["a", "d"]],
        ["", ["b"]],
        ["B", ["c"]],
      ],
    );
  });
});

describe("opcoesDoTexto", () => {
  it("tira linhas vazias e repetidas", () => {
    assert.deepEqual(opcoesDoTexto("Negativo\n\n + \nNegativo\n++"), ["Negativo", "+", "++"]);
  });
});

describe("erroDoCampo", () => {
  it("campo numérico válido passa", () => {
    assert.equal(erroDoCampo(base), null);
  });
  it("pede nome e confere casas", () => {
    assert.match(erroDoCampo({ ...base, nome: " " }) ?? "", /nome/i);
    assert.match(erroDoCampo({ ...base, casas: "7" }) ?? "", /Casas/);
    assert.match(erroDoCampo({ ...base, casas: "1,5" }) ?? "", /Casas/);
  });
  it("escolha precisa de opções", () => {
    assert.match(erroDoCampo({ ...base, forma: "escolha" }) ?? "", /opções/);
    assert.equal(erroDoCampo({ ...base, forma: "escolha", opcoes: "Sim\nNão" }), null);
  });
  it("calculado precisa de total e percentual diferentes", () => {
    assert.match(erroDoCampo({ ...base, forma: "calculado" }) ?? "", /total/);
    assert.match(
      erroDoCampo({ ...base, forma: "calculado", total_campo_id: "a", pct_campo_id: "a" }) ?? "",
      /diferentes/,
    );
    assert.equal(
      erroDoCampo({ ...base, forma: "calculado", total_campo_id: "a", pct_campo_id: "b" }),
      null,
    );
  });
  it("texto não pede casas", () => {
    assert.equal(erroDoCampo({ ...base, forma: "texto", casas: "99" }), null);
  });
});

describe("erroDaFaixa", () => {
  it("aceita um lado só e os dois em branco", () => {
    assert.equal(erroDaFaixa("", ""), null);
    assert.equal(erroDaFaixa("1,5", ""), null);
    assert.equal(erroDaFaixa("", "9000"), null);
  });
  it("recusa texto e mínimo maior que o máximo", () => {
    assert.match(erroDaFaixa("a", "2") ?? "", /números/);
    assert.match(erroDaFaixa("5", "2") ?? "", /mínimo/);
    assert.equal(erroDaFaixa("2", "2"), null);
  });
});
