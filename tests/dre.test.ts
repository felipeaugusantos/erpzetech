import assert from "node:assert/strict";
import { test } from "node:test";

import { montarDre, percentualDe, periodoDoAno, periodoDoMes } from "../src/lib/dre.ts";
import {
  grupoValeParaTipo,
  gruposDoTipo,
  labelGrupo,
  podeGerirCategorias,
} from "../src/lib/categorias-financeiras.ts";

// Mesmos números do teste do banco (supabase/ci/financeiro-dre.sql, março de 2027).
const linhas = [
  {
    secao: "vendas",
    categoria_id: null,
    categoria: "Vendas de mercadorias e serviços",
    valor: 1200,
  },
  { secao: "devolucoes", categoria_id: null, categoria: "Devoluções de vendas", valor: "100" },
  { secao: "cmv", categoria_id: null, categoria: "Custo das mercadorias vendidas", valor: 400 },
  { secao: "receita_outras", categoria_id: "c1", categoria: "Receitas de serviços", valor: 400 },
  { secao: "receita_outras", categoria_id: null, categoria: "Sem categoria", valor: 60 },
  { secao: "receita_financeira", categoria_id: "c2", categoria: "Rendimentos", valor: 30 },
  { secao: "despesa_deducao", categoria_id: "c3", categoria: "Simples Nacional", valor: 80 },
  { secao: "despesa_financeira", categoria_id: "c4", categoria: "Juros pagos", valor: 1000 },
  { secao: "despesa_operacional", categoria_id: "c5", categoria: "Internet", valor: 150 },
  { secao: "despesa_operacional", categoria_id: null, categoria: "Sem categoria", valor: 35 },
];

test("o DRE fecha os subtotais na ordem do demonstrativo", () => {
  const d = montarDre(linhas);
  assert.equal(d.receitaBruta, 1660);
  assert.equal(d.receitaLiquida, 1480); // 1660 - 100 devoluções - 80 impostos sobre vendas
  assert.equal(d.lucroBruto, 1080); // 1480 - 400 CMV
  assert.equal(d.resultadoOperacional, 895); // 1080 - 185 despesas operacionais
  assert.equal(d.resultadoFinanceiro, -970); // 30 - 1000
  assert.equal(d.resultadoAntesImpostos, -75);
  assert.equal(d.resultadoLiquido, -75);
});

test("linhas do mesmo grupo vêm da maior para a menor e o que não tem categoria é somado à parte", () => {
  const d = montarDre(linhas);
  assert.deepEqual(
    d.despesasOperacionais.map((i) => i.nome),
    ["Internet", "Sem categoria"],
  );
  assert.deepEqual(d.semCategoria, { receitas: 60, despesas: 35 });
});

test("sem linhas, o DRE é zero e não quebra", () => {
  const d = montarDre([]);
  assert.equal(d.resultadoLiquido, 0);
  assert.equal(d.receitaBruta, 0);
  assert.deepEqual(d.semCategoria, { receitas: 0, despesas: 0 });
});

test("valores decimais não acumulam erro de ponto flutuante", () => {
  const d = montarDre([
    { secao: "vendas", categoria_id: null, categoria: "v", valor: 0.1 },
    { secao: "receita_outras", categoria_id: "x", categoria: "o", valor: 0.2 },
  ]);
  assert.equal(d.receitaBruta, 0.3);
});

test("percentual sobre a receita bruta, sem base não há percentual", () => {
  assert.equal(percentualDe(250, 1000), 25);
  assert.equal(percentualDe(10, 0), null);
});

test("período do mês e do ano no calendário", () => {
  assert.deepEqual(periodoDoMes("2027-03-15"), { de: "2027-03-01", ate: "2027-03-31" });
  assert.deepEqual(periodoDoMes("2028-03-15", 1), { de: "2028-02-01", ate: "2028-02-29" });
  assert.deepEqual(periodoDoMes("2027-01-10", 1), { de: "2026-12-01", ate: "2026-12-31" });
  assert.deepEqual(periodoDoAno("2027-08-09"), { de: "2027-01-01", ate: "2027-12-31" });
});

test("grupos valem só para o tipo certo (espelha o banco)", () => {
  assert.equal(grupoValeParaTipo("receita", "custo"), false);
  assert.equal(grupoValeParaTipo("despesa", "custo"), true);
  assert.equal(grupoValeParaTipo("receita", "fora_dre"), true);
  assert.equal(gruposDoTipo("receita").length, 3);
  assert.equal(gruposDoTipo("despesa").length, 6);
  assert.match(labelGrupo("despesa", "deducao"), /impostos sobre vendas/);
});

test("só administrador, gestor e financeiro cadastram categorias", () => {
  assert.equal(podeGerirCategorias(["financeiro"]), true);
  assert.equal(podeGerirCategorias(["vendedor"]), false);
});
