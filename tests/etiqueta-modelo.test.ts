import assert from "node:assert/strict";
import { test } from "node:test";

import { cabeNaEtiqueta, comandosEtiquetas } from "../src/lib/etiqueta-raw.ts";
import { htmlEtiquetas } from "../src/lib/etiqueta.ts";
import {
  entradaDoEstado,
  estadoDoModelo,
  estadoNovoModelo,
  modeloDaLinha,
  moverCampoEditor,
  validarModeloProprio,
} from "../src/lib/etiqueta-modelo.ts";

const BASE = {
  nome: "Gôndola 60x30",
  tipo: "termica",
  larguraMm: "60",
  alturaMm: "30,5",
  campos: [
    { campo: "preco", tamanho: "g" },
    { campo: "descricao" },
    { campo: "codigo", tamanho: "g" },
  ],
};
const DADOS = { descricao: "Ração 15kg", codigo: "4006381333931", preco: 99.9, unidade: "UN" };

test("modelo próprio: aceita números com vírgula, limpa o tamanho do código de barras e do médio", () => {
  const r = validarModeloProprio(BASE);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.config.alturaMm, 30.5);
  assert.deepEqual(r.config.campos, [
    { campo: "preco", tamanho: "g" },
    { campo: "descricao" },
    { campo: "codigo" },
  ]);
});

test("modelo próprio: recusa nome, medidas, campos repetidos ou desconhecidos", () => {
  const ruim = (o: Record<string, unknown>) =>
    assert.equal(validarModeloProprio({ ...BASE, ...o }).ok, false, JSON.stringify(o));
  ruim({ nome: " a " });
  ruim({ nome: "x".repeat(61) });
  ruim({ tipo: "outro" });
  ruim({ larguraMm: 5 });
  ruim({ alturaMm: "abc" });
  ruim({ larguraMm: 500 });
  ruim({ campos: [] });
  ruim({ campos: [{ campo: "preco" }, { campo: "preco" }] });
  ruim({ campos: [{ campo: "foto" }] });
  ruim({ campos: [{ campo: "preco", tamanho: "gg" }] });
  ruim({ campos: "preco" });
});

test("folha própria: confere colunas, linhas e se a grade cabe na A4", () => {
  const folha = {
    ...BASE,
    tipo: "folha",
    larguraMm: 60,
    alturaMm: 30,
    colunas: 3,
    linhas: 9,
    margemSuperiorMm: 10,
    margemEsquerdaMm: 5,
    espacoHMm: 2,
    espacoVMm: 0,
  };
  assert.equal(validarModeloProprio(folha).ok, true);
  assert.equal(validarModeloProprio({ ...folha, colunas: 4 }).ok, false); // 5 + 240 + 6 > 210
  assert.equal(validarModeloProprio({ ...folha, linhas: 10 }).ok, false); // 10 + 300 > 297
  assert.equal(validarModeloProprio({ ...folha, colunas: 1.5 }).ok, false);
  assert.equal(validarModeloProprio({ ...folha, colunas: undefined }).ok, false);
});

test("linha do banco: vira modelo; versão desconhecida ou lixo é ignorado", () => {
  const r = validarModeloProprio(BASE);
  assert.ok(r.ok);
  if (!r.ok) return;
  const m = modeloDaLinha({ id: "abc", nome: r.nome, config: r.config });
  assert.equal(m?.id, "proprio:abc");
  assert.equal(m?.proprio, true);
  assert.equal(m?.larguraMm, 60);
  assert.equal(modeloDaLinha({ id: "a", nome: "Boa", config: { ...r.config, versao: 2 } }), null);
  assert.equal(modeloDaLinha({ id: "a", nome: "Boa", config: null }), null);
  assert.equal(
    modeloDaLinha({ id: "a", nome: "Boa", config: { versao: 1, tipo: "termica" } }),
    null,
  );
});

test("a ordem e o tamanho dos campos mudam a etiqueta nos três formatos", () => {
  const r = validarModeloProprio(BASE);
  assert.ok(r.ok);
  if (!r.ok) return;
  const m = modeloDaLinha({ id: "x", nome: r.nome, config: r.config })!;
  const html = htmlEtiquetas(m, [DADOS]);
  assert.ok(
    html.indexOf('class="preco"') < html.indexOf('class="desc"'),
    "preço antes da descrição",
  );
  assert.ok(html.includes("font-size:18.2pt"), "preço grande (14pt × 1,3)");

  const z = comandosEtiquetas(m, [DADOS], { linguagem: "zpl", dpi: 203 });
  assert.ok(z.indexOf("R$ 99,90") < z.indexOf("Ração 15kg"), "ZPL: preço primeiro");
  assert.match(z, /\^LL244\n/); // 30,5 mm a 203 dpi

  const t = comandosEtiquetas(m, [DADOS], { linguagem: "tspl", dpi: 203 });
  assert.ok(t.indexOf("R$ 99,90") < t.indexOf("Ração 15kg"), "TSPL: preço primeiro");
  assert.match(t, /SIZE 60 mm,30.5 mm/);
  assert.match(t, /TEXT \d+,\d+,"5",0,1,1,"R\$ 99,90 \/ UN"/); // preço grande: fonte 5
});

test("sem o campo, ele não sai: modelo só com descrição não tem preço nem código", () => {
  const r = validarModeloProprio({ ...BASE, campos: [{ campo: "descricao" }] });
  assert.ok(r.ok);
  if (!r.ok) return;
  const m = modeloDaLinha({ id: "y", nome: r.nome, config: r.config })!;
  const z = comandosEtiquetas(m, [DADOS], { linguagem: "zpl", dpi: 203 });
  assert.ok(!z.includes("^BE") && !z.includes("R$"));
  assert.ok(!htmlEtiquetas(m, [DADOS]).includes("<svg"));
});

test("conteúdo grande demais encolhe as letras; o que ainda não cabe é avisado", () => {
  const mk = (w: number, h: number, tamanho: string) => {
    const r = validarModeloProprio({
      ...BASE,
      larguraMm: w,
      alturaMm: h,
      campos: ["descricao", "extra", "preco", "codigo"].map((campo) => ({ campo, tamanho })),
    });
    assert.ok(r.ok);
    return modeloDaLinha({ id: "z", nome: "Teste", config: r.ok ? r.config : null })!;
  };
  const dados = { ...DADOS, validade: "01/01/2027", lote: "L1" };
  for (const linguagem of ["zpl", "tspl"] as const) {
    const imp = { linguagem, dpi: 203 as const };
    // 100 x 50 com letras grandes cabe sem encolher
    assert.deepEqual(cabeNaEtiqueta(mk(100, 50, "g"), [dados], imp), [true]);
    // 40 x 25 com letras grandes só cabe encolhendo
    const grande = mk(40, 25, "g");
    const normal = mk(40, 25, "m");
    assert.notEqual(comandosEtiquetas(grande, [dados], imp), "");
    assert.deepEqual(cabeNaEtiqueta(normal, [dados], imp), [true]);
    // 40 x 15: não cabe de jeito nenhum, e a pessoa é avisada
    assert.deepEqual(cabeNaEtiqueta(mk(40, 15, "g"), [dados], imp), [false]);
  }
});

test("quando encolhe, a altura do código de barras não passa do fim da etiqueta", () => {
  const r = validarModeloProprio({
    ...BASE,
    larguraMm: 40,
    alturaMm: 25,
    campos: ["descricao", "extra", "preco", "codigo"].map((campo) => ({ campo, tamanho: "g" })),
  });
  assert.ok(r.ok);
  const m = modeloDaLinha({ id: "z", nome: "Teste", config: r.ok ? r.config : null })!;
  const z = comandosEtiquetas(m, [{ ...DADOS, validade: "01/01/2027", lote: "L1" }], {
    linguagem: "zpl",
    dpi: 203,
  });
  const [, y, hb] = /\^FO\d+,(\d+)\^BEN,(\d+)/.exec(z)!.map(Number);
  const H = Number(/\^LL(\d+)/.exec(z)![1]);
  assert.ok(y! + hb! + Math.round(3.5 * 8) <= H, `termina em ${y! + hb! + 28} de ${H}`);
});

test("editor: novo modelo já é válido depois de dar nome; editar devolve o mesmo modelo", () => {
  const novo = { ...estadoNovoModelo(), nome: "Prateleira" };
  const r = validarModeloProprio(entradaDoEstado(novo));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(
    r.config.campos.map((c) => c.campo),
    ["descricao", "extra", "preco", "codigo"],
  );
  const volta = estadoDoModelo("id1", r.nome, r.config);
  assert.equal(volta.id, "id1");
  const r2 = validarModeloProprio(entradaDoEstado(volta));
  assert.deepEqual(r2, r);
});

test("editor: desligar, mover e voltar a ligar campo mantém a ordem esperada", () => {
  let e = { ...estadoNovoModelo(), nome: "Teste" };
  e = moverCampoEditor(e, 2, -1); // preço sobe: descrição, preço, extra, código
  e = { ...e, campos: e.campos.map((c) => (c.campo === "extra" ? { ...c, ativo: false } : c)) };
  const r = validarModeloProprio(entradaDoEstado(e));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(
    r.config.campos.map((c) => c.campo),
    ["descricao", "preco", "codigo"],
  );
  // modelo salvo sem o campo "extra": ao reabrir, ele aparece desligado no fim
  const volta = estadoDoModelo("x", "Teste", r.config);
  assert.deepEqual(
    volta.campos.map((c) => [c.campo, c.ativo]),
    [
      ["descricao", true],
      ["preco", true],
      ["codigo", true],
      ["extra", false],
    ],
  );
  assert.equal(moverCampoEditor(e, 0, -1), e);
  assert.equal(moverCampoEditor(e, 3, 1), e);
  assert.equal(
    validarModeloProprio(
      entradaDoEstado({ ...e, campos: e.campos.map((c) => ({ ...c, ativo: false })) }),
    ).ok,
    false,
  );
});
