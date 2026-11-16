import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DADOS_LEGAIS,
  SECOES_OBRIGATORIAS_PRIVACIDADE,
  VERSAO_LEGAL,
  formatarVersaoLegal,
  identificacaoDaEmpresa,
  montarPrivacidade,
  montarTermos,
} from "../src/lib/legal.ts";

describe("termos e privacidade", () => {
  it("a versão tem o formato que o banco aceita", () => {
    assert.match(VERSAO_LEGAL, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(formatarVersaoLegal("2026-11-16"), "16/11/2026");
    assert.equal(formatarVersaoLegal("xx"), "xx");
  });

  it("identifica a empresa só com o que estiver preenchido", () => {
    assert.equal(identificacaoDaEmpresa({ ...DADOS_LEGAIS, razaoSocial: "", cnpj: "" }), "EZRA");
    assert.equal(
      identificacaoDaEmpresa({
        ...DADOS_LEGAIS,
        razaoSocial: "Ezra Ltda",
        cnpj: "12.345.678/0001-90",
      }),
      "Ezra Ltda (EZRA), CNPJ 12.345.678/0001-90",
    );
  });

  it("os dois documentos têm seções numeradas e sem parágrafo vazio", () => {
    for (const doc of [montarTermos(), montarPrivacidade()]) {
      assert.ok(doc.secoes.length >= 10, doc.titulo);
      doc.secoes.forEach((s, i) => {
        assert.ok(s.titulo.startsWith(`${i + 1}.`), `${doc.titulo}: ${s.titulo}`);
        assert.ok(
          s.paragrafos.length > 0 && s.paragrafos.every((p) => p.trim().length > 20),
          s.titulo,
        );
      });
    }
  });

  it("a política cobre o que a LGPD pede", () => {
    const titulos = montarPrivacidade()
      .secoes.map((s) => s.titulo)
      .join(" | ")
      .toLowerCase();
    const texto = JSON.stringify(montarPrivacidade()).toLowerCase();
    for (const t of SECOES_OBRIGATORIAS_PRIVACIDADE) {
      assert.ok(titulos.includes(t.toLowerCase()) || texto.includes(t.toLowerCase()), t);
    }
    assert.match(texto, /controlador/);
    assert.match(texto, /operador/);
    assert.match(texto, /anpd/);
  });

  it("os documentos citam o contato e o foro configurados", () => {
    const d = { ...DADOS_LEGAIS, foro: "Ribeirão Preto/SP", emailPrivacidade: "dpo@exemplo.com" };
    assert.match(JSON.stringify(montarTermos(d)), /Ribeirão Preto\/SP/);
    assert.match(JSON.stringify(montarPrivacidade(d)), /dpo@exemplo\.com/);
  });
});
