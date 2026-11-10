import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COLUNAS_FISCAIS,
  LIMITE_LINHAS_FISCAL,
  errosFiscais,
  lerData,
  lerDecimal,
  lerPlanilhaFiscal,
  modeloFiscalCsv,
  paraEnvioFiscal,
  validarLinhaFiscal,
} from "../src/lib/fiscal-importacao.ts";

const CAB =
  "ncm;cest;operacao;regime;uf_destino;vigencia_inicio;vigencia_fim;perfil;cst_icms;cfop;aliq_icms;cst_pis;aliq_pis";
const csv = (...linhas: string[]) => [CAB, ...linhas].join("\n");
const ok = "2309;;venda;normal;;2027-01-01;;Revenda tributada;00;5102;18;01;1,65";

describe("modelo", () => {
  it("é só o cabeçalho, com BOM, separado por ponto e vírgula, e a leitura o reconhece", () => {
    const m = modeloFiscalCsv();
    assert.equal(m.charCodeAt(0), 0xfeff);
    assert.equal(m.replace(/^\uFEFF/, "").trim(), COLUNAS_FISCAIS.join(";"));
    const l = lerPlanilhaFiscal(m);
    assert.equal(l.linhas.length, 0);
    assert.match(l.erroGeral ?? "", /só o cabeçalho/);
  });
});

describe("lerData", () => {
  it("aceita AAAA-MM-DD e DD/MM/AAAA e normaliza", () => {
    assert.equal(lerData("2027-03-09"), "2027-03-09");
    assert.equal(lerData("09/03/2027"), "2027-03-09");
    assert.equal(lerData("9/3/2027"), "2027-03-09");
  });
  it("recusa data que não existe ou formato estranho", () => {
    for (const t of [
      "2027-02-30",
      "31/04/2027",
      "2027-13-01",
      "27/03/27",
      "ontem",
      "",
      "2027-3-9",
    ]) {
      assert.equal(lerData(t), null, t);
    }
    assert.equal(lerData("29/02/2028"), "2028-02-29");
    assert.equal(lerData("29/02/2027"), null);
  });
});

describe("lerDecimal", () => {
  it("aceita vírgula, ponto e porcentagem; até 4 casas", () => {
    assert.equal(lerDecimal("1,65"), 1.65);
    assert.equal(lerDecimal("1.65"), 1.65);
    assert.equal(lerDecimal("12%"), 12);
    assert.equal(lerDecimal(" 0 "), 0);
    assert.equal(lerDecimal("1.234,5"), 1234.5);
    assert.equal(lerDecimal("0,1234"), 0.1234);
  });
  it("recusa texto, negativo e casas demais", () => {
    for (const t of ["", "abc", "-1", "1,23456", "1,2,3", "1e3"])
      assert.equal(lerDecimal(t), null, t);
  });
});

describe("cabeçalho", () => {
  it("reconhece nomes alternativos, com acento e maiúsculas", () => {
    const l = lerPlanilhaFiscal(
      "NCM;Operação;UF;Início;Perfil Tributário;CFOP;Alíquota ICMS\n2309;Venda;sp;01/01/2027;Revenda;5102;18",
    );
    assert.equal(l.erroGeral, null);
    assert.equal(l.linhas[0]?.erros.length, 0);
    assert.deepEqual(
      [
        l.linhas[0]?.envio?.operacao,
        l.linhas[0]?.envio?.uf_destino,
        l.linhas[0]?.envio?.vigencia_inicio,
        l.linhas[0]?.envio?.aliq_icms,
      ],
      ["venda", "SP", "2027-01-01", 18],
    );
  });
  it("recusa a planilha sem coluna obrigatória e diz o que achou", () => {
    const l = lerPlanilhaFiscal("ncm;cfop\n2309;5102");
    assert.match(l.erroGeral ?? "", /perfil, vigencia_inicio/);
    assert.match(l.erroGeral ?? "", /ncm, cfop/);
  });
  it("avisa as colunas que não conhece, sem recusar", () => {
    const l = lerPlanilhaFiscal(`${CAB};coluna_extra\n${ok};x`);
    assert.deepEqual(l.colunasIgnoradas, ["coluna_extra"]);
    assert.equal(l.linhas[0]?.erros.length, 0);
  });
  it("planilha vazia e limite de linhas", () => {
    assert.match(lerPlanilhaFiscal("").erroGeral ?? "", /vazia/);
    const muitas = csv(
      ...Array.from(
        { length: LIMITE_LINHAS_FISCAL + 1 },
        (_, i) => `${String(i).padStart(4, "0")};;;;;2027-01-01;;P${i};00;5102;18;01;1`,
      ),
    );
    assert.match(lerPlanilhaFiscal(muitas).erroGeral ?? "", /limite/);
  });
});

describe("linha válida", () => {
  it("monta o envio com tipos certos e o número da linha da planilha", () => {
    const l = lerPlanilhaFiscal(csv(ok));
    const e = l.linhas[0]?.envio;
    assert.equal(l.linhas[0]?.linha, 2);
    assert.deepEqual(e, {
      linha: 2, ncm: "2309", cest: null, operacao: "venda", regime: "normal", uf_destino: null,
      vigencia_inicio: "2027-01-01", vigencia_fim: null, perfil: "Revenda tributada",
      cst_icms: "00", csosn: null, cfop: "5102", aliq_icms: 18, reducao_base_icms: null, mva_st: null,
      cst_pis: "01", aliq_pis: 1.65, cst_cofins: null, aliq_cofins: null, cst_ibs_cbs: null, cclasstrib: null,
      origem: null, observacao: null,
    }); // prettier-ignore
  });
  it("completa os zeros que a planilha come em CST, CEST e cClassTrib", () => {
    const r = validarLinhaFiscal(
      {
        ncm: "23.09.10.00",
        cest: "100100",
        vigencia_inicio: "1/1/2027",
        perfil: "P",
        cst_icms: "0",
        cst_pis: "1",
        csosn: "102",
        cst_ibs_cbs: "0",
        cclasstrib: "1",
      },
      5,
    );
    assert.deepEqual(r.erros, []);
    assert.equal(r.envio?.ncm, "23091000");
    assert.equal(r.envio?.cest, "0100100");
    assert.equal(r.envio?.cst_icms, "00");
    assert.equal(r.envio?.cst_pis, "01");
    assert.equal(r.envio?.cst_ibs_cbs, "000");
    assert.equal(r.envio?.cclasstrib, "000001");
  });
  it("aceita regime por nome longo e NCM de 2, 4, 6 e 8 dígitos", () => {
    for (const ncm of ["23", "2309", "230910", "23091000"]) {
      assert.deepEqual(
        validarLinhaFiscal(
          {
            ncm,
            vigencia_inicio: "2027-01-01",
            perfil: "P",
            cfop: "5102",
            regime: "Simples Nacional",
          },
          2,
        ).erros,
        [],
        ncm,
      );
    }
  });
  it("zero é tributação informada (alíquota 0 basta como campo)", () => {
    assert.deepEqual(
      validarLinhaFiscal(
        { ncm: "2309", vigencia_inicio: "2027-01-01", perfil: "Isento", aliq_icms: "0" },
        2,
      ).erros,
      [],
    );
  });
});

describe("linha inválida", () => {
  const base = { ncm: "2309", vigencia_inicio: "2027-01-01", perfil: "P", cfop: "5102" };
  const erros = (extra: Record<string, string>) =>
    validarLinhaFiscal({ ...base, ...extra }, 2).erros;
  const primeiro = (extra: Record<string, string>) => erros(extra)[0] ?? "";

  it("NCM: tamanho e zero à esquerda perdido", () => {
    assert.match(primeiro({ ncm: "" }), /NCM deve ter/);
    assert.match(primeiro({ ncm: "230" }), /ímpar de dígitos.*zero à esquerda/);
    assert.match(primeiro({ ncm: "1012100" }), /ímpar/);
    assert.match(primeiro({ ncm: "230910000" }), /ímpar/);
    assert.match(primeiro({ ncm: "2" }), /ímpar/);
    assert.match(primeiro({ ncm: "ab" }), /NCM deve ter/);
  });
  it("campos de critério", () => {
    assert.match(primeiro({ cest: "123" }), /CEST/);
    assert.match(primeiro({ operacao: "Venda 1" }), /Operação/);
    assert.match(primeiro({ regime: "lucro" }), /Regime/);
    assert.match(primeiro({ uf_destino: "XX" }), /UF/);
  });
  it("datas", () => {
    assert.match(primeiro({ vigencia_inicio: "" }), /Informe o início/);
    assert.match(primeiro({ vigencia_inicio: "31/02/2027" }), /Início da vigência inválido/);
    assert.match(primeiro({ vigencia_fim: "2026-12-31" }), /anterior ao início/);
    assert.match(primeiro({ vigencia_fim: "xx" }), /Fim da vigência inválido/);
  });
  it("perfil e tributação", () => {
    assert.match(primeiro({ perfil: "" }), /nome do perfil/);
    assert.match(primeiro({ perfil: "x".repeat(121) }), /nome do perfil/);
    assert.match(primeiro({ cfop: "51" }), /CFOP/);
    assert.match(primeiro({ cst_icms: "123" }), /CST do ICMS/);
    assert.match(primeiro({ csosn: "1" + "0".repeat(3) }), /CSOSN/);
    assert.match(primeiro({ aliq_icms: "101" }), /entre 0 e 100/);
    assert.match(primeiro({ aliq_icms: "abc" }), /Alíquota de ICMS inválida/);
    assert.match(primeiro({ mva_st: "1001" }), /entre 0 e 1000/);
    assert.match(primeiro({ origem: "9" }), /Origem/);
    assert.match(primeiro({ cclasstrib: "1234567" }), /cClassTrib/);
    assert.match(primeiro({ observacao: "x".repeat(501) }), /Observação/);
  });
  it("sem nenhum campo de tributação", () => {
    assert.deepEqual(
      validarLinhaFiscal({ ncm: "2309", vigencia_inicio: "2027-01-01", perfil: "P" }, 2).erros,
      ["Informe ao menos um campo de tributação"],
    );
  });
  it("junta todos os erros da mesma linha e não monta envio", () => {
    const r = validarLinhaFiscal({ ncm: "9", vigencia_inicio: "x", perfil: "", cfop: "1" }, 7);
    assert.equal(r.envio, null);
    assert.equal(r.erros.length >= 4, true);
  });
});

describe("entre linhas", () => {
  it("a mesma regra duas vezes: a segunda é erro e aponta a primeira", () => {
    const l = lerPlanilhaFiscal(csv(ok, ok.replace("Revenda tributada", "Outro nome")));
    assert.deepEqual(l.linhas[0]?.erros, []);
    assert.match(l.linhas[1]?.erros[0] ?? "", /já aparece na linha 2/);
    assert.equal(l.linhas[1]?.envio, null);
  });
  it("regras diferentes pela UF ou CEST não se repetem", () => {
    const l = lerPlanilhaFiscal(
      csv(
        ok,
        "2309;;venda;normal;SP;2027-01-01;;Revenda tributada;00;5102;18;01;1,65",
        "2309;0100100;venda;normal;;2027-01-01;;Revenda tributada;00;5102;18;01;1,65",
      ),
    );
    assert.deepEqual(errosFiscais(l), []);
  });
  it("mesmo nome de perfil com valores iguais em várias linhas é aceito", () => {
    const l = lerPlanilhaFiscal(csv(ok, ok.replace("2309", "3004")));
    assert.deepEqual(errosFiscais(l), []);
    assert.equal(paraEnvioFiscal(l).length, 2);
  });
  it("mesmo nome de perfil (sem diferenciar maiúsculas) com valores diferentes é erro", () => {
    const l = lerPlanilhaFiscal(
      csv(
        ok,
        ok
          .replace("2309", "3004")
          .replace("Revenda tributada", "REVENDA TRIBUTADA")
          .replace(";18;", ";12;"),
      ),
    );
    assert.match(l.linhas[1]?.erros[0] ?? "", /outros valores na linha 2/);
  });
  it("errosFiscais lista linha e motivo; paraEnvioFiscal só devolve as válidas", () => {
    const l = lerPlanilhaFiscal(csv(ok, "9;;;;;2027-01-01;;P;00;5102;18;01;1"));
    assert.deepEqual(
      errosFiscais(l).map((e) => e.linha),
      [3],
    );
    assert.equal(paraEnvioFiscal(l).length, 1);
  });
  it("planilha com ponto e vírgula, aspas e linha em branco", () => {
    const l = lerPlanilhaFiscal(
      `${CAB}\r\n\r\n"2309";;"venda";;;2027-01-01;;"Revenda; tributada";00;5102;18;01;1,65\r\n`,
    );
    assert.deepEqual(errosFiscais(l), []);
    assert.equal(l.linhas[0]?.envio?.perfil, "Revenda; tributada");
    assert.equal(l.linhas[0]?.linha, 3);
  });
});
