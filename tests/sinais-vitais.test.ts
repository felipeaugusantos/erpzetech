import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agruparSeries,
  cadeiaDoRegistro,
  datetimeLocalAgora,
  descreverRegistro,
  formatarValor,
  isoDeDatetimeLocal,
  lerValor,
  podeCorrigir,
  pontosGrafico,
  validarFormulario,
  type RegistroSinal,
} from "../src/lib/sinais-vitais.ts";

let seq = 0;
function reg(p: Partial<RegistroSinal>): RegistroSinal {
  seq += 1;
  return {
    id: `r${seq}`,
    parametro_id: "p1",
    parametro: "Temperatura",
    unidade: "°C",
    valor: 38,
    observacao: null,
    medido_em: "2026-11-05T10:00:00Z",
    registrado_em: "2026-11-05T10:01:00Z",
    profissional_id: "pa",
    profissional: "Aux",
    funcao: "auxiliar",
    corrige_id: null,
    motivo_correcao: null,
    anulado: false,
    substituido_por: null,
    corrente: true,
    ...p,
  };
}

describe("sinais vitais: valor", () => {
  it("aceita vírgula e ponto; vazio é sem valor; recusa notação científica e texto", () => {
    assert.deepEqual(lerValor("38,5"), { ok: true, valor: 38.5 });
    assert.deepEqual(lerValor(" 38.5 "), { ok: true, valor: 38.5 });
    assert.deepEqual(lerValor("-2"), { ok: true, valor: -2 });
    assert.deepEqual(lerValor(""), { ok: true, valor: null });
    for (const ruim of ["abc", "1e5", "NaN", "Infinity", "1,2,3", "1234567", "38,55555", "--1"]) {
      assert.equal(lerValor(ruim).ok, false, ruim);
    }
  });
  it("zero é zero e ausência é traço: nunca se confundem", () => {
    assert.deepEqual(lerValor("0"), { ok: true, valor: 0 });
    assert.equal(formatarValor(0, "mg/dL"), "0 mg/dL");
    assert.equal(formatarValor(null, "mg/dL"), "—");
    assert.equal(formatarValor(38.5, "°C"), "38,5 °C");
  });
  it("descreve o registro: valor, não medido com motivo, anulado", () => {
    assert.equal(descreverRegistro(reg({ valor: 0 })), "0 °C");
    assert.equal(
      descreverRegistro(reg({ valor: null, observacao: "Animal agitado" })),
      "Não medido: Animal agitado",
    );
    assert.equal(descreverRegistro(reg({ valor: null })), "Não medido");
    assert.equal(
      descreverRegistro(reg({ valor: null, anulado: true, corrente: false })),
      "Anulado",
    );
  });
});

describe("sinais vitais: séries", () => {
  it("agrupa por parâmetro, ordena pelo horário da medição e só mostra o que vale", () => {
    const a = reg({ id: "a", medido_em: "2026-11-05T12:00:00Z", valor: 39 });
    const b = reg({
      id: "b",
      medido_em: "2026-11-05T08:00:00Z",
      valor: 38,
      corrente: false,
      substituido_por: "c",
    });
    const c = reg({
      id: "c",
      medido_em: "2026-11-05T08:00:00Z",
      valor: 38.2,
      corrige_id: "b",
      motivo_correcao: "erro",
    });
    const fc = reg({
      id: "d",
      parametro_id: "p2",
      parametro: "Frequência cardíaca",
      unidade: "bpm",
      valor: 120,
    });
    const series = agruparSeries([a, b, c, fc]);
    assert.deepEqual(
      series.map((s) => s.nome),
      ["Frequência cardíaca", "Temperatura"],
    );
    const temp = series[1]!;
    assert.deepEqual(
      temp.correntes.map((r) => r.id),
      ["c", "a"],
    );
    assert.equal(temp.historico.length, 3);
    assert.equal(temp.ultimo?.id, "a");
  });
  it("série só com 'não medido' não tem último valor; anulado não vale", () => {
    const s = agruparSeries([
      reg({ id: "x", valor: null, observacao: "agitado" }),
      reg({
        id: "y",
        valor: null,
        anulado: true,
        corrente: false,
        corrige_id: "z",
        motivo_correcao: "erro",
      }),
    ])[0]!;
    assert.equal(s.ultimo, null);
    assert.deepEqual(
      s.correntes.map((r) => r.id),
      ["x"],
    );
  });
  it("sem registros não há série (ausência de medida não vira zero)", () => {
    assert.deepEqual(agruparSeries([]), []);
  });
  it("a série usa o nome e a unidade do registro mais recente, não os do catálogo", () => {
    const s = agruparSeries([
      reg({ id: "1", medido_em: "2026-11-05T08:00:00Z", parametro: "Temperatura", unidade: "°C" }),
      reg({ id: "2", medido_em: "2026-11-05T09:00:00Z", parametro: "Temperatura", unidade: "°C" }),
    ])[0]!;
    assert.equal(s.unidade, "°C");
  });
});

describe("sinais vitais: correções", () => {
  const o = reg({ id: "o", corrente: false, substituido_por: "c1" });
  const c1 = reg({
    id: "c1",
    corrige_id: "o",
    motivo_correcao: "m1",
    corrente: false,
    substituido_por: "c2",
  });
  const c2 = reg({ id: "c2", corrige_id: "c1", motivo_correcao: "m2" });
  it("monta a cadeia do original até a última versão, a partir de qualquer ponto", () => {
    for (const id of ["o", "c1", "c2"]) {
      assert.deepEqual(
        cadeiaDoRegistro([c2, o, c1], id).map((r) => r.id),
        ["o", "c1", "c2"],
        id,
      );
    }
    assert.deepEqual(cadeiaDoRegistro([o], "nao-existe"), []);
  });
  it("não entra em laço com dado inconsistente", () => {
    const x = reg({ id: "x", corrige_id: "y", substituido_por: "y" });
    const y = reg({ id: "y", corrige_id: "x", substituido_por: "x" });
    assert.ok(cadeiaDoRegistro([x, y], "x").length <= 2);
  });
  it("quem pode tentar corrigir: veterinário ou autor, internação aberta, registro que vale", () => {
    const r = reg({ profissional_id: "pa" });
    assert.equal(podeCorrigir(r, false, "pa", true), true);
    assert.equal(podeCorrigir(r, false, "outro", true), false);
    assert.equal(podeCorrigir(r, true, "outro", true), true);
    assert.equal(podeCorrigir(r, true, "pa", false), false);
    assert.equal(podeCorrigir(reg({ corrente: false }), true, "pa", true), false);
    assert.equal(podeCorrigir(reg({ anulado: true, corrente: false }), true, "pa", true), false);
  });
});

describe("sinais vitais: gráfico", () => {
  it("X pelo horário e Y do menor ao maior valor, sem inventar faixa", () => {
    const g = pontosGrafico(
      [
        reg({ id: "1", medido_em: "2026-11-05T08:00:00Z", valor: 38 }),
        reg({ id: "2", medido_em: "2026-11-05T10:00:00Z", valor: 40 }),
        reg({ id: "3", medido_em: "2026-11-05T12:00:00Z", valor: 39 }),
      ],
      300,
      80,
      10,
    );
    assert.deepEqual(
      g.pontos.map((p) => p.x),
      [10, 150, 290],
    );
    assert.equal(g.pontos[0]!.y, 70); // menor valor embaixo
    assert.equal(g.pontos[1]!.y, 10); // maior valor em cima
    assert.equal(g.min, 38);
    assert.equal(g.max, 40);
    assert.equal(g.linha, "10,70 150,10 290,40");
  });
  it("um ponto fica no centro; valores iguais ficam na linha do meio; zero conta como ponto", () => {
    const um = pontosGrafico([reg({ id: "1", valor: 0 })], 300, 80);
    assert.deepEqual([um.pontos[0]!.x, um.pontos[0]!.y, um.pontos[0]!.valor], [150, 40, 0]);
    const iguais = pontosGrafico(
      [
        reg({ id: "1", medido_em: "2026-11-05T08:00:00Z" }),
        reg({ id: "2", medido_em: "2026-11-05T09:00:00Z" }),
      ],
      300,
      80,
    );
    assert.ok(iguais.pontos.every((p) => p.y === 40));
  });
  it("não desenha 'não medido' nem anulado; sem pontos devolve vazio", () => {
    const g = pontosGrafico(
      [
        reg({ valor: null, observacao: "agitado" }),
        reg({ valor: null, anulado: true, corrente: false }),
      ],
      300,
      80,
    );
    assert.deepEqual(g.pontos, []);
    assert.equal(g.linha, "");
  });
});

describe("sinais vitais: formulário", () => {
  // horários relativos a um "agora" fixo, para valer em qualquer fuso do aparelho
  const agora = new Date("2026-11-05T15:00:00Z");
  const h = (horas: number) => new Date(agora.getTime() + horas * 3_600_000);
  const base = {
    parametroId: "p1",
    valorTexto: "38,5",
    observacao: "",
    medidoEmLocal: datetimeLocalAgora(h(-1)),
    admitidoEm: h(-10).toISOString(),
    agora,
  };
  it("aceita o preenchimento correto", () => {
    assert.equal(validarFormulario(base), null);
    assert.equal(validarFormulario({ ...base, valorTexto: "0" }), null);
    assert.equal(
      validarFormulario({ ...base, valorTexto: "", observacao: "Animal agitado" }),
      null,
    );
  });
  it("recusa o que o banco recusaria", () => {
    assert.match(validarFormulario({ ...base, parametroId: "" }) ?? "", /parâmetro/);
    assert.match(validarFormulario({ ...base, valorTexto: "" }) ?? "", /valor ou explique/);
    assert.match(validarFormulario({ ...base, valorTexto: "abc" }) ?? "", /números/);
    assert.match(validarFormulario({ ...base, observacao: "x".repeat(301) }) ?? "", /300/);
    assert.match(
      validarFormulario({ ...base, medidoEmLocal: datetimeLocalAgora(h(24)) }) ?? "",
      /futuro/,
    );
    assert.match(
      validarFormulario({ ...base, medidoEmLocal: datetimeLocalAgora(h(-11)) }) ?? "",
      /admissão/,
    );
    assert.match(validarFormulario({ ...base, medidoEmLocal: "lixo" }) ?? "", /inválido/);
  });
  it("datetime-local: ida e volta e agora no horário do aparelho", () => {
    assert.equal(isoDeDatetimeLocal(""), null);
    assert.equal(isoDeDatetimeLocal("lixo"), null);
    const iso = isoDeDatetimeLocal("2026-11-05T10:00");
    assert.equal(new Date(iso ?? "").getTime(), new Date("2026-11-05T10:00").getTime());
    const agora = new Date("2026-11-05T15:00:00Z");
    assert.equal(
      new Date(`${datetimeLocalAgora(agora)}`).getTime(),
      Math.floor(agora.getTime() / 60_000) * 60_000,
    );
  });
});
