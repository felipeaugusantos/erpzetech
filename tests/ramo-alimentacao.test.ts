import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ehEmpresaAlimentacao,
  GRUPOS_FORA_DA_ALIMENTACAO,
  TELAS_FORA_DA_ALIMENTACAO,
} from "../src/lib/ramo-alimentacao.ts";

test("ramo restaurante ou CNAE principal 56 é empresa de alimentação", () => {
  assert.equal(ehEmpresaAlimentacao({ ramo_atividade: "restaurante" }), true);
  assert.equal(ehEmpresaAlimentacao({ cnae: "5611-2/01" }), true);
  assert.equal(ehEmpresaAlimentacao({ ramo_atividade: "construcao", cnae: "56.11-2/03" }), true);
});

test("CNAE 56 só como secundário não esconde o resto do sistema", () => {
  assert.equal(
    ehEmpresaAlimentacao({ cnae: "4744-0/01", cnae_secundarios: "5611-2/01" } as never),
    false,
  );
  assert.equal(ehEmpresaAlimentacao({ ramo_atividade: "construcao" }), false);
  assert.equal(ehEmpresaAlimentacao(null), false);
});

test("as telas escondidas existem no menu e o salão nunca é escondido", () => {
  const fonte = readFileSync("src/components/app/AppShell.tsx", "utf8");
  for (const to of TELAS_FORA_DA_ALIMENTACAO) assert.ok(fonte.includes(`"${to}"`), to);
  for (const to of [
    "/salao",
    "/delivery",
    "/cozinha",
    "/cardapio",
    "/frente-caixa",
    "/estoque",
    "/produtos",
  ])
    assert.ok(!(TELAS_FORA_DA_ALIMENTACAO as readonly string[]).includes(to), to);
  for (const g of GRUPOS_FORA_DA_ALIMENTACAO) assert.ok(fonte.includes(`label: "${g}"`), g);
});
