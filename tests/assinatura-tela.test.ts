import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  lerResumoAssinatura,
  saldoDaFatura,
  situacaoDaFatura,
  totaisDasFaturas,
  totalMensal,
} from "../src/lib/assinatura-tela.ts";

const base = {
  cliente: {
    nome: "Loja X",
    situacao: "ativo",
    dia_vencimento: 10,
    filiais_extras: 2,
    teste_ate: null,
    implantacao_paga: true,
    cobranca_automatica: true,
  },
  plano: {
    codigo: "loja",
    nome: "Loja",
    resumo: "1 loja",
    valor_mensal: 299,
    valor_filial_extra: 390,
    valor_implantacao: 1500,
    recursos: ["NF-e", 5],
  },
  taxa_inicial: { valor: 1500, rotulo: "Implantação" },
  faturas: [
    {
      id: "a",
      tipo: "mensalidade",
      descricao: "Mensalidade",
      valor: 299,
      valor_pago: 299,
      vencimento: "2026-10-10",
      pago_em: "2026-10-09",
      url: "https://pay.exemplo/a",
    },
    {
      id: "b",
      tipo: "mensalidade",
      descricao: "Mensalidade",
      valor: 299,
      valor_pago: 100,
      vencimento: "2026-11-10",
      url: "javascript:alert(1)",
    },
    {
      id: "c",
      tipo: "filial_extra",
      descricao: "Filiais",
      valor: 780,
      valor_pago: 0,
      vencimento: "2026-12-10",
    },
    "lixo",
    { id: "sem-vencimento" },
  ],
};

describe("tela de assinatura: leitura", () => {
  it("lê o retorno e descarta o que não presta", () => {
    const r = lerResumoAssinatura(base);
    assert.ok(r);
    assert.equal(r.cliente.nome, "Loja X");
    assert.equal(r.cliente.cobrancaAutomatica, true);
    assert.equal(r.plano?.valorMensal, 299);
    assert.deepEqual(r.plano?.recursos, ["NF-e"]);
    assert.equal(r.faturas.length, 3);
    assert.equal(r.faturas[0]?.url, "https://pay.exemplo/a");
    assert.equal(r.faturas[1]?.url, null);
  });

  it("sem assinatura ou formato errado vira nulo", () => {
    assert.equal(lerResumoAssinatura(null), null);
    assert.equal(lerResumoAssinatura([]), null);
    assert.equal(lerResumoAssinatura({ cliente: {} }), null);
    const sem = lerResumoAssinatura({ ...base, plano: null });
    assert.equal(sem?.plano, null);
    assert.equal(totalMensal(sem!), 0);
  });
});

describe("tela de assinatura: contas", () => {
  const r = lerResumoAssinatura(base)!;
  const hoje = "2026-11-20";

  it("saldo e situação de cada fatura", () => {
    assert.equal(saldoDaFatura(r.faturas[0]!), 0);
    assert.equal(saldoDaFatura(r.faturas[1]!), 199);
    assert.equal(saldoDaFatura({ valor: 10, valorPago: 20 }), 0);
    assert.equal(situacaoDaFatura(r.faturas[0]!, hoje), "paga");
    assert.equal(situacaoDaFatura(r.faturas[1]!, hoje), "atrasada");
    assert.equal(situacaoDaFatura(r.faturas[2]!, hoje), "aberta");
  });

  it("totais pago, em aberto e em atraso", () => {
    assert.deepEqual(totaisDasFaturas(r.faturas, hoje), { pago: 399, aberto: 979, vencido: 199 });
  });

  it("total mensal soma as filiais extras", () => {
    assert.equal(totalMensal(r), 299 + 2 * 390);
  });
});
