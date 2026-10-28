import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { moduloLiberadoEmpresa } from "../src/lib/cnae-regras.ts";
import {
  MODULOS,
  MODULOS_PRODUTO,
  camposDoModulo,
  dadosParaFormulario,
  dadosParaSalvar,
  dadosVazios,
  errosDoModulo,
  exigeLote,
  moduloDoRamo,
  resumoDoModulo,
} from "../src/lib/modulos-produto.ts";

test("os quatro módulos têm cadastro próprio e os outros ramos seguem com o padrão", () => {
  assert.deepEqual(MODULOS, ["construcao", "petshop", "clinica", "lavarapido"]);
  assert.equal(moduloDoRamo("petshop"), "petshop");
  assert.equal(moduloDoRamo("lavarapido"), "lavarapido");
  for (const outro of ["roupas", "autopecas", "agro", "restaurante", "outro", "", null, undefined])
    assert.equal(moduloDoRamo(outro), null);
  assert.deepEqual(camposDoModulo("roupas"), []);
  assert.deepEqual(dadosParaSalvar("roupas", { tipo: "insumo" }), {});
});

test("cada módulo tem os campos combinados", () => {
  const chaves = (m: keyof typeof MODULOS_PRODUTO) => MODULOS_PRODUTO[m].campos.map((c) => c.chave);
  assert.deepEqual(chaves("construcao"), [
    "linha_aplicacao",
    "bitola_medida",
    "cor_acabamento",
    "venda_fracionada",
  ]);
  assert.deepEqual(chaves("petshop"), [
    "especie",
    "porte",
    "fase_vida",
    "sabor_linha",
    "peso_embalagem_kg",
    "registro_mapa",
  ]);
  assert.deepEqual(chaves("clinica"), [
    "tipo",
    "principio_ativo",
    "concentracao_forma",
    "via_administracao",
    "registro_mapa",
    "controlado",
    "conservacao",
  ]);
  assert.deepEqual(chaves("lavarapido"), ["tipo", "rendimento_lavagens", "perigoso"]);
});

test("obrigatórios só na clínica e no lava-rápido (o tipo do produto)", () => {
  assert.deepEqual(errosDoModulo("construcao", dadosVazios("construcao")), []);
  assert.deepEqual(errosDoModulo("petshop", dadosVazios("petshop")), []);
  assert.deepEqual(errosDoModulo("clinica", dadosVazios("clinica")), ["Informe: Tipo do produto"]);
  assert.deepEqual(errosDoModulo("lavarapido", dadosVazios("lavarapido")), [
    "Informe: Tipo do produto",
  ]);
  assert.deepEqual(
    errosDoModulo("lavarapido", { ...dadosVazios("lavarapido"), tipo: "insumo" }),
    [],
  );
});

test("valores inválidos são recusados na tela", () => {
  const pet = dadosVazios("petshop");
  assert.deepEqual(errosDoModulo("petshop", { ...pet, especie: "dragao" }), [
    "Espécie: valor inválido",
  ]);
  assert.deepEqual(errosDoModulo("petshop", { ...pet, peso_embalagem_kg: "-2" }), [
    "Peso da embalagem (kg): informe um número válido",
  ]);
  assert.deepEqual(errosDoModulo("petshop", { ...pet, peso_embalagem_kg: "abc" }), [
    "Peso da embalagem (kg): informe um número válido",
  ]);
  assert.deepEqual(errosDoModulo("petshop", { ...pet, peso_embalagem_kg: "15,5" }), []);
  assert.deepEqual(errosDoModulo("petshop", { ...pet, sabor_linha: "x".repeat(121) }), [
    "Sabor ou linha: até 120 caracteres",
  ]);
});

test("o que vai para o banco: só as chaves do módulo, sem vazios, número como número", () => {
  const f = {
    ...dadosVazios("petshop"),
    especie: "cao",
    porte: "",
    sabor_linha: "  frango  ",
    peso_embalagem_kg: "15,5",
    lixo: "x",
  };
  assert.deepEqual(dadosParaSalvar("petshop", f), {
    especie: "cao",
    sabor_linha: "frango",
    peso_embalagem_kg: 15.5,
  });
  const c = { ...dadosVazios("clinica"), tipo: "vacina", controlado: true };
  assert.deepEqual(dadosParaSalvar("clinica", c), { tipo: "vacina", controlado: true });
  // sim/não desmarcado não vai (ausente = não)
  assert.deepEqual(dadosParaSalvar("clinica", { ...dadosVazios("clinica"), tipo: "material" }), {
    tipo: "material",
  });
});

test("do banco para o formulário: ignora chaves de outro módulo e lê número com vírgula", () => {
  const f = dadosParaFormulario("petshop", {
    especie: "gato",
    peso_embalagem_kg: 15.5,
    principio_ativo: "x",
    controlado: true,
  });
  assert.equal(f["especie"], "gato");
  assert.equal(f["peso_embalagem_kg"], "15,5");
  assert.equal("principio_ativo" in f, false);
  assert.deepEqual(dadosParaFormulario("petshop", null), dadosVazios("petshop"));
  assert.deepEqual(dadosParaFormulario("petshop", ["cao"]), dadosVazios("petshop"));
  assert.equal(dadosParaFormulario("clinica", { controlado: true })["controlado"], true);
});

test("resumo para a lista de produtos", () => {
  assert.equal(
    resumoDoModulo("petshop", {
      especie: "cao",
      porte: "todos",
      fase_vida: "adulto",
      sabor_linha: "frango",
      peso_embalagem_kg: 15,
    }),
    "Cão · Adulto · frango · 15 kg",
  );
  assert.equal(
    resumoDoModulo("clinica", { tipo: "vacina", controlado: true, conservacao: "refrigerado" }),
    "Vacina · Medicamento controlado · Refrigerado (2 a 8 °C)",
  );
  assert.equal(
    resumoDoModulo("construcao", { venda_fracionada: "nao", bitola_medida: '3/4"' }),
    '3/4"',
  );
  assert.equal(resumoDoModulo("roupas", { tipo: "x" }), "");
  assert.equal(resumoDoModulo("petshop", {}), "");
});

test("clínica: medicamento e vacina pedem lote e validade", () => {
  assert.equal(exigeLote("clinica", { tipo: "medicamento" }), true);
  assert.equal(exigeLote("clinica", { tipo: "vacina" }), true);
  assert.equal(exigeLote("clinica", { tipo: "material" }), false);
  assert.equal(exigeLote("petshop", { tipo: "medicamento" }), false);
});

test("Lava-Rápido é liberado pelo módulo principal da empresa", () => {
  assert.equal(
    moduloLiberadoEmpresa(
      { cnpj: "44.543.662/0001-83", ramo_atividade: "lavarapido" },
      "lavarapido",
    ),
    true,
  );
  assert.equal(
    moduloLiberadoEmpresa({ cnpj: "44.543.662/0001-83", ramo_atividade: "roupas" }, "lavarapido"),
    false,
  );
});

// A lista de campos do banco (_produto_dados_modulo_erro) precisa ser a mesma do código.
test("a lista de campos do banco é a mesma do código", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261126000000_modulos_produto.sql", import.meta.url),
    "utf8",
  );
  const trecho = /v_cfg constant jsonb := '(\{[\s\S]*?\})'::jsonb;/.exec(sql)?.[1];
  assert.ok(trecho, "lista de campos não encontrada na migration");
  const banco = JSON.parse(trecho) as Record<string, Record<string, string | string[]>>;
  assert.deepEqual(Object.keys(banco).sort(), [...MODULOS].sort());
  for (const m of MODULOS) {
    const doCodigo = Object.fromEntries(
      MODULOS_PRODUTO[m].campos.map((c) => [
        c.chave,
        c.tipo === "opcoes" ? (c.opcoes ?? []).map((o) => o.valor) : c.tipo,
      ]),
    );
    assert.deepEqual(banco[m], doCodigo, `módulo ${m}: banco e código divergem`);
  }
});
