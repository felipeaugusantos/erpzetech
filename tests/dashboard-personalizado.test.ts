import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PECAS_DASHBOARD_PET,
  aplicarDashboard,
  alternarPecaDashboard,
  assinaturaDashboard,
  configDasLinhas,
  lerConfigDashboard,
  montarLinhasDashboard,
  moverPecaDashboard,
} from "../src/lib/dashboard-personalizado.ts";

const ids = (l: readonly { id: string }[]) => l.map((p) => p.id);
const todas = PECAS_DASHBOARD_PET;
const semReforcos = todas.filter((p) => p.id !== "reforcos-vacina");

describe("dashboard personalizado", () => {
  it("sem configuração o dashboard é o padrão do sistema", () => {
    assert.deepEqual(ids(aplicarDashboard(todas, null)), ids(todas));
    assert.deepEqual(ids(aplicarDashboard(todas, undefined)), ids(todas));
    const vazia = lerConfigDashboard({ versao: 1 });
    assert.deepEqual(vazia, { versao: 1, ordem: [], ocultos: [] });
    assert.deepEqual(ids(aplicarDashboard(todas, vazia)), ids(todas));
  });

  it("desliga e reordena; as peças não citadas ficam no fim, na ordem do sistema", () => {
    const config = lerConfigDashboard({
      versao: 1,
      ordem: ["a-receber", "faturamento"],
      ocultos: ["faltas", "agenda-hoje"],
    });
    assert.ok(config);
    const r = ids(aplicarDashboard(todas, config));
    assert.deepEqual(r.slice(0, 2), ["a-receber", "faturamento"]);
    assert.equal(r.includes("faltas"), false);
    assert.equal(r.includes("agenda-hoje"), false);
    assert.equal(r.length, todas.length - 2);
    // o resto mantém a ordem do sistema
    assert.deepEqual(
      r.slice(2),
      ids(todas).filter((i) => !["a-receber", "faturamento", "faltas", "agenda-hoje"].includes(i)),
    );
  });

  it("peça indisponível para a pessoa nunca aparece, mesmo que a configuração a cite", () => {
    const config = lerConfigDashboard({ versao: 1, ordem: ["reforcos-vacina", "a-pagar"] });
    const r = ids(aplicarDashboard(semReforcos, config));
    assert.equal(r.includes("reforcos-vacina"), false);
    assert.equal(r[0], "a-pagar");
  });

  it("peça nova do sistema aparece sozinha no fim, sem sumir por causa de uma ordem antiga", () => {
    const antigo = lerConfigDashboard({ versao: 1, ordem: ["a-pagar", "a-receber"] });
    const comNova = [...todas, { id: "nova-peca", rotulo: "Nova", secao: "paineis" as const }];
    const r = ids(aplicarDashboard(comNova, antigo));
    assert.equal(r[r.length - 1], "nova-peca");
    assert.equal(r.length, comNova.length);
  });

  it("leitura segura: formato inválido vira padrão; ids desconhecidos e repetidos são descartados", () => {
    for (const bruto of [
      null,
      undefined,
      "x",
      3,
      {},
      { versao: 2 },
      { versao: 1, ordem: "a" },
      { versao: 1, ocultos: [1] },
      { versao: 1, ordem: Array.from({ length: 41 }, (_, i) => `p${i}`) },
    ])
      assert.equal(lerConfigDashboard(bruto), null, JSON.stringify(bruto)?.slice(0, 50));
    const c = lerConfigDashboard({
      versao: 1,
      ordem: ["a-pagar", "nao-existe", "a-pagar", "faturamento"],
      ocultos: ["faltas", "faltas", "outra"],
    });
    assert.deepEqual(c, { versao: 1, ordem: ["a-pagar", "faturamento"], ocultos: ["faltas"] });
  });

  it("subir e descer só trocam com peças da mesma seção", () => {
    const linhas = montarLinhasDashboard(todas, null);
    // o primeiro painel não sobe para o meio dos cartões
    assert.deepEqual(ids(moverPecaDashboard(linhas, "grafico-atendimentos", -1)), ids(linhas));
    // o último cartão não desce para os painéis
    assert.deepEqual(ids(moverPecaDashboard(linhas, "a-pagar", 1)), ids(linhas));
    const sobe = moverPecaDashboard(linhas, "faturamento", -1);
    assert.deepEqual(ids(sobe).slice(0, 2), ["faturamento", "atendimentos-hoje"]);
    const desce = moverPecaDashboard(linhas, "grafico-atendimentos", 1);
    assert.deepEqual(ids(desce).slice(-3), ["servicos-top", "grafico-atendimentos", "agenda-hoje"]);
  });

  it("a configuração gerada é mínima e reconstrói o mesmo desenho", () => {
    let linhas = montarLinhasDashboard(todas, null);
    assert.deepEqual(configDasLinhas(linhas, todas), { versao: 1, ordem: [], ocultos: [] });
    linhas = alternarPecaDashboard(linhas, "faltas");
    linhas = moverPecaDashboard(linhas, "a-pagar", -1);
    const config = configDasLinhas(linhas, todas);
    assert.deepEqual(config.ocultos, ["faltas"]);
    assert.ok(config.ordem.length > 0);
    assert.deepEqual(montarLinhasDashboard(todas, lerConfigDashboard(config)), linhas);
    assert.notEqual(
      assinaturaDashboard(linhas, todas),
      assinaturaDashboard(montarLinhasDashboard(todas, null), todas),
    );
  });

  it("ligar de novo uma peça desligada volta ao estado do padrão", () => {
    const base = montarLinhasDashboard(todas, null);
    const volta = alternarPecaDashboard(alternarPecaDashboard(base, "faltas"), "faltas");
    assert.equal(assinaturaDashboard(volta, todas), assinaturaDashboard(base, todas));
  });
});

describe("dashboard de vendas (catálogo próprio)", () => {
  it("o catálogo de vendas tem ids únicos, na ordem do sistema, e cada painel usa o seu", async () => {
    const { PECAS_DASHBOARD_VENDAS, catalogoDoPainel, PAINEL_VENDAS, PAINEL_PET } =
      await import("../src/lib/dashboard-personalizado.ts");
    const idsVendas = PECAS_DASHBOARD_VENDAS.map((p) => p.id);
    assert.equal(new Set(idsVendas).size, idsVendas.length);
    assert.equal(PECAS_DASHBOARD_VENDAS.filter((p) => p.secao === "resumo").length, 1);
    assert.equal(PECAS_DASHBOARD_VENDAS.filter((p) => p.secao === "indicadores").length, 8);
    assert.equal(PECAS_DASHBOARD_VENDAS.filter((p) => p.secao === "paineis").length, 8);
    assert.equal(catalogoDoPainel(PAINEL_VENDAS), PECAS_DASHBOARD_VENDAS);
    assert.equal(catalogoDoPainel(PAINEL_PET), PECAS_DASHBOARD_PET);
    assert.equal(catalogoDoPainel("qualquer"), PECAS_DASHBOARD_PET);
  });

  it("a leitura usa o catálogo do próprio painel: ids de outro painel são descartados", async () => {
    const { PECAS_DASHBOARD_VENDAS } = await import("../src/lib/dashboard-personalizado.ts");
    const bruto = {
      versao: 1,
      ordem: ["vence-hoje", "agenda-hoje"],
      ocultos: ["faltas", "pendencias-fiscais"],
    };
    assert.deepEqual(lerConfigDashboard(bruto, PECAS_DASHBOARD_VENDAS), {
      versao: 1,
      ordem: ["vence-hoje"],
      ocultos: ["pendencias-fiscais"],
    });
    assert.deepEqual(lerConfigDashboard(bruto), {
      versao: 1,
      ordem: ["agenda-hoje"],
      ocultos: ["faltas"],
    });
  });

  it("o resumo do dia não troca de lugar com cartões nem painéis", async () => {
    const { PECAS_DASHBOARD_VENDAS } = await import("../src/lib/dashboard-personalizado.ts");
    const linhas = montarLinhasDashboard(PECAS_DASHBOARD_VENDAS, null);
    assert.deepEqual(ids(moverPecaDashboard(linhas, "painel-do-dia", 1)), ids(linhas));
    assert.deepEqual(ids(moverPecaDashboard(linhas, "pedidos-andamento", -1)), ids(linhas));
    assert.deepEqual(ids(moverPecaDashboard(linhas, "fechamento-clientes", -1)), ids(linhas));
    assert.deepEqual(ids(moverPecaDashboard(linhas, "caixa-projetado", -1)).slice(9, 11), [
      "caixa-projetado",
      "fechamento-clientes",
    ]);
  });
});
