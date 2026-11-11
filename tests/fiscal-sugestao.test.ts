import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aplicacaoIbsCbs,
  ibsCbsJaIgual,
  lerSugestaoFiscal,
  linhasDoPerfil,
  ncmConsultavel,
  ncmDigitos,
} from "../src/lib/fiscal-sugestao.ts";

const regra = {
  id: "r1",
  versao: 3,
  origem: "global",
  ncmPrefixo: "2309",
  perfilNome: "Revenda tributada",
};

describe("ncm", () => {
  it("só dígitos, e só consulta com 8", () => {
    assert.equal(ncmDigitos("2309.10.00"), "23091000");
    assert.equal(ncmConsultavel("2309.10.00"), true);
    assert.equal(ncmConsultavel("2309"), false);
    assert.equal(ncmConsultavel(""), false);
    assert.equal(ncmConsultavel("230910000"), false);
  });
});

describe("lerSugestaoFiscal", () => {
  it("regra escolhida, com o perfil limpo de chaves desconhecidas", () => {
    const s = lerSugestaoFiscal({
      status: "regra",
      regra,
      candidatas: [],
      perfil: { cfop: "5102", aliqIcms: 18, qualquer: "x" },
    });
    assert.deepEqual(s, {
      status: "regra",
      regra,
      perfil: { cfop: "5102", aliqIcms: 18 },
    });
  });
  it("aceita a resposta antiga, sem prefixo do NCM nem nome do perfil", () => {
    const s = lerSugestaoFiscal({
      status: "regra",
      regra: { id: "r1", versao: 1, origem: "empresa" },
      perfil: { cfop: "5102" },
    });
    assert.equal(s?.status, "regra");
    if (s?.status === "regra") {
      assert.equal(s.regra.perfilNome, "");
      assert.equal(s.regra.origem, "empresa");
    }
  });
  it("empate com as candidatas e seus perfis", () => {
    const s = lerSugestaoFiscal({
      status: "empate",
      regra: null,
      perfil: {},
      candidatas: [
        { ...regra, id: "a", perfilId: "p1", perfil: { cfop: "5102" } },
        { ...regra, id: "b", perfilId: "p2", perfil: { cfop: "5405" } },
      ],
    });
    assert.equal(s?.status, "empate");
    if (s?.status === "empate") {
      assert.deepEqual(
        s.candidatas.map((c) => [c.id, c.perfil.cfop]),
        [
          ["a", "5102"],
          ["b", "5405"],
        ],
      );
    }
  });
  it("sem regra e NCM inválido", () => {
    assert.deepEqual(lerSugestaoFiscal({ status: "sem_regra", regra: null, perfil: {} }), {
      status: "sem_regra",
    });
    assert.deepEqual(lerSugestaoFiscal({ status: "ncm_invalido" }), { status: "ncm_invalido" });
  });
  it("lê a UF considerada na consulta, quando vem (e aceita a resposta sem ela)", () => {
    const com = lerSugestaoFiscal({ status: "sem_regra", ufDestino: "SP" });
    assert.deepEqual(com, { status: "sem_regra", ufDestino: "SP" });
    assert.equal(lerSugestaoFiscal({ status: "ncm_invalido", ufDestino: null })?.ufDestino, null);
    const regraUf = lerSugestaoFiscal({
      status: "regra",
      regra,
      perfil: { cfop: "5102" },
      ufDestino: "MG",
    });
    assert.equal(regraUf?.ufDestino, "MG");
    assert.equal(lerSugestaoFiscal({ status: "sem_regra" })?.ufDestino, undefined);
    assert.equal(lerSugestaoFiscal({ status: "sem_regra", ufDestino: 5 }), null);
  });
  it("formato inesperado vira nulo, sem lançar erro", () => {
    for (const lixo of [
      null,
      undefined,
      "texto",
      42,
      [],
      {},
      { status: "outro" },
      { status: "regra" },
      { status: "regra", regra: { id: 1 }, perfil: {} },
      { status: "regra", regra: { ...regra, origem: "x" }, perfil: {} },
      { status: "empate", candidatas: [] },
      { status: "regra", regra, perfil: { cfop: { a: 1 } } },
    ]) {
      assert.equal(lerSugestaoFiscal(lixo), null, JSON.stringify(lixo));
    }
  });
});

describe("linhasDoPerfil", () => {
  it("rótulos, ordem dos campos e unidade de percentual", () => {
    assert.deepEqual(
      linhasDoPerfil({
        origem: "0",
        aliqPis: 1.65,
        cfop: "5102",
        cstIcms: "00",
        aliqIcms: 18,
        mvaSt: 0,
      }),
      [
        { rotulo: "CST do ICMS", valor: "00" },
        { rotulo: "CFOP", valor: "5102" },
        { rotulo: "ICMS", valor: "18%" },
        { rotulo: "MVA-ST", valor: "0%" },
        { rotulo: "PIS", valor: "1,65%" },
        { rotulo: "Origem", valor: "0" },
      ],
    );
  });
  it("perfil vazio não gera linha", () => {
    assert.deepEqual(linhasDoPerfil({}), []);
  });
});

describe("aplicacaoIbsCbs", () => {
  it("sem CST e cClassTrib completos, não há o que aplicar", () => {
    assert.deepEqual(aplicacaoIbsCbs({ cfop: "5102" }), { tipo: "sem_ibs_cbs" });
    assert.deepEqual(aplicacaoIbsCbs({ cstIbsCbs: "000" }), { tipo: "sem_ibs_cbs" });
    assert.deepEqual(aplicacaoIbsCbs({ cclasstrib: "000001" }), { tipo: "sem_ibs_cbs" });
  });
  it("tributação integral vira o padrão do cadastro (em branco)", () => {
    assert.deepEqual(aplicacaoIbsCbs({ cstIbsCbs: "000", cclasstrib: "000001" }), {
      tipo: "aplicar",
      cst: "",
      cclasstrib: "",
    });
  });
  it("combinação que o sistema calcula é aplicada como veio", () => {
    assert.deepEqual(aplicacaoIbsCbs({ cstIbsCbs: "410", cclasstrib: "410004" }), {
      tipo: "aplicar",
      cst: "410",
      cclasstrib: "410004",
    });
  });
  it("combinação que a emissão recusaria nunca é aplicada e traz o motivo", () => {
    const r = aplicacaoIbsCbs({ cstIbsCbs: "510", cclasstrib: "510001" });
    assert.equal(r.tipo, "nao_suportada");
    if (r.tipo === "nao_suportada") assert.match(r.motivo, /\S/);
    const inexistente = aplicacaoIbsCbs({ cstIbsCbs: "999", cclasstrib: "999999" });
    assert.equal(inexistente.tipo, "nao_suportada");
    const cruzada = aplicacaoIbsCbs({ cstIbsCbs: "000", cclasstrib: "410004" });
    assert.equal(cruzada.tipo, "nao_suportada");
  });
});

describe("ibsCbsJaIgual", () => {
  it("em branco e integral são a mesma coisa", () => {
    assert.equal(
      ibsCbsJaIgual({ cst: "", cclasstrib: "" }, { cst: "000", cclasstrib: "000001" }),
      true,
    );
    assert.equal(
      ibsCbsJaIgual({ cst: "000", cclasstrib: "000001" }, { cst: "", cclasstrib: "" }),
      true,
    );
    assert.equal(ibsCbsJaIgual({ cst: "", cclasstrib: "" }, { cst: "", cclasstrib: "" }), true);
  });
  it("valores diferentes não são iguais", () => {
    assert.equal(
      ibsCbsJaIgual({ cst: "", cclasstrib: "" }, { cst: "410", cclasstrib: "410004" }),
      false,
    );
    assert.equal(
      ibsCbsJaIgual({ cst: "410", cclasstrib: "410004" }, { cst: "410", cclasstrib: "410999" }),
      false,
    );
  });
});
