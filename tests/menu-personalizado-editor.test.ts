import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aplicarMenuPersonalizado, essenciaisDoMenu } from "../src/lib/menu-personalizado.ts";
import {
  MAX_AREAS_PROPRIAS,
  adicionarAreaPropria,
  alternarOculto,
  assinatura,
  conferirConfig,
  excluirAreaPropria,
  layoutParaConfig,
  montarLayout,
  moverArea,
  moverItem,
  moverItemParaArea,
  renomearAreaPropria,
  type LayoutEditor,
} from "../src/lib/menu-personalizado-editor.ts";

type Item = { label: string; to?: string; secao?: string };
type Area = { label: string; items: Item[] };
const item = (to: string, secao?: string): Item => ({ label: to, to, ...(secao ? { secao } : {}) });
const base: Area[] = [
  { label: "Início", items: [item("/dashboard")] },
  { label: "Pet shop", items: [item("/pets"), item("/pet-contatos"), item("/pet-agenda")] },
  {
    label: "Clínica",
    items: [item("/clinica-prontuario"), item("/clinica-fila"), item("/clinica-reforcos")],
  },
  { label: "Ajustes", items: [item("/configuracoes"), item("/usuarios"), item("/empresa")] },
];
const criar = (nome: string): Area => ({ label: nome, items: [] });
const padrao = () => montarLayout(base, null);
const caminhos = (l: LayoutEditor, chave: string) =>
  l.find((a) => a.chave === chave)?.itens.map((i) => i.to);
const ok = (r: { ok: boolean; layout?: LayoutEditor; erro?: string }) => {
  assert.equal(r.ok, true, r.erro);
  return r.layout as LayoutEditor;
};

describe("editor do menu: desenho e configuração", () => {
  it("sem configuração o desenho é o menu do sistema, sem nada escondido", () => {
    const l = padrao();
    assert.deepEqual(
      l.map((a) => a.chave),
      ["Início", "Pet shop", "Clínica", "Ajustes"],
    );
    assert.equal(
      l.flatMap((a) => a.itens).some((i) => i.oculto),
      false,
    );
    assert.equal(
      l.some((a) => a.propria),
      false,
    );
  });

  it("sem alterações a configuração gerada fica vazia (nada diferente do padrão)", () => {
    assert.deepEqual(layoutParaConfig(padrao(), base), {
      versao: 1,
      ocultos: [],
      areas: [],
      ordemAreas: [],
      itens: {},
      ordemItens: {},
    });
  });

  it("caso da clínica: Pets e tutores e Contatos vão para a Clínica e o resto do pet shop some", () => {
    let l = padrao();
    l = moverItemParaArea(l, "/pets", "Clínica");
    l = moverItemParaArea(l, "/pet-contatos", "Clínica");
    l = alternarOculto(l, "/pet-agenda");
    const config = conferirConfig(layoutParaConfig(l, base));
    assert.ok(config);
    const menu = aplicarMenuPersonalizado<Item, Area>(base, config, criar);
    assert.equal(
      menu.some((a) => a.label === "Pet shop"),
      false,
    );
    assert.deepEqual(
      menu.find((a) => a.label === "Clínica")?.items.map((i) => i.to),
      ["/clinica-prontuario", "/clinica-fila", "/clinica-reforcos", "/pets", "/pet-contatos"],
    );
  });

  it("ida e volta: o que a configuração gera reconstrói o mesmo desenho", () => {
    let l = padrao();
    l = ok(adicionarAreaPropria(l, "Meu dia a dia"));
    l = moverItemParaArea(l, "/clinica-fila", "meu-1");
    l = moverItemParaArea(l, "/pets", "meu-1");
    l = moverItem(l, "/pets", -1);
    l = alternarOculto(l, "/empresa");
    l = moverArea(l, "meu-1", -1);
    l = moverArea(l, "meu-1", -1);
    const config = conferirConfig(layoutParaConfig(l, base));
    assert.ok(config);
    assert.deepEqual(montarLayout(base, config), l);
    // e o menu aplicado mostra o que o desenho mostra (sem as telas escondidas)
    const menu = aplicarMenuPersonalizado<Item, Area>(base, config, criar);
    assert.deepEqual(
      menu.map((a) => a.label),
      ["Início", "Pet shop", "Meu dia a dia", "Clínica", "Ajustes"],
    );
    assert.deepEqual(
      menu.find((a) => a.label === "Meu dia a dia")?.items.map((i) => i.to),
      ["/pets", "/clinica-fila"],
    );
  });

  it("só reordenar as áreas gera só a ordem das áreas", () => {
    const config = layoutParaConfig(moverArea(padrao(), "Clínica", -1), base);
    assert.deepEqual(config.ordemAreas, ["Início", "Clínica", "Pet shop", "Ajustes"]);
    assert.deepEqual(config.ocultos, []);
    assert.deepEqual(config.itens, {});
    assert.deepEqual(config.ordemItens, {});
  });

  it("assinatura muda só quando o desenho muda", () => {
    const a = assinatura(padrao(), base);
    assert.equal(
      assinatura(moverItem(padrao(), "/pets", -1), base),
      a,
      "subir o primeiro item não muda nada",
    );
    assert.notEqual(assinatura(moverItem(padrao(), "/pets", 1), base), a);
  });
});

describe("editor do menu: operações", () => {
  it("subir e descer dentro da área respeitam as pontas", () => {
    const l = moverItem(padrao(), "/pets", 1);
    assert.deepEqual(caminhos(l, "Pet shop"), ["/pet-contatos", "/pets", "/pet-agenda"]);
    assert.deepEqual(caminhos(moverItem(l, "/pet-agenda", 1), "Pet shop"), caminhos(l, "Pet shop"));
    assert.deepEqual(caminhos(moverItem(padrao(), "/pets", -1), "Pet shop"), [
      "/pets",
      "/pet-contatos",
      "/pet-agenda",
    ]);
  });

  it("telas essenciais não se escondem", () => {
    let l = padrao();
    for (const to of ["/configuracoes", "/usuarios", "/menu-personalizado"])
      l = alternarOculto(l, to);
    assert.equal(
      l.flatMap((a) => a.itens).some((i) => i.oculto),
      false,
    );
    assert.equal(
      alternarOculto(padrao(), "/empresa")
        .flatMap((a) => a.itens)
        .find((i) => i.to === "/empresa")?.oculto,
      true,
    );
  });

  it("mover para área inexistente ou para a mesma área não faz nada", () => {
    assert.deepEqual(moverItemParaArea(padrao(), "/pets", "Nada"), padrao());
    assert.deepEqual(moverItemParaArea(padrao(), "/pets", "Pet shop"), padrao());
    assert.deepEqual(moverItemParaArea(padrao(), "/nao-existe", "Clínica"), padrao());
  });

  it("nome de área própria: tamanho, repetição com áreas do sistema e entre si", () => {
    const l = padrao();
    for (const nome of ["", "a", " x ", "x".repeat(31), "clínica", "PET SHOP"])
      assert.equal(adicionarAreaPropria(l, nome).ok, false, nome);
    const com = ok(adicionarAreaPropria(l, "  Rotina  "));
    assert.equal(com.find((a) => a.propria)?.nome, "Rotina");
    assert.equal(adicionarAreaPropria(com, "rotina").ok, false);
  });

  it("limite de áreas próprias e ids que não se repetem", () => {
    let l = padrao();
    for (let i = 1; i <= MAX_AREAS_PROPRIAS; i++) l = ok(adicionarAreaPropria(l, `Área ${i}`));
    assert.equal(new Set(l.map((a) => a.chave)).size, l.length);
    assert.equal(adicionarAreaPropria(l, "Mais uma").ok, false);
    const sem = excluirAreaPropria(l, "meu-1", base);
    assert.equal(
      ok(adicionarAreaPropria(sem, "Nova")).find((a) => a.nome === "Nova")?.chave,
      "meu-1",
    );
  });

  it("renomear só vale para área própria", () => {
    const l = ok(adicionarAreaPropria(padrao(), "Rotina"));
    assert.equal(renomearAreaPropria(l, "Clínica", "Outro").ok, false);
    assert.equal(
      ok(renomearAreaPropria(l, "meu-1", "Dia a dia")).find((a) => a.chave === "meu-1")?.nome,
      "Dia a dia",
    );
    assert.equal(renomearAreaPropria(l, "meu-1", "Clínica").ok, false);
  });

  it("excluir a área própria devolve as telas para onde estavam no sistema", () => {
    let l = ok(adicionarAreaPropria(padrao(), "Rotina"));
    l = moverItemParaArea(l, "/pets", "meu-1");
    l = moverItemParaArea(l, "/clinica-fila", "meu-1");
    const r = excluirAreaPropria(l, "meu-1", base);
    assert.equal(
      r.some((a) => a.chave === "meu-1"),
      false,
    );
    assert.ok(caminhos(r, "Pet shop")?.includes("/pets"));
    assert.ok(caminhos(r, "Clínica")?.includes("/clinica-fila"));
    assert.deepEqual(excluirAreaPropria(l, "Clínica", base), l);
  });

  it("área própria vazia continua no desenho e na configuração", () => {
    const l = ok(adicionarAreaPropria(padrao(), "Vazia"));
    const config = conferirConfig(layoutParaConfig(l, base));
    assert.ok(config);
    assert.equal(
      montarLayout(base, config).some((a) => a.chave === "meu-1"),
      true,
    );
    // no menu aplicado, a área vazia não aparece
    assert.equal(
      aplicarMenuPersonalizado<Item, Area>(base, config, criar).some((a) => a.label === "Vazia"),
      false,
    );
  });
});

describe("editor do menu: telas da clínica", () => {
  const clinica = essenciaisDoMenu(true);
  const baseClinica: Area[] = [
    {
      label: "Pet shop",
      items: [
        item("/pets"),
        item("/pet-servicos"),
        item("/pet-profissionais"),
        item("/pet-agenda"),
      ],
    },
    { label: "Clínica", items: [item("/clinica-fila")] },
  ];

  it("com clínica, Serviços e Profissionais não se escondem no editor; sem clínica, sim", () => {
    const com = alternarOculto(
      alternarOculto(montarLayout(baseClinica, null, clinica), "/pet-servicos", clinica),
      "/pet-profissionais",
      clinica,
    );
    assert.equal(
      com.flatMap((a) => a.itens).some((i) => i.oculto),
      false,
    );
    const sem = alternarOculto(montarLayout(baseClinica, null), "/pet-servicos");
    assert.equal(sem.flatMap((a) => a.itens).find((i) => i.to === "/pet-servicos")?.oculto, true);
    // a tela que não é da clínica esconde normalmente
    assert.equal(
      alternarOculto(montarLayout(baseClinica, null, clinica), "/pet-agenda", clinica)
        .flatMap((a) => a.itens)
        .find((i) => i.to === "/pet-agenda")?.oculto,
      true,
    );
  });

  it("uma configuração antiga que escondia essas telas abre no editor com elas visíveis, e salvar deixa de escondê-las", () => {
    const antiga = {
      versao: 1 as const,
      ocultos: ["/pet-servicos", "/pet-profissionais", "/pet-agenda"],
      areas: [],
      ordemAreas: [],
      itens: {},
      ordemItens: {},
    };
    const layout = montarLayout(baseClinica, antiga, clinica);
    const ocultas = layout
      .flatMap((a) => a.itens)
      .filter((i) => i.oculto)
      .map((i) => i.to);
    assert.deepEqual(ocultas, ["/pet-agenda"]);
    assert.deepEqual(layoutParaConfig(layout, baseClinica, clinica).ocultos, ["/pet-agenda"]);
  });
});
