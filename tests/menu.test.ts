import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// O menu lateral mora no AppShell. Estes testes leem o arquivo para garantir o desenho do menu: cada tela aparece uma
// vez só, os relatórios ficam no grupo "Relatórios" e todo link aponta para uma rota que existe.
const fonte = readFileSync(new URL("../src/components/app/AppShell.tsx", import.meta.url), "utf8");
const rotas = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");

const inicio = fonte.indexOf("const groups: Group[] = [");
const fim = fonte.indexOf("\n];\n", inicio);
const bloco = fonte.slice(inicio, fim);

type Grupo = { label: string; itens: { to: string; label: string; secao?: string }[] };

function grupos(): Grupo[] {
  const partes = bloco.split(/\n {2}\{\n {4}label: /).slice(1);
  return partes.map((p) => {
    const label = /^"([^"]+)"/.exec(p)?.[1] ?? "";
    const itens = [
      ...p.matchAll(/\{\s*(?:secao: "([^"]+)",\s*)?label: "([^"]+)",\s*to: "([^"]+)"/g),
    ].map((m) => ({
      ...(m[1] ? { secao: m[1] } : {}),
      label: m[2] ?? "",
      to: m[3] ?? "",
    }));
    return { label, itens };
  });
}

test("o menu da loja tem os grupos esperados, com Relatórios antes de Administração", () => {
  const nomes = grupos().map((g) => g.label);
  assert.deepEqual(nomes, [
    "Visão geral",
    "Comercial",
    "Estoque",
    "Compras",
    "Logística",
    "Financeiro",
    "Restaurante",
    "Pet shop",
    "Assistência técnica",
    "Locação de equipamentos",
    "Relatórios",
    "Administração",
  ]);
});

test("cada tela aparece uma vez só no menu", () => {
  const vistos = new Map<string, string>();
  for (const g of grupos()) {
    for (const i of g.itens) {
      assert.ok(!vistos.has(i.to), `${i.to} está em "${vistos.get(i.to)}" e em "${g.label}"`);
      vistos.set(i.to, g.label);
    }
  }
});

test("todo link do menu aponta para uma rota que existe", () => {
  for (const g of grupos()) {
    for (const i of g.itens) {
      assert.ok(rotas.includes(`'${i.to}'`), `a rota ${i.to} (${i.label}) não existe`);
    }
  }
});

test("os relatórios saíram das rotinas e ficam em Relatórios, separados por módulo", () => {
  const todos = grupos();
  const relatorios = todos.find((g) => g.label === "Relatórios");
  assert.ok(relatorios);
  const secoes = [...new Set(relatorios.itens.map((i) => i.secao))];
  assert.deepEqual(secoes, [
    "Gerencial",
    "Comercial",
    "Estoque",
    "Financeiro",
    "Fiscal",
    "Assistência técnica",
    "Locação",
    "Pet shop",
  ]);
  assert.ok(
    relatorios.itens.every((i) => i.secao),
    "todo item de Relatórios precisa de uma seção",
  );

  const moveram = [
    "/relatorio",
    "/relatorio-comissoes",
    "/relatorio-estoque",
    "/giro-estoque",
    "/movimentacoes",
    "/movimento-grade",
    "/lucro",
    "/extrato-receber",
    "/fluxo-caixa",
    "/fechamento-operador",
    "/balanco-fiscal",
    "/painel-fiscal",
    "/assistencia-lojas",
    "/relatorio-assistencia",
    "/painel-locacao",
    "/relatorio-locacoes",
    "/relatorio-pet-profissionais",
    "/painel-filial",
    "/auditoria",
  ];
  for (const to of moveram) {
    assert.equal(
      relatorios.itens.filter((i) => i.to === to).length,
      1,
      `${to} deveria estar em Relatórios`,
    );
  }
  for (const g of todos.filter((x) => x.label !== "Relatórios")) {
    for (const i of g.itens)
      assert.ok(!moveram.includes(i.to), `${i.to} ainda está em "${g.label}"`);
  }
});

test("as rotinas que registram dados seguem fora de Relatórios", () => {
  const relatorios = grupos().find((g) => g.label === "Relatórios");
  const rotinas = [
    "/estoque-movimentos",
    "/inventarios",
    "/sugestao-compra",
    "/contas-receber",
    "/caixa",
    "/nfe",
    "/pendencias-fiscais",
    "/tef-painel",
  ];
  for (const to of rotinas)
    assert.ok(!relatorios?.itens.some((i) => i.to === to), `${to} é rotina, não relatório`);
});

test("relatórios de módulo opcional respeitam a liberação do módulo", () => {
  for (const to of ["/assistencia-lojas", "/relatorio-assistencia"])
    assert.ok(fonte.includes(`"${to}"`) && /modulos\.assistencia/.test(fonte));
  for (const to of ["/painel-locacao", "/relatorio-locacoes"])
    assert.ok(fonte.includes(`"${to}"`) && /modulos\.locacao/.test(fonte));
  assert.ok(/i\.to === "\/relatorio-pet-profissionais"\) return modulos\.petshop/.test(fonte));
  assert.ok(
    /i\.to === "\/movimento-grade"/.test(fonte),
    "movimento por tamanho segue ligado à personalização",
  );
});

test("o grupo Pet shop só aparece quando o módulo está liberado e traz as telas do cadastro", () => {
  assert.ok(/g\.label === "Pet shop"\) return modulos\.petshop/.test(fonte));
  const pet = grupos().find((g) => g.label === "Pet shop");
  assert.deepEqual(
    pet?.itens.map((i) => i.to),
    ["/pet-agenda", "/pets", "/pet-servicos", "/pet-profissionais", "/pet-comissoes"],
  );
});
