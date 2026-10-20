import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ehEmpresaSoClinica,
  GRUPOS_FORA_DA_CLINICA,
  TELAS_FORA_DA_CLINICA,
} from "../src/lib/ramo-clinica.ts";

test("ramo clínica ou CNAE principal 7500 é empresa só de clínica", () => {
  assert.equal(ehEmpresaSoClinica({ ramo_atividade: "clinica" }), true);
  assert.equal(ehEmpresaSoClinica({ cnae: "7500-1/00", cnpj: "11.222.333/0001-81" }), true);
});

test("sem CNPJ, a clínica escolhida em Módulos sem CNPJ vale, desde que sozinha", () => {
  const base = { ramo_atividade: "construcao", cnpj: "" };
  assert.equal(ehEmpresaSoClinica({ ...base, modulos_sem_cnpj: ["clinica"] }), true);
  assert.equal(ehEmpresaSoClinica({ ...base, modulos_sem_cnpj: ["clinica", "petshop"] }), true);
  assert.equal(ehEmpresaSoClinica({ ...base, modulos_sem_cnpj: ["clinica", "locacao"] }), false);
  assert.equal(ehEmpresaSoClinica({ ...base, modulos_sem_cnpj: ["assistencia"] }), false);
});

test("com CNPJ, a escolha manual não vale; CNAE 7500 só como secundário não esconde o resto", () => {
  assert.equal(
    ehEmpresaSoClinica({
      ramo_atividade: "construcao",
      cnpj: "11.222.333/0001-81",
      modulos_sem_cnpj: ["clinica"],
    }),
    false,
  );
  assert.equal(
    ehEmpresaSoClinica({
      cnae: "4744-0/01",
      cnae_secundarios: "7500-1/00",
      cnpj: "11222333000181",
    }),
    false,
  );
  assert.equal(ehEmpresaSoClinica(null), false);
  assert.equal(ehEmpresaSoClinica({ ramo_atividade: "construcao" }), false);
});

test("liberação explícita de outro módulo desfaz o só clínica; clínica e pet shop liberados não", () => {
  const clinica = { ramo_atividade: "clinica" };
  assert.equal(ehEmpresaSoClinica({ ...clinica, modulos_liberados: ["obras"] }), false);
  assert.equal(ehEmpresaSoClinica({ ...clinica, modulos_liberados: ["locacao"] }), false);
  assert.equal(ehEmpresaSoClinica({ ...clinica, modulos_liberados: ["clinica", "petshop"] }), true);
  assert.equal(ehEmpresaSoClinica({ ...clinica, modulos_liberados: [] }), true);
});

test("as telas escondidas existem no menu e o que a clínica usa nunca é escondido", () => {
  const fonte = readFileSync("src/components/app/AppShell.tsx", "utf8");
  for (const to of TELAS_FORA_DA_CLINICA) assert.ok(fonte.includes(`"${to}"`), to);
  for (const to of [
    "/clientes",
    "/pedidos",
    "/pdv",
    "/frente-caixa",
    "/produtos",
    "/estoque",
    "/estoque-lotes",
    "/ajuste-lotes",
    "/estoque-movimentos",
    "/inventarios",
    "/sugestao-compra",
    "/fornecedores",
    "/compras",
    "/nfe-entrada",
    "/contas-receber",
    "/contas-pagar",
    "/pets",
    "/pet-agenda",
    "/clinica-prontuario",
  ])
    assert.ok(!(TELAS_FORA_DA_CLINICA as readonly string[]).includes(to), to);
  for (const g of GRUPOS_FORA_DA_CLINICA) assert.ok(fonte.includes(`label: "${g}"`), g);
  assert.ok(!(GRUPOS_FORA_DA_CLINICA as readonly string[]).includes("Estoque"));
  assert.ok(!(GRUPOS_FORA_DA_CLINICA as readonly string[]).includes("Compras"));
});
