import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { consultaPersistivel } from "../src/lib/cache-clinico.ts";
import {
  CHAVE_PORTAL,
  agruparResultados,
  avisoDoEstado,
  chavePortal,
  codigoCompleto,
  codigoDoFragmento,
  formatarCodigo,
  linkDoConvite,
  mensagemConvite,
  normalizarCodigo,
  quandoVacina,
  referenciaDoResultado,
  valorDoResultado,
  type ResultadoExame,
} from "../src/lib/portal-tutor.ts";

describe("portal: privacidade do cache do navegador", () => {
  it("nenhuma consulta do portal pode ir para o cache em texto simples", () => {
    assert.equal(CHAVE_PORTAL.startsWith("clinica-"), true);
    for (const chave of [
      chavePortal("pets"),
      chavePortal("exame", "id-1"),
      chavePortal("receita", "id-2"),
      chavePortal("sessao"),
    ]) {
      assert.equal(consultaPersistivel(chave), false, JSON.stringify(chave));
    }
  });
});

describe("portal: código do convite", () => {
  it("normaliza maiúsculas, hífens e espaços e limita a 16", () => {
    assert.equal(normalizarCodigo("ab12-cd34 ef56_gh78 xxxx"), "AB12CD34EF56GH78");
    assert.equal(normalizarCodigo(""), "");
  });
  it("mostra em grupos de 4 e sabe quando está completo", () => {
    assert.equal(formatarCodigo("ab12cd34ef"), "AB12-CD34-EF");
    assert.equal(formatarCodigo("ab12cd34ef56gh78"), "AB12-CD34-EF56-GH78");
    assert.equal(codigoCompleto("ab12-cd34-ef56-gh78"), true);
    assert.equal(codigoCompleto("ab12-cd34"), false);
  });
  it("o código vai no fragmento do link, nunca na consulta, e volta do fragmento", () => {
    const link = linkDoConvite("https://app.exemplo.test/", "ab12-cd34-ef56-gh78");
    assert.equal(link, "https://app.exemplo.test/portal/entrar#c=AB12CD34EF56GH78");
    assert.equal(link.includes("?"), false);
    assert.equal(codigoDoFragmento("#c=AB12CD34EF56GH78"), "AB12CD34EF56GH78");
    assert.equal(codigoDoFragmento("#c=ab12-cd34-ef56-gh78"), "AB12CD34EF56GH78");
    assert.equal(codigoDoFragmento("#c=curto"), "");
    assert.equal(codigoDoFragmento(""), "");
    assert.equal(codigoDoFragmento("#x=1"), "");
  });
  it("a mensagem para a recepção copiar traz link, código e validade, sem prometer envio", () => {
    const m = mensagemConvite({
      clinica: "Clínica Alfa",
      tutor: "Ana",
      codigo: "AB12CD34EF56GH78",
      link: "https://x.test/portal/entrar#c=AB12CD34EF56GH78",
      expiraEm: "2026-11-12T12:00:00Z",
    });
    assert.match(m, /Clínica Alfa/);
    assert.match(m, /AB12-CD34-EF56-GH78/);
    assert.match(m, /uma vez/);
    assert.match(m, /#c=AB12CD34EF56GH78/);
  });
});

describe("portal: vacinas e estados", () => {
  const hoje = new Date(2026, 10, 5, 15, 0);
  it("diz quando é a próxima dose em palavras", () => {
    assert.equal(quandoVacina("2026-11-05", hoje), "hoje");
    assert.equal(quandoVacina("2026-11-06", hoje), "amanhã");
    assert.equal(quandoVacina("2026-11-25", hoje), "em 20 dias");
    assert.equal(quandoVacina("2026-11-04", hoje), "atrasada há 1 dia");
    assert.equal(quandoVacina("2026-10-26", hoje), "atrasada há 10 dias");
    assert.equal(quandoVacina("2026-11-25T00:00:00Z", hoje), "em 20 dias");
  });
  it("cada estado tem um aviso claro; disponível não tem aviso", () => {
    assert.equal(avisoDoEstado("disponivel", "exame"), null);
    assert.match(avisoDoEstado("nao_liberado", "exame") ?? "", /ainda não liberou/);
    assert.match(avisoDoEstado("cancelado", "receita") ?? "", /cancelada pela clínica.*Não use/);
    assert.match(avisoDoEstado("indisponivel", "exame") ?? "", /não está disponível/);
  });
});

describe("portal: resultado do exame (só exibição)", () => {
  const num = (p: Partial<ResultadoExame>): ResultadoExame => ({
    grupo: null,
    nome: "Hemácias",
    unidade: "milhões/µL",
    forma: "numero",
    casas: 2,
    valor_num: 6.8,
    valor_texto: null,
    faixa_min: 5.5,
    faixa_max: 8.5,
    ...p,
  });
  it("número com as casas do campo e a unidade; texto como veio; sem valor vira traço", () => {
    assert.equal(valorDoResultado(num({})), "6,80 milhões/µL");
    assert.equal(valorDoResultado(num({ casas: 0, valor_num: 12, unidade: null })), "12");
    assert.equal(
      valorDoResultado(num({ valor_num: null, valor_texto: "Normal", forma: "texto" })),
      "Normal",
    );
    assert.equal(valorDoResultado(num({ valor_num: null })), "—");
    assert.equal(valorDoResultado(num({ valor_num: 0 })), "0,00 milhões/µL");
  });
  it("mostra a referência cadastrada pela clínica, sem comparar com o valor e sem inventar", () => {
    assert.equal(referenciaDoResultado(num({})), "5,50 a 8,50");
    assert.equal(referenciaDoResultado(num({ faixa_max: null })), "a partir de 5,50");
    assert.equal(referenciaDoResultado(num({ faixa_min: null })), "até 8,50");
    assert.equal(referenciaDoResultado(num({ faixa_min: null, faixa_max: null })), null);
    assert.equal(referenciaDoResultado(num({ forma: "texto" })), null);
    // valor fora da faixa: a referência é a mesma, nada de "alto" ou "baixo"
    assert.equal(referenciaDoResultado(num({ valor_num: 99 })), "5,50 a 8,50");
  });
  it("agrupa pela ordem de chegada e usa Resultados para o que não tem grupo", () => {
    const g = agruparResultados([
      num({ grupo: "Eritrograma", nome: "A" }),
      num({ grupo: null, nome: "B" }),
      num({ grupo: "Eritrograma", nome: "C" }),
      num({ grupo: "  ", nome: "D" }),
    ]);
    assert.deepEqual(
      g.map((x) => [x.grupo, x.itens.map((i) => i.nome)]),
      [
        ["Eritrograma", ["A", "C"]],
        ["Resultados", ["B", "D"]],
      ],
    );
  });
});
