import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  especificidade,
  melhoresRegras,
  regraCasa,
  resolverTributacao,
  validarRegra,
  type ContextoFiscal,
  type RegraFiscal,
} from "../src/lib/fiscal-regras.ts";

const ctx = (parcial: Partial<ContextoFiscal> = {}): ContextoFiscal => ({
  ncm: "23091000",
  data: "2027-03-10",
  operacao: "venda",
  regime: "normal",
  ...parcial,
});

let seq = 0;
const regra = (
  parcial: Partial<RegraFiscal> & { perfil?: RegraFiscal["perfil"] } = {},
): RegraFiscal => ({
  id: `r${++seq}`,
  ncmPrefixo: "2309",
  vigenciaInicio: "2027-01-01",
  versao: 1,
  ativa: true,
  perfil: { cfop: "5102" },
  ...parcial,
});

describe("validarRegra", () => {
  it("aceita uma regra bem formada", () => {
    assert.deepEqual(
      validarRegra(regra({ cest: "1700100", ufDestino: "SP", vigenciaFim: "2027-12-31" })),
      [],
    );
  });
  it("recusa prefixo, CEST, UF, datas e versão fora do formato", () => {
    assert.equal(validarRegra(regra({ ncmPrefixo: "2" })).length, 1);
    assert.equal(validarRegra(regra({ ncmPrefixo: "230910000" })).length, 1);
    assert.equal(validarRegra(regra({ ncmPrefixo: "23.09" })).length, 1);
    assert.equal(validarRegra(regra({ cest: "123" })).length, 1);
    assert.equal(validarRegra(regra({ ufDestino: "sp" })).length, 1);
    assert.equal(validarRegra(regra({ vigenciaInicio: "10/03/2027" })).length, 1);
    assert.equal(validarRegra(regra({ vigenciaFim: "2026-12-31" })).length, 1);
    assert.equal(validarRegra(regra({ versao: 0 })).length, 1);
  });
});

describe("regraCasa", () => {
  it("casa por prefixo do NCM, de 2 a 8 dígitos", () => {
    for (const p of ["23", "2309", "230910", "23091000"])
      assert.equal(regraCasa(regra({ ncmPrefixo: p }), ctx()), true, p);
    assert.equal(regraCasa(regra({ ncmPrefixo: "2310" }), ctx()), false);
  });
  it("aceita NCM com pontuação no contexto", () => {
    assert.equal(regraCasa(regra({ ncmPrefixo: "2309" }), ctx({ ncm: "2309.10.00" })), true);
  });
  it("respeita a vigência (fim inclusivo) e a regra inativa", () => {
    const r = regra({ vigenciaInicio: "2027-01-01", vigenciaFim: "2027-03-10" });
    assert.equal(regraCasa(r, ctx({ data: "2027-03-10" })), true);
    assert.equal(regraCasa(r, ctx({ data: "2027-03-11" })), false);
    assert.equal(regraCasa(r, ctx({ data: "2026-12-31" })), false);
    assert.equal(regraCasa(regra({ ativa: false }), ctx()), false);
  });
  it("critério preenchido na regra exige o mesmo valor no contexto", () => {
    assert.equal(regraCasa(regra({ cest: "1700100" }), ctx({ cest: "17.001.00" })), true);
    assert.equal(regraCasa(regra({ cest: "1700100" }), ctx()), false);
    assert.equal(regraCasa(regra({ operacao: "devolucao" }), ctx()), false);
    assert.equal(regraCasa(regra({ regime: "simples" }), ctx()), false);
    assert.equal(regraCasa(regra({ ufDestino: "SP" }), ctx()), false);
    assert.equal(regraCasa(regra({ ufDestino: "SP" }), ctx({ ufDestino: "sp" })), true);
  });
  it("regra inválida nunca casa", () => {
    assert.equal(regraCasa(regra({ ncmPrefixo: "9" }), ctx({ ncm: "90000000" })), false);
  });
});

describe("especificidade e melhoresRegras", () => {
  it("NCM de 8 dígitos vence 6, 4 e 2", () => {
    const [r2, r4, r6, r8] = ["23", "2309", "230910", "23091000"].map((p) =>
      regra({ ncmPrefixo: p }),
    ) as [RegraFiscal, RegraFiscal, RegraFiscal, RegraFiscal];
    assert.deepEqual(melhoresRegras([r2, r4, r6, r8], ctx()), [r8]);
    assert.deepEqual(melhoresRegras([r2, r4, r6], ctx()), [r6]);
    assert.deepEqual(melhoresRegras([r2, r4], ctx()), [r4]);
  });
  it("CEST casando vence regra sem CEST de mesmo NCM", () => {
    const sem = regra();
    const com = regra({ cest: "1700100" });
    assert.deepEqual(melhoresRegras([sem, com], ctx({ cest: "1700100" })), [com]);
    assert.deepEqual(melhoresRegras([sem, com], ctx()), [sem]);
  });
  it("mais dígitos de NCM vence mesmo contra regra com CEST e operação", () => {
    const longa = regra({ ncmPrefixo: "230910" });
    const curtaCompleta = regra({
      ncmPrefixo: "2309",
      cest: "1700100",
      operacao: "venda",
      regime: "normal",
    });
    assert.deepEqual(melhoresRegras([curtaCompleta, longa], ctx({ cest: "1700100" })), [longa]);
  });
  it("operação e regime casando vencem 'qualquer'; UF vem por último", () => {
    const qualquer = regra();
    const comOp = regra({ operacao: "venda" });
    const comOpRegime = regra({ operacao: "venda", regime: "normal" });
    const comUf = regra({ operacao: "venda", regime: "normal", ufDestino: "SP" });
    assert.deepEqual(melhoresRegras([qualquer, comOp], ctx()), [comOp]);
    assert.deepEqual(melhoresRegras([comOp, comOpRegime], ctx()), [comOpRegime]);
    assert.deepEqual(melhoresRegras([comOpRegime, comUf], ctx({ ufDestino: "SP" })), [comUf]);
    assert.deepEqual(melhoresRegras([comOpRegime, comUf], ctx({ ufDestino: "RJ" })), [comOpRegime]);
  });
  it("empate real devolve todas as empatadas", () => {
    const a = regra();
    const b = regra({ perfil: { cfop: "5405" } });
    assert.deepEqual(melhoresRegras([a, b], ctx()), [a, b]);
  });
  it("sem regra que case devolve vazio", () => {
    assert.deepEqual(melhoresRegras([regra({ ncmPrefixo: "99" })], ctx()), []);
    assert.deepEqual(especificidade(regra({ cest: "1700100", ufDestino: "SP" })), [4, 1, 0, 1]);
  });
});

describe("resolverTributacao", () => {
  it("sem regra nenhuma cai no padrão da empresa", () => {
    const r = resolverTributacao({ contexto: ctx(), padrao: { cfop: "5102", aliqPis: 0 } });
    assert.equal(r.status, "sem_regra");
    assert.equal(r.regra, null);
    assert.deepEqual(r.campos.cfop, { valor: "5102", origem: "padrao" });
    assert.deepEqual(r.campos.aliqPis, { valor: 0, origem: "padrao" });
  });

  it("regra global vence o padrão e informa id e versão", () => {
    const g = regra({ versao: 3, perfil: { cfop: "5405", cstIcms: "60" } });
    const r = resolverTributacao({
      contexto: ctx(),
      regrasGlobais: [g],
      padrao: { cfop: "5102", cstPis: "99" },
    });
    assert.equal(r.status, "regra");
    assert.deepEqual(r.regra, { id: g.id, versao: 3, origem: "global" });
    assert.deepEqual(r.campos.cfop, { valor: "5405", origem: "global" });
    assert.deepEqual(r.campos.cstIcms, { valor: "60", origem: "global" });
    assert.deepEqual(r.campos.cstPis, { valor: "99", origem: "padrao" });
  });

  it("regra da empresa vence a global, mesmo sendo menos específica", () => {
    const global = regra({ ncmPrefixo: "23091000", perfil: { cfop: "5405" } });
    const empresa = regra({ ncmPrefixo: "23", perfil: { cfop: "5102" } });
    const r = resolverTributacao({
      contexto: ctx(),
      regrasGlobais: [global],
      regrasEmpresa: [empresa],
    });
    assert.deepEqual(r.regra, { id: empresa.id, versao: 1, origem: "empresa" });
    assert.deepEqual(r.campos.cfop, { valor: "5102", origem: "empresa" });
  });

  it("regra global ocultada pela empresa é ignorada e vale a seguinte", () => {
    const especifica = regra({ ncmPrefixo: "230910", perfil: { cfop: "5405" } });
    const geral = regra({ ncmPrefixo: "23", perfil: { cfop: "5102" } });
    const r = resolverTributacao({
      contexto: ctx(),
      regrasGlobais: [especifica, geral],
      globaisOcultas: [especifica.id],
    });
    assert.equal(r.regra?.id, geral.id);
    assert.deepEqual(r.campos.cfop, { valor: "5102", origem: "global" });
  });

  it("empate devolve as candidatas, não escolhe e não aplica o padrão", () => {
    const a = regra();
    const b = regra({ perfil: { cfop: "5405" } });
    const r = resolverTributacao({
      contexto: ctx(),
      regrasGlobais: [a, b],
      padrao: { cfop: "5102" },
      produto: { origem: "0" },
    });
    assert.equal(r.status, "empate");
    assert.equal(r.regra, null);
    assert.deepEqual(
      r.candidatas.map((c) => c.regra.id),
      [a.id, b.id],
    );
    assert.equal(r.candidatas[0]?.origem, "global");
    assert.equal(r.campos.cfop, undefined);
    assert.deepEqual(r.campos.origem, { valor: "0", origem: "produto" });
  });

  it("empate dentro da empresa não cai na global", () => {
    const g = regra({ perfil: { cfop: "5405" } });
    const e1 = regra();
    const e2 = regra();
    const r = resolverTributacao({ contexto: ctx(), regrasGlobais: [g], regrasEmpresa: [e1, e2] });
    assert.equal(r.status, "empate");
    assert.equal(
      r.candidatas.every((c) => c.origem === "empresa"),
      true,
    );
  });

  it("exceção do produto vence a regra e o valor do item vence tudo, campo a campo", () => {
    const g = regra({ perfil: { cfop: "5405", cstIcms: "60", cstPis: "04" } });
    const r = resolverTributacao({
      contexto: ctx(),
      regrasGlobais: [g],
      produto: { cfop: "5102", cstIcms: "00" },
      item: { cstIcms: "20" },
      padrao: { cstCofins: "99" },
    });
    assert.deepEqual(r.campos.cstIcms, { valor: "20", origem: "item" });
    assert.deepEqual(r.campos.cfop, { valor: "5102", origem: "produto" });
    assert.deepEqual(r.campos.cstPis, { valor: "04", origem: "global" });
    assert.deepEqual(r.campos.cstCofins, { valor: "99", origem: "padrao" });
  });

  it("zero é valor definido; vazio, nulo e indefinido não são", () => {
    const g = regra({ perfil: { aliqIcms: 18, aliqPis: 1.65, cfop: "5102" } });
    const r = resolverTributacao({
      contexto: ctx(),
      regrasGlobais: [g],
      produto: { aliqIcms: 0, aliqPis: "  ", cfop: null, cstIcms: undefined },
    });
    assert.deepEqual(r.campos.aliqIcms, { valor: 0, origem: "produto" });
    assert.deepEqual(r.campos.aliqPis, { valor: 1.65, origem: "global" });
    assert.equal(r.campos.cfop?.origem, "global");
  });

  it("NCM sem 8 dígitos não consulta regra nem aplica o padrão", () => {
    const g = regra({ ncmPrefixo: "23" });
    for (const ncm of ["", "2309", "230910000"]) {
      const r = resolverTributacao({
        contexto: ctx({ ncm }),
        regrasGlobais: [g],
        padrao: { cfop: "5102" },
        item: { cfop: "5101" },
      });
      assert.equal(r.status, "ncm_invalido", ncm);
      assert.equal(r.regra, null);
      assert.deepEqual(r.campos.cfop, { valor: "5101", origem: "item" });
    }
    assert.equal(
      resolverTributacao({ contexto: ctx({ ncm: "" }), padrao: { cfop: "5102" } }).campos.cfop,
      undefined,
    );
  });

  it("regra fora da vigência cai no padrão; a antiga continua valendo na data antiga", () => {
    const v1 = regra({
      versao: 1,
      vigenciaInicio: "2027-01-01",
      vigenciaFim: "2027-06-30",
      perfil: { cfop: "5102" },
    });
    const v2 = regra({ versao: 2, vigenciaInicio: "2027-07-01", perfil: { cfop: "5405" } });
    const em = (data: string) =>
      resolverTributacao({ contexto: ctx({ data }), regrasGlobais: [v1, v2] });
    assert.equal(em("2027-06-30").regra?.versao, 1);
    assert.equal(em("2027-07-01").regra?.versao, 2);
    assert.equal(em("2026-12-31").status, "sem_regra");
  });

  it("não altera as entradas", () => {
    const g = Object.freeze(regra({ perfil: Object.freeze({ cfop: "5405" }) }));
    const entrada = Object.freeze({
      contexto: Object.freeze(ctx()),
      regrasGlobais: Object.freeze([g]),
      padrao: Object.freeze({ cfop: "5102" }),
    });
    assert.doesNotThrow(() => resolverTributacao(entrada));
  });
});

describe("MEI usa as regras de Simples Nacional", () => {
  const mei = ctx({ regime: "mei" });
  it("regra de simples vale para empresa MEI; de mei vale só para MEI; de simples não vale para normal", () => {
    assert.equal(regraCasa(regra({ regime: "simples" }), mei), true);
    assert.equal(regraCasa(regra({ regime: "mei" }), mei), true);
    assert.equal(regraCasa(regra({ regime: "mei" }), ctx({ regime: "simples" })), false);
    assert.equal(regraCasa(regra({ regime: "simples" }), ctx({ regime: "normal" })), false);
    assert.equal(regraCasa(regra({ regime: "simples" }), ctx({ regime: "simples" })), true);
    assert.equal(regraCasa(regra({ regime: null }), mei), true);
  });
  it("para MEI, a regra de mei vence a de simples, e a de simples vence a sem regime", () => {
    const simples = regra({ regime: "simples", perfil: { csosn: "102" } });
    const soMei = regra({ regime: "mei", perfil: { csosn: "103" } });
    const geral = regra({ regime: null, perfil: { csosn: "400" } });
    assert.deepEqual(melhoresRegras([simples, soMei, geral], mei), [soMei]);
    assert.deepEqual(melhoresRegras([simples, geral], mei), [simples]);
    assert.deepEqual(melhoresRegras([geral], mei), [geral]);
  });
  it("empresa do Simples nunca recebe a regra de mei; sem regra de simples cai na sem regime", () => {
    const simples = regra({ regime: "simples" });
    const soMei = regra({ regime: "mei" });
    const geral = regra({ regime: null });
    assert.deepEqual(melhoresRegras([soMei, geral], ctx({ regime: "simples" })), [geral]);
    assert.deepEqual(melhoresRegras([simples, soMei], ctx({ regime: "simples" })), [simples]);
    assert.deepEqual(melhoresRegras([simples], ctx({ regime: "normal" })), []);
  });
  it("duas regras de simples iguais continuam empatando para MEI", () => {
    const a = regra({ regime: "simples" });
    const b = regra({ regime: "simples", perfil: { cfop: "5405" } });
    assert.deepEqual(melhoresRegras([a, b], mei), [a, b]);
  });
  it("a operação continua pesando mais do que um regime usado no lugar de mei", () => {
    const comOperacao = regra({ operacao: "venda", regime: null, perfil: { cfop: "5102" } });
    const soSimples = regra({ regime: "simples", perfil: { cfop: "5405" } });
    assert.deepEqual(melhoresRegras([comOperacao, soSimples], mei), [comOperacao]);
  });
  it("pontuação do regime: exato 2, simples no lugar de mei 1, sem regime 0 (e 2 quando não há regime da empresa)", () => {
    assert.equal(especificidade(regra({ regime: "mei" }), "mei")[2], 2);
    assert.equal(especificidade(regra({ regime: "simples" }), "mei")[2], 1);
    assert.equal(especificidade(regra({ regime: null }), "mei")[2], 0);
    assert.equal(especificidade(regra({ regime: "simples", operacao: "venda" }), "simples")[2], 4);
    assert.equal(especificidade(regra({ regime: "simples" }))[2], 2);
  });
});
