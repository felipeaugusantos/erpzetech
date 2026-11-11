import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dataBr,
  descreverCriterios,
  formNovaVersao,
  formVazio,
  lerMinhasRegras,
  lerPerfisDisponiveis,
  lerRegrasGlobais,
  montarDadosRegra,
  resumoDoPerfil,
  validarMotivo,
  type FormRegraEmpresa,
  type RegraEmpresa,
} from "../src/lib/fiscal-empresa.ts";

const HOJE = "2027-03-10";
const form = (p: Partial<FormRegraEmpresa> = {}): FormRegraEmpresa => ({
  ...formVazio(HOJE),
  ncm: "2309",
  perfilModo: "existente",
  perfilId: "perfil-1",
  ...p,
});

const regraBruta = {
  id: "r1",
  ncmPrefixo: "2309",
  cest: null,
  operacao: "venda",
  regime: null,
  ufDestino: "SP",
  vigenciaInicio: "2027-01-01",
  vigenciaFim: null,
  versao: 2,
  ativa: true,
  status: "vigente",
  observacao: null,
  perfilNome: "Revenda tributada",
  perfil: { cfop: "5102", aliqIcms: 18, extra: "x" },
};

describe("leituras", () => {
  it("minhas regras: formato completo, perfil limpo de chaves desconhecidas", () => {
    const r = lerMinhasRegras({
      total: 1,
      itens: [
        {
          ...regraBruta,
          criadoEm: "2027-01-01T00:00:00Z",
          perfilId: "p1",
          perfilOrigem: "empresa",
        },
      ],
    });
    assert.equal(r?.total, 1);
    assert.deepEqual(r?.itens[0]?.perfil, { cfop: "5102", aliqIcms: 18 });
    assert.equal(r?.itens[0]?.perfilOrigem, "empresa");
  });
  it("regras globais com a marca de ocultas", () => {
    const r = lerRegrasGlobais({
      total: 1,
      itens: [{ ...regraBruta, oculta: true, motivoOculta: "não uso" }],
    });
    assert.equal(r?.itens[0]?.oculta, true);
    assert.equal(r?.itens[0]?.motivoOculta, "não uso");
  });
  it("perfis disponíveis", () => {
    const r = lerPerfisDisponiveis([
      { id: "p", nome: "A", origem: "global", perfil: { cfop: "5102" } },
    ]);
    assert.equal(r?.[0]?.nome, "A");
    assert.deepEqual(lerPerfisDisponiveis([]), []);
  });
  it("formato inesperado vira nulo, sem lançar erro", () => {
    for (const lixo of [
      null,
      undefined,
      "x",
      1,
      [],
      {},
      { total: "1", itens: [] },
      { total: 1, itens: [{}] },
    ]) {
      assert.equal(lerMinhasRegras(lixo), null, JSON.stringify(lixo));
      assert.equal(lerRegrasGlobais(lixo), null, JSON.stringify(lixo));
    }
    assert.equal(lerPerfisDisponiveis({}), null);
    assert.equal(lerPerfisDisponiveis([{ id: 1 }]), null);
    assert.equal(
      lerMinhasRegras({
        total: 1,
        itens: [
          { ...regraBruta, status: "outro", criadoEm: "x", perfilId: "p", perfilOrigem: "global" },
        ],
      }),
      null,
    );
  });
});

describe("textos das listas", () => {
  it("critérios e resumo do perfil", () => {
    assert.equal(
      descreverCriterios({ cest: null, operacao: null, regime: null, ufDestino: null }),
      "todos",
    );
    assert.equal(
      descreverCriterios({ cest: "0100100", operacao: "venda", regime: "normal", ufDestino: "SP" }),
      "CEST 0100100 · venda · normal · UF SP",
    );
    assert.equal(resumoDoPerfil({}), "—");
    assert.equal(resumoDoPerfil({ cfop: "5102", aliqIcms: 18 }), "CFOP 5102 · ICMS 18%");
  });
  it("data em português", () => {
    assert.equal(dataBr("2027-03-09"), "09/03/2027");
    assert.equal(dataBr(null), "—");
  });
});

describe("montarDadosRegra com perfil existente", () => {
  it("monta o corpo só com o id do perfil e normaliza os critérios", () => {
    const r = montarDadosRegra(
      form({
        ncm: "23.09",
        cest: "100100",
        operacao: "Venda",
        regime: "Simples Nacional",
        ufDestino: "sp",
        observacao: " obs ",
      }),
    );
    assert.deepEqual(r.erros, []);
    assert.deepEqual(r.dados, {
      ncm: "2309",
      cest: "0100100",
      operacao: "venda",
      regime: "simples",
      uf_destino: "SP",
      vigencia_inicio: HOJE,
      vigencia_fim: null,
      observacao: "obs",
      perfil_id: "perfil-1",
    });
  });
  it("sem perfil escolhido, NCM ruim e datas erradas dão erro e não montam nada", () => {
    const r = montarDadosRegra(form({ perfilId: "", ncm: "230", vigenciaInicio: "31/02/2027" }));
    assert.equal(r.dados, null);
    assert.equal(r.erros.length, 3);
    assert.ok(r.erros.some((e) => /Escolha o perfil/.test(e)));
  });
  it("NCM que não consta na Tabela NCM vigente é recusado, nos dois modos de perfil", () => {
    const a = montarDadosRegra(form({ ncm: "23091001" }));
    assert.equal(a.dados, null);
    assert.ok(a.erros.some((e) => /não consta na Tabela NCM/.test(e)));
    const b = montarDadosRegra(
      form({ ncm: "99999999", perfilModo: "novo", perfilId: "", perfilNome: "P", cfop: "5102" }),
    );
    assert.equal(b.dados, null);
    assert.ok(b.erros.some((e) => /não consta na Tabela NCM/.test(e)));
  });
  it("fim anterior ao início e observação longa", () => {
    const r = montarDadosRegra(form({ vigenciaFim: "2027-03-09", observacao: "x".repeat(501) }));
    assert.equal(r.dados, null);
    assert.ok(r.erros.some((e) => /anterior ao início/.test(e)));
    assert.ok(r.erros.some((e) => /Observação/.test(e)));
  });
});

describe("montarDadosRegra com perfil novo", () => {
  const novo = (p: Partial<FormRegraEmpresa> = {}) =>
    form({
      perfilModo: "novo",
      perfilId: "",
      perfilNome: "Meu perfil",
      cstIcms: "0",
      cfop: "5102",
      aliqIcms: "12,5",
      ...p,
    });

  it("envia o nome e os valores normalizados, sem perfil_id", () => {
    const r = montarDadosRegra(novo({ cstPis: "1", aliqPis: "1,65%" }));
    assert.deepEqual(r.erros, []);
    assert.equal(r.dados?.perfil_id, undefined);
    assert.deepEqual(r.dados?.perfil, {
      nome: "Meu perfil",
      cst_icms: "00",
      csosn: null,
      cfop: "5102",
      aliq_icms: 12.5,
      reducao_base_icms: null,
      mva_st: null,
      cst_pis: "01",
      aliq_pis: 1.65,
      cst_cofins: null,
      aliq_cofins: null,
      cst_ibs_cbs: null,
      cclasstrib: null,
      origem: null,
    });
  });
  it("sem nome, sem nenhum campo de tributação ou com valor inválido", () => {
    assert.ok(
      montarDadosRegra(novo({ perfilNome: "" })).erros.some((e) => /nome do perfil/.test(e)),
    );
    assert.ok(
      montarDadosRegra(novo({ cstIcms: "", cfop: "", aliqIcms: "" })).erros.some((e) =>
        /ao menos um campo/.test(e),
      ),
    );
    assert.ok(
      montarDadosRegra(novo({ aliqIcms: "101" })).erros.some((e) => /entre 0 e 100/.test(e)),
    );
    assert.equal(montarDadosRegra(novo({ cfop: "51" })).dados, null);
  });
  it("o perfil escolhido antes não vaza para o modo novo", () => {
    const r = montarDadosRegra(novo({ perfilId: "perfil-1" }));
    assert.equal(r.dados?.perfil_id, undefined);
  });
});

describe("nova versão", () => {
  const atual = {
    id: "r1",
    ncmPrefixo: "23091000",
    cest: "0100100",
    operacao: "venda",
    regime: "normal",
    ufDestino: "SP",
    vigenciaInicio: "2027-01-01",
    vigenciaFim: null,
    versao: 1,
    ativa: true,
    status: "vigente",
    observacao: "obs",
    perfilNome: "P",
    perfil: {},
    criadoEm: "2027-01-01T00:00:00Z",
    perfilId: "p1",
    perfilOrigem: "global",
  } as RegraEmpresa;

  it("parte da regra atual, começando hoje, com o mesmo perfil", () => {
    const f = formNovaVersao(atual, HOJE);
    assert.deepEqual(
      [
        f.ncm,
        f.cest,
        f.operacao,
        f.regime,
        f.ufDestino,
        f.vigenciaInicio,
        f.perfilModo,
        f.perfilId,
        f.observacao,
      ],
      ["23091000", "0100100", "venda", "normal", "SP", HOJE, "existente", "p1", "obs"],
    );
    assert.deepEqual(montarDadosRegra(f, atual).erros, []);
  });
  it("início igual ou anterior ao da versão atual é recusado, com a data na mensagem", () => {
    for (const inicio of ["2027-01-01", "2026-12-31"]) {
      const r = montarDadosRegra({ ...formNovaVersao(atual, HOJE), vigenciaInicio: inicio }, atual);
      assert.equal(r.dados, null, inicio);
      assert.match(r.erros[0] ?? "", /depois de 01\/01\/2027/);
    }
  });
});

describe("validarMotivo", () => {
  it("de 3 a 300 caracteres, sem espaços nas pontas", () => {
    assert.deepEqual(validarMotivo("  não uso  "), { motivo: "não uso", erro: null });
    assert.equal(validarMotivo("ab").motivo, null);
    assert.equal(validarMotivo("   ").motivo, null);
    assert.equal(validarMotivo("x".repeat(300)).erro, null);
    assert.match(validarMotivo("x".repeat(301)).erro ?? "", /300/);
  });
});
