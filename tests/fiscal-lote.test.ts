import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  camposDoProduto,
  chaveSugestao,
  consultasDosProdutos,
  edicoesDaSugestao,
  edicoesDoLote,
  emLotesFiscais,
  juntarLotes,
  lerLoteSugestoes,
  sugestaoDoProduto,
  type LoteSugestoes,
  type ProdutoParaSugestao,
} from "../src/lib/fiscal-lote.ts";

const regra = { id: "r1", versao: 1, origem: "global", ncmPrefixo: "2309", perfilNome: "P" };
const comRegra = (perfil: Record<string, string | number>) => ({
  status: "regra",
  regra,
  candidatas: [],
  perfil,
});
const produto = (p: Partial<ProdutoParaSugestao> = {}): ProdutoParaSugestao => ({
  id: "p1",
  ncm: "23091000",
  cest: null,
  cfop: null,
  cst_csosn: null,
  aliquota_icms: 0,
  origem_mercadoria: null,
  ...p,
});

describe("lerLoteSugestoes", () => {
  it("lê o regime e o resultado de cada item", () => {
    const l = lerLoteSugestoes({
      regime: "simples",
      itens: [
        { ncm: "23091000", cest: null, resultado: comRegra({ cfop: "5102" }) },
        {
          ncm: "99999999",
          cest: "0100100",
          resultado: { status: "sem_regra", regra: null, perfil: {} },
        },
      ],
    });
    assert.equal(l?.regime, "simples");
    assert.equal(l?.itens[0]?.resultado.status, "regra");
    assert.equal(l?.itens[1]?.cest, "0100100");
  });
  it("formato inesperado vira nulo", () => {
    for (const lixo of [
      null,
      "x",
      {},
      { regime: "outro", itens: [] },
      { regime: "normal", itens: [{ ncm: "1", cest: null, resultado: { status: "x" } }] },
      { regime: "normal", itens: [{ ncm: 1, cest: null, resultado: {} }] },
    ]) {
      assert.equal(lerLoteSugestoes(lixo), null, JSON.stringify(lixo));
    }
  });
});

describe("consultas e lotes", () => {
  it("só NCM de 8 dígitos, sem repetir (NCM e CEST), com dígitos limpos", () => {
    const c = consultasDosProdutos([
      { ncm: "2309.10.00", cest: "01.001.00" },
      { ncm: "23091000", cest: "0100100" },
      { ncm: "23091000", cest: null },
      { ncm: "23091000", cest: "" },
      { ncm: "2309", cest: null },
      { ncm: null, cest: null },
    ]);
    assert.deepEqual(c, [
      { ncm: "23091000", cest: "0100100" },
      { ncm: "23091000", cest: null },
    ]);
  });
  it("divide em lotes de até 300 e junta de volta", () => {
    const itens = Array.from({ length: 650 }, (_, i) => i);
    assert.deepEqual(
      emLotesFiscais(itens).map((l) => l.length),
      [300, 300, 50],
    );
    assert.deepEqual(emLotesFiscais([]), []);
    const a: LoteSugestoes = {
      regime: "normal",
      itens: [{ ncm: "1", cest: null, resultado: { status: "sem_regra" } }],
    };
    const b: LoteSugestoes = {
      regime: "normal",
      itens: [{ ncm: "2", cest: null, resultado: { status: "sem_regra" } }],
    };
    assert.deepEqual(
      juntarLotes([a, b])?.itens.map((i) => i.ncm),
      ["1", "2"],
    );
    assert.equal(juntarLotes([]), null);
  });
  it("chave ignora pontuação", () => {
    assert.equal(chaveSugestao("2309.10.00", "01.001.00"), "23091000|0100100");
    assert.equal(chaveSugestao("23091000", null), "23091000|");
  });
});

describe("camposDoProduto", () => {
  it("regime normal usa o CST do ICMS", () => {
    const r = camposDoProduto(
      { cfop: "5405", cstIcms: "60", csosn: "500", aliqIcms: 18, origem: "0" },
      "normal",
    );
    assert.deepEqual(r.campos, {
      cfop: "5405",
      cst_csosn: "60",
      aliquota_icms: 18,
      origem_mercadoria: "0",
    });
    assert.deepEqual(r.avisos, []);
  });
  it("Simples e MEI usam o CSOSN", () => {
    for (const regime of ["simples", "mei"] as const) {
      const r = camposDoProduto({ cstIcms: "60", csosn: "500" }, regime);
      assert.equal(r.campos.cst_csosn, "500", regime);
    }
  });
  it("código que a emissão não sabe formatar não é aplicado e vira aviso", () => {
    const cst = camposDoProduto({ cstIcms: "20" }, "normal");
    assert.equal(cst.campos.cst_csosn, undefined);
    assert.match(cst.avisos[0] ?? "", /CST do ICMS 20 ainda não é emitido corretamente/);
    const csosn = camposDoProduto({ csosn: "201" }, "simples");
    assert.equal(csosn.campos.cst_csosn, undefined);
    assert.match(csosn.avisos[0] ?? "", /CSOSN 201/);
  });
  it("todos os códigos que a emissão formata são aceitos", () => {
    for (const c of ["00", "40", "41", "50", "51", "60"]) {
      assert.equal(camposDoProduto({ cstIcms: c }, "normal").campos.cst_csosn, c, c);
    }
    for (const c of ["101", "102", "103", "300", "400", "500", "900"]) {
      assert.equal(camposDoProduto({ csosn: c }, "simples").campos.cst_csosn, c, c);
    }
  });
  it("regra só com o código do outro regime avisa em vez de adivinhar", () => {
    assert.match(camposDoProduto({ cstIcms: "00" }, "simples").avisos[0] ?? "", /não traz CSOSN/);
    assert.match(
      camposDoProduto({ csosn: "102" }, "normal").avisos[0] ?? "",
      /não traz CST do ICMS/,
    );
  });
  it("CFOP, alíquota e origem fora do formato não entram", () => {
    const r = camposDoProduto({ cfop: "51", aliqIcms: 120, origem: "9" }, "normal");
    assert.deepEqual(r.campos, {});
    assert.match(r.avisos[0] ?? "", /CFOP 51 inválido/);
  });
  it("alíquota zero é um valor válido", () => {
    assert.equal(camposDoProduto({ aliqIcms: 0 }, "normal").campos.aliquota_icms, 0);
  });
  it("o que o produto não guarda fica só para consulta", () => {
    const r = camposDoProduto(
      {
        cfop: "5102",
        reducaoBaseIcms: 33,
        mvaSt: 40,
        cstPis: "01",
        aliqPis: 1.65,
        cstCofins: "01",
        aliqCofins: 7.6,
        cstIbsCbs: "000",
        cclasstrib: "000001",
      },
      "normal",
    );
    assert.deepEqual(r.campos, { cfop: "5102" });
    assert.deepEqual(r.somenteConsulta, [
      "redução da base do ICMS",
      "MVA-ST",
      "CST do PIS",
      "alíquota de PIS",
      "CST do COFINS",
      "alíquota de COFINS",
      "CST do IBS/CBS",
      "cClassTrib",
    ]);
  });
});

describe("edicoesDaSugestao", () => {
  const campos = { cfop: "5405", cst_csosn: "500", aliquota_icms: 18, origem_mercadoria: "0" };
  it("faltantes só preenche o que está vazio", () => {
    assert.deepEqual(edicoesDaSugestao(produto(), campos, "faltantes"), campos);
    assert.deepEqual(
      edicoesDaSugestao(
        produto({ cfop: "5102", cst_csosn: "102", aliquota_icms: 12, origem_mercadoria: "1" }),
        campos,
        "faltantes",
      ),
      {},
    );
    assert.deepEqual(edicoesDaSugestao(produto({ cfop: "5102" }), campos, "faltantes"), {
      cst_csosn: "500",
      aliquota_icms: 18,
      origem_mercadoria: "0",
    });
  });
  it("alíquota zero conta como vazia, como no padrão da loja; texto em branco também", () => {
    assert.equal(
      edicoesDaSugestao(produto({ aliquota_icms: "0" }), campos, "faltantes").aliquota_icms,
      18,
    );
    assert.equal(edicoesDaSugestao(produto({ cfop: "   " }), campos, "faltantes").cfop, "5405");
    assert.equal(
      edicoesDaSugestao(produto({ aliquota_icms: 7 }), campos, "faltantes").aliquota_icms,
      undefined,
    );
  });
  it("substituir troca o que é diferente e ignora o que já está igual", () => {
    assert.deepEqual(
      edicoesDaSugestao(
        produto({ cfop: "5102", cst_csosn: "500", aliquota_icms: "18", origem_mercadoria: "1" }),
        campos,
        "substituir",
      ),
      { cfop: "5405", origem_mercadoria: "0" },
    );
    assert.deepEqual(
      edicoesDaSugestao(
        produto({ cfop: "5405", cst_csosn: "500", aliquota_icms: 18, origem_mercadoria: "0" }),
        campos,
        "substituir",
      ),
      {},
    );
  });
  it("sem campos sugeridos, nada a mudar", () => {
    assert.deepEqual(edicoesDaSugestao(produto(), {}, "substituir"), {});
  });
});

describe("edicoesDoLote", () => {
  const lote: LoteSugestoes = {
    regime: "simples",
    itens: [
      {
        ncm: "23091000",
        cest: null,
        resultado: comRegra({ cfop: "5405", csosn: "500", aliqIcms: 18 }) as never,
      },
      { ncm: "30041000", cest: null, resultado: { status: "sem_regra" } },
      { ncm: "11011000", cest: null, resultado: { status: "empate", candidatas: [] } as never },
      { ncm: "40011000", cest: null, resultado: comRegra({ cstIcms: "20" }) as never },
    ],
  };
  const lista = [
    produto({ id: "a" }),
    produto({ id: "b", ncm: "3004.10.00" }),
    produto({ id: "c", ncm: "11011000" }),
    produto({ id: "d", ncm: "40011000" }),
    produto({ id: "e", ncm: "23091000", cfop: "5405", cst_csosn: "500", aliquota_icms: 18 }),
    produto({ id: "f", ncm: "99999999" }),
  ];
  it("conta cada situação e só gera edição para quem tem regra e algo a mudar", () => {
    const { edicoes, resumo } = edicoesDoLote(lista, lote, "faltantes");
    assert.deepEqual(Object.keys(edicoes), ["a"]);
    assert.deepEqual(edicoes["a"], { cfop: "5405", cst_csosn: "500", aliquota_icms: 18 });
    assert.deepEqual(resumo, {
      consultados: 5,
      comRegra: 3,
      semRegra: 1,
      empate: 1,
      ncmInvalido: 0,
      comMudanca: 1,
      semMudanca: 2,
      campos: 3,
    });
  });
  it("produto cuja regra só traz código que a emissão não formata fica sem mudança", () => {
    const { edicoes } = edicoesDoLote(lista, lote, "substituir");
    assert.equal(edicoes["d"], undefined);
  });
  it("sugestaoDoProduto acha o resultado pelo NCM e CEST do produto", () => {
    assert.equal(sugestaoDoProduto({ ncm: "2309.10.00", cest: null }, lote)?.status, "regra");
    assert.equal(sugestaoDoProduto({ ncm: "99999999", cest: null }, lote), undefined);
    assert.equal(sugestaoDoProduto({ ncm: "23091000", cest: null }, null), undefined);
  });
});
