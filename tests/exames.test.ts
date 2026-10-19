import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agruparCampos,
  avisoDiferencial,
  calcularAbsoluto,
  formatarNumero,
  situacaoNaFaixa,
  valorDoResultado,
  valoresNumericos,
  variacao,
  type ResultadoExame,
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

const res = (id: string, nome: string, extra: Partial<ResultadoExame> = {}): ResultadoExame => ({
  id,
  ordem: 0,
  grupo: null,
  nome,
  unidade: null,
  forma: "numero",
  casas: 0,
  opcoes: null,
  total_id: null,
  pct_id: null,
  faixa_min: null,
  faixa_max: null,
  valor_num: null,
  valor_texto: null,
  nota: null,
  ...extra,
});

describe("formatarNumero e valorDoResultado", () => {
  it("usa as casas do campo e vírgula", () => {
    assert.equal(formatarNumero(13.3, 1), "13,3");
    assert.equal(formatarNumero(6600, 0), "6600");
    assert.equal(formatarNumero(2, 2), "2,00");
    assert.equal(formatarNumero(1.5, null), "1,5");
  });
  it("mostra traço quando não foi feito", () => {
    assert.equal(valorDoResultado(res("a", "A")), "—");
    assert.equal(valorDoResultado(res("a", "A", { valor_num: 13.3, casas: 1 })), "13,3");
    assert.equal(
      valorDoResultado(res("a", "A", { forma: "texto", valor_texto: "Turvo" })),
      "Turvo",
    );
    assert.equal(valorDoResultado(res("a", "A", { forma: "escolha" })), "—");
    assert.equal(valorDoResultado(res("a", "A", { valor_num: 0, casas: 0 })), "0");
  });
});

describe("situacaoNaFaixa", () => {
  it("destaca abaixo e acima; zero digitado conta", () => {
    assert.equal(situacaoNaFaixa(10, 12, 18), "abaixo");
    assert.equal(situacaoNaFaixa(19, 12, 18), "acima");
    assert.equal(situacaoNaFaixa(12, 12, 18), "dentro");
    assert.equal(situacaoNaFaixa(18, 12, 18), "dentro");
    assert.equal(situacaoNaFaixa(0, 1, 5), "abaixo");
  });
  it("faixa de um lado só e sem faixa", () => {
    assert.equal(situacaoNaFaixa(9500, null, 9000), "acima");
    assert.equal(situacaoNaFaixa(9, null, 9000), "dentro");
    assert.equal(situacaoNaFaixa(3, 5, null), "abaixo");
    assert.equal(situacaoNaFaixa(3, null, null), null);
  });
  it("sem valor não destaca nada", () => {
    assert.equal(situacaoNaFaixa(null, 12, 18), null);
    assert.equal(situacaoNaFaixa(Number.NaN, 12, 18), null);
  });
});

describe("calcularAbsoluto", () => {
  it("total × percentual ÷ 100 com as casas do campo", () => {
    assert.equal(calcularAbsoluto(6600, 40, 0), 2640);
    assert.equal(calcularAbsoluto(6600, 5, 0), 330);
    assert.equal(calcularAbsoluto(6600, 55, 0), 3630);
    assert.equal(calcularAbsoluto(10000, 33, 0), 3300);
    assert.equal(calcularAbsoluto(7777, 33, 0), 2566);
    assert.equal(calcularAbsoluto(7777, 33, 2), 2566.41);
  });
  it("falta um dos dois: em branco", () => {
    assert.equal(calcularAbsoluto(null, 40, 0), null);
    assert.equal(calcularAbsoluto(6600, null, 0), null);
    assert.equal(calcularAbsoluto(0, 40, 0), 0);
  });
});

describe("valoresNumericos e avisoDiferencial", () => {
  const lista = [
    res("total", "Leucócitos totais"),
    res("seg", "Segmentados (%)"),
    res("lin", "Linfócitos (%)"),
    res("segA", "Segmentados (abs.)", { forma: "calculado", total_id: "total", pct_id: "seg" }),
    res("linA", "Linfócitos (abs.)", { forma: "calculado", total_id: "total", pct_id: "lin" }),
  ];
  it("refaz os absolutos com o que está digitado", () => {
    const v = valoresNumericos(lista, { total: "6.600".replace(".", ""), seg: "40", lin: "60,0" });
    assert.equal(v["segA"], 2640);
    assert.equal(v["linA"], 3960);
    const parcial = valoresNumericos(lista, { total: "6600", seg: "40" });
    assert.equal(parcial["segA"], 2640);
    assert.equal(parcial["linA"], null);
    assert.equal(valoresNumericos(lista, { total: "abc", seg: "40" })["segA"], null);
  });
  it("avisa quando o diferencial todo preenchido não soma 100%", () => {
    assert.equal(
      avisoDiferencial(lista, valoresNumericos(lista, { total: "6600", seg: "40", lin: "60" })),
      null,
    );
    assert.match(
      avisoDiferencial(lista, valoresNumericos(lista, { total: "6600", seg: "40", lin: "50" })) ??
        "",
      /soma 90%/,
    );
  });
  it("não avisa com célula faltando ou sem total", () => {
    assert.equal(
      avisoDiferencial(lista, valoresNumericos(lista, { total: "6600", seg: "40" })),
      null,
    );
    assert.equal(avisoDiferencial(lista, valoresNumericos(lista, { seg: "40", lin: "10" })), null);
  });
  it("tolera arredondamento do laboratório (até 0,5)", () => {
    assert.equal(
      avisoDiferencial(lista, valoresNumericos(lista, { total: "6600", seg: "40,2", lin: "59,6" })),
      null,
    );
  });
});

describe("variacao", () => {
  it("compara com o valor anterior", () => {
    assert.equal(variacao(null, 10), null);
    assert.equal(variacao(10, 12), "subiu");
    assert.equal(variacao(12, 10), "desceu");
    assert.equal(variacao(10, 10), "igual");
  });
});
