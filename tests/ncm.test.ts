import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  atoTabelaNcm,
  mensagemNcmInexistente,
  ncmNaTabela,
  totalDeclaradoNcm,
  totalNcm8,
  vigenciaTabelaNcm,
} from "../src/lib/ncm.ts";
import { NCM_POR_CAPITULO } from "../src/lib/ncm-tabela.ts";

describe("tabela NCM", () => {
  it("a tabela carregada tem o total declarado e códigos bem formados", () => {
    assert.equal(totalNcm8(), totalDeclaradoNcm());
    assert.equal(totalNcm8() > 10000, true);
    for (const [cap, juntos] of Object.entries(NCM_POR_CAPITULO)) {
      assert.match(cap, /^\d{2}$/);
      assert.match(juntos, /^\d+$/);
      assert.equal(juntos.length % 6, 0, `capítulo ${cap}`);
      const codigos = juntos.match(/.{6}/g) ?? [];
      assert.deepEqual(
        codigos,
        [...new Set(codigos)].sort(),
        `capítulo ${cap} em ordem e sem repetição`,
      );
    }
  });
  it("traz a data e o ato legal da tabela", () => {
    assert.match(vigenciaTabelaNcm(), /^\d{2}\/\d{2}\/\d{4}$/);
    assert.match(atoTabelaNcm(), /Gecex/);
  });
});

describe("ncmNaTabela", () => {
  it("reconhece NCM de 8 dígitos que existe, com ou sem pontuação", () => {
    assert.equal(ncmNaTabela("23091000"), true); // alimentos para cães ou gatos, venda a retalho
    assert.equal(ncmNaTabela("2309.10.00"), true);
    assert.equal(ncmNaTabela("01012100"), true);
  });
  it("recusa NCM de 8 dígitos que não existe (dígito trocado, código inventado)", () => {
    assert.equal(ncmNaTabela("23091001"), false);
    assert.equal(ncmNaTabela("99999999"), false);
    assert.equal(ncmNaTabela("00000000"), false);
    assert.equal(ncmNaTabela("23099999"), false);
  });
  it("aceita prefixos de 2, 4 e 6 dígitos que existem e recusa os que não existem", () => {
    for (const p of ["23", "2309", "230910", "01", "0101"]) assert.equal(ncmNaTabela(p), true, p);
    for (const p of ["99", "2399", "230999", "00", "9999"]) assert.equal(ncmNaTabela(p), false, p);
  });
  it("quantidade de dígitos diferente de 2, 4, 6 ou 8 nunca existe", () => {
    for (const t of ["", "2", "230", "23091", "2309100", "230910000", "abc"]) {
      assert.equal(ncmNaTabela(t), false, t);
    }
  });
  it("mensagem diz o NCM e a data da tabela", () => {
    assert.match(
      mensagemNcmInexistente("23091001"),
      /NCM 23091001 não consta na Tabela NCM vigente em \d{2}\/\d{2}\/\d{4}/,
    );
  });
});
