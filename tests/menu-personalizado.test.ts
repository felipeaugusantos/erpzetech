import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ESSENCIAIS_DA_CLINICA,
  ESSENCIAIS_MENU,
  aplicarMenuPersonalizado,
  essenciaisDoMenu,
  essenciaisEscondidosPelaConfig,
  lerConfigMenu,
  type ConfigMenu,
} from "../src/lib/menu-personalizado.ts";

type Item = { label: string; to?: string; secao?: string };
type Area = { label: string; icon: string; items: Item[] };

const item = (to: string, secao?: string): Item => ({ label: to, to, ...(secao ? { secao } : {}) });
const base = (): Area[] => [
  { label: "Início", icon: "i", items: [item("/dashboard")] },
  {
    label: "Pet shop",
    icon: "p",
    items: [item("/pets"), item("/pet-contatos"), item("/pet-agenda")],
  },
  {
    label: "Clínica",
    icon: "c",
    items: [item("/clinica-prontuario"), item("/clinica-fila"), item("/clinica-reforcos")],
  },
  {
    label: "Ajustes",
    icon: "a",
    items: [item("/configuracoes"), item("/usuarios"), item("/empresa")],
  },
];
const criar = (nome: string): Area => ({ label: nome, icon: "n", items: [] });
const config = (parcial: Partial<ConfigMenu>): ConfigMenu =>
  lerConfigMenu({ versao: 1, ...parcial }) as ConfigMenu;
const caminhos = (a: Area | undefined) => a?.items.map((i) => i.to);
const area = (r: Area[], rotulo: string) => r.find((a) => a.label === rotulo);

describe("menu personalizado", () => {
  it("sem configuração o menu não muda", () => {
    assert.deepEqual(aplicarMenuPersonalizado(base(), null, criar), base());
    assert.deepEqual(aplicarMenuPersonalizado(base(), undefined, criar), base());
    assert.deepEqual(aplicarMenuPersonalizado(base(), config({}), criar), base());
  });

  it("esconde telas e a área que fica vazia some", () => {
    const r = aplicarMenuPersonalizado(
      base(),
      config({ ocultos: ["/pets", "/pet-contatos", "/pet-agenda", "/empresa"] }),
      criar,
    );
    assert.equal(area(r, "Pet shop"), undefined);
    assert.deepEqual(caminhos(area(r, "Ajustes")), ["/configuracoes", "/usuarios"]);
  });

  it("telas essenciais nunca saem, mesmo pedidas", () => {
    const r = aplicarMenuPersonalizado(base(), config({ ocultos: [...ESSENCIAIS_MENU] }), criar);
    assert.deepEqual(caminhos(area(r, "Ajustes")), ["/configuracoes", "/usuarios", "/empresa"]);
  });

  it("move Pets e tutores e Contatos para a Clínica e a área Pet shop some", () => {
    const r = aplicarMenuPersonalizado(
      base(),
      config({
        ocultos: ["/pet-agenda"],
        itens: { "/pets": { area: "Clínica" }, "/pet-contatos": { area: "Clínica" } },
      }),
      criar,
    );
    assert.equal(area(r, "Pet shop"), undefined);
    assert.deepEqual(caminhos(area(r, "Clínica")), [
      "/clinica-prontuario",
      "/clinica-fila",
      "/clinica-reforcos",
      "/pets",
      "/pet-contatos",
    ]);
  });

  it("cria área própria, move telas para ela e respeita a ordem", () => {
    const r = aplicarMenuPersonalizado(
      base(),
      config({
        areas: [{ id: "meu-dia", nome: "Meu dia a dia" }],
        itens: { "/clinica-fila": { area: "meu-dia" }, "/pets": { area: "meu-dia" } },
        ordemItens: { "meu-dia": ["/pets", "/clinica-fila"] },
        ordemAreas: ["meu-dia", "Início"],
      }),
      criar,
    );
    assert.deepEqual(
      r.map((a) => a.label),
      ["Meu dia a dia", "Início", "Pet shop", "Clínica", "Ajustes"],
    );
    assert.deepEqual(caminhos(area(r, "Meu dia a dia")), ["/pets", "/clinica-fila"]);
    assert.equal(caminhos(area(r, "Clínica"))?.includes("/clinica-fila"), false);
  });

  it("telas novas do sistema aparecem no fim, sem sumir por causa de uma ordem antiga", () => {
    const r = aplicarMenuPersonalizado(
      base(),
      config({ ordemItens: { Clínica: ["/clinica-reforcos", "/clinica-fila"] } }),
      criar,
    );
    assert.deepEqual(caminhos(area(r, "Clínica")), [
      "/clinica-reforcos",
      "/clinica-fila",
      "/clinica-prontuario",
    ]);
  });

  it("nunca libera o que a pessoa não vê: tela ausente é ignorada em mover e ordenar", () => {
    const r = aplicarMenuPersonalizado(
      base(),
      config({
        itens: { "/ze-tech-contratos": { area: "Clínica" }, "/pets": { area: "AreaQueNaoExiste" } },
        ordemItens: { Clínica: ["/ze-tech-contratos", "/clinica-fila"] },
      }),
      criar,
    );
    assert.equal(r.flatMap((a) => caminhos(a)).includes("/ze-tech-contratos"), false);
    assert.deepEqual(caminhos(area(r, "Pet shop")), ["/pets", "/pet-contatos", "/pet-agenda"]);
    assert.equal(caminhos(area(r, "Clínica"))?.[0], "/clinica-fila");
  });

  it("área própria com o nome de uma área do sistema é ignorada", () => {
    const r = aplicarMenuPersonalizado(
      base(),
      config({
        areas: [{ id: "meu-x", nome: "clínica" }],
        itens: { "/pets": { area: "meu-x" } },
      }),
      criar,
    );
    assert.deepEqual(caminhos(area(r, "Pet shop")), ["/pets", "/pet-contatos", "/pet-agenda"]);
    assert.equal(r.filter((a) => a.label.toLowerCase() === "clínica").length, 1);
  });

  it("a ordem própria tira as seções do sistema e telas movidas perdem a seção", () => {
    const comSecao: Area[] = [
      {
        label: "Relatórios",
        icon: "r",
        items: [item("/lucro", "Comercial"), item("/giro", "Estoque")],
      },
      { label: "Clínica", icon: "c", items: [item("/clinica-fila")] },
    ];
    const r = aplicarMenuPersonalizado(
      comSecao,
      config({ itens: { "/lucro": { area: "Clínica" } }, ordemItens: { Relatórios: ["/giro"] } }),
      criar,
    );
    assert.equal(area(r, "Clínica")?.items.find((i) => i.to === "/lucro")?.secao, undefined);
    assert.equal(area(r, "Relatórios")?.items[0]?.secao, undefined);
  });

  it("não altera os dados de entrada", () => {
    const entrada = base();
    const copia = JSON.stringify(entrada);
    aplicarMenuPersonalizado(
      entrada,
      config({ ocultos: ["/pets"], itens: { "/pet-contatos": { area: "Clínica" } } }),
      criar,
    );
    assert.equal(JSON.stringify(entrada), copia);
  });
});

describe("leitura da configuração", () => {
  it("formato inválido, versão desconhecida ou excesso viram 'sem personalização'", () => {
    for (const bruto of [
      null,
      undefined,
      "texto",
      42,
      {},
      { versao: 2 },
      { versao: 1, ocultos: ["sem-barra"] },
      { versao: 1, ocultos: ["/ok", "/com espaço"] },
      { versao: 1, areas: [{ id: "x", nome: "Sem prefixo" }] },
      { versao: 1, areas: [{ id: "meu-a", nome: "A" }] },
      { versao: 1, ocultos: Array.from({ length: 301 }, (_, i) => `/t${i}`) },
      {
        versao: 1,
        areas: Array.from({ length: 11 }, (_, i) => ({ id: `meu-${i}`, nome: `Área ${i}` })),
      },
    ])
      assert.equal(lerConfigMenu(bruto), null, JSON.stringify(bruto)?.slice(0, 60));
  });

  it("áreas próprias repetidas (id ou nome) invalidam a configuração", () => {
    const a = { id: "meu-a", nome: "Rotina" };
    assert.equal(lerConfigMenu({ versao: 1, areas: [a, a] }), null);
    assert.equal(lerConfigMenu({ versao: 1, areas: [a, { id: "meu-b", nome: "rotina" }] }), null);
  });

  it("configuração válida entra com os padrões preenchidos", () => {
    const c = lerConfigMenu({ versao: 1 });
    assert.deepEqual(c, {
      versao: 1,
      ocultos: [],
      areas: [],
      ordemAreas: [],
      itens: {},
      ordemItens: {},
    });
  });
});

describe("telas de que a clínica depende", () => {
  const baseClinica = (): Area[] => [
    { label: "Início", icon: "i", items: [item("/dashboard")] },
    {
      label: "Pet shop",
      icon: "p",
      items: [
        item("/pets"),
        item("/pet-agenda"),
        item("/pet-servicos"),
        item("/pet-profissionais"),
        item("/pet-contatos"),
      ],
    },
    { label: "Clínica", icon: "c", items: [item("/clinica-fila"), item("/clinica-reforcos")] },
    { label: "Ajustes", icon: "a", items: [item("/configuracoes"), item("/usuarios")] },
  ];
  // configuração parecida com a que uma clínica real salvou: escondeu serviços e profissionais em vez de movê-los
  const escondeu = (): ConfigMenu =>
    config({
      ocultos: ["/pet-agenda", "/pet-profissionais", "/pet-servicos", "/pet-contatos"],
      itens: { "/pets": { area: "Clínica" } },
    });

  it("a lista de essenciais só cresce numa empresa com clínica", () => {
    assert.deepEqual(essenciaisDoMenu(false), [...ESSENCIAIS_MENU]);
    for (const t of ["/pet-servicos", "/pet-profissionais"]) {
      assert.equal(essenciaisDoMenu(true).includes(t), true, t);
      assert.equal(essenciaisDoMenu(false).includes(t), false, t);
    }
    assert.deepEqual([...ESSENCIAIS_DA_CLINICA].sort(), ["/pet-profissionais", "/pet-servicos"]);
  });

  it("com clínica, Serviços e preços e Profissionais não saem do menu, mesmo escondidos na configuração", () => {
    const r = aplicarMenuPersonalizado(baseClinica(), escondeu(), criar, essenciaisDoMenu(true));
    const todas = r.flatMap((a) => caminhos(a));
    assert.equal(todas.includes("/pet-servicos"), true);
    assert.equal(todas.includes("/pet-profissionais"), true);
    // o que a pessoa escondeu e a clínica não exige continua escondido
    assert.equal(todas.includes("/pet-agenda"), false);
    assert.equal(todas.includes("/pet-contatos"), false);
    // o que ela moveu continua movido
    assert.ok(caminhos(area(r, "Clínica"))?.includes("/pets"));
    // as duas telas ficam onde estavam (área Pet shop)
    assert.deepEqual(caminhos(area(r, "Pet shop")), ["/pet-servicos", "/pet-profissionais"]);
  });

  it("sem clínica (pet shop sozinho) as mesmas telas podem ser escondidas", () => {
    const r = aplicarMenuPersonalizado(baseClinica(), escondeu(), criar, essenciaisDoMenu(false));
    const todas = r.flatMap((a) => caminhos(a));
    assert.equal(todas.includes("/pet-servicos"), false);
    assert.equal(todas.includes("/pet-profissionais"), false);
  });

  it("avisa quais telas da clínica a configuração salva escondia", () => {
    assert.deepEqual(essenciaisEscondidosPelaConfig(escondeu(), essenciaisDoMenu(true)), [
      "/pet-profissionais",
      "/pet-servicos",
    ]);
    assert.deepEqual(essenciaisEscondidosPelaConfig(escondeu(), essenciaisDoMenu(false)), []);
    assert.deepEqual(essenciaisEscondidosPelaConfig(null, essenciaisDoMenu(true)), []);
  });
});
