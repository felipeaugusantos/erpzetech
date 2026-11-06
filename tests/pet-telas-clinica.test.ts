import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ITENS_PET_DA_CLINICA, itemPetVisivel } from "../src/lib/ramo-clinica.ts";

// Telas da área Pet shop e o arquivo de cada uma. A lista do menu (itemPetVisivel) e a guarda da página precisam concordar:
// tela no menu mas bloqueada na página (ou o contrário) deixava a clínica sem conseguir cadastrar veterinário ou serviço.
const TELAS: [string, string][] = [
  ["/pet-agenda", "pet-agenda"],
  ["/pets", "pets"],
  ["/pet-os", "pet-os"],
  ["/pet-servicos", "pet-servicos"],
  ["/pet-profissionais", "pet-profissionais"],
  ["/pet-campos", "pet-campos"],
  ["/pet-contatos", "pet-contatos"],
  ["/pet-pacotes", "pet-pacotes"],
  ["/pet-comissoes", "pet-comissoes"],
];

test("a página de cada tela da área Pet shop usa o mesmo critério do menu", () => {
  for (const [caminho, arquivo] of TELAS) {
    const fonte = readFileSync(
      new URL(`../src/routes/_authenticated/${arquivo}.tsx`, import.meta.url),
      "utf8",
    );
    const daClinica = itemPetVisivel(caminho, false);
    assert.equal(
      /if \(!modulos\.petShopOuClinica\) return <ModuloBloqueado/.test(fonte),
      daClinica,
      `${caminho}: guarda ${daClinica ? "deveria aceitar a clínica" : "deveria exigir o pet shop"}`,
    );
    assert.equal(
      /if \(!modulos\.petshop\) return <ModuloBloqueado/.test(fonte),
      !daClinica,
      `${caminho}: guarda de pet shop só nas telas de banho e tosa`,
    );
  }
});

test("a lista da clínica traz o que ela depende para operar: veterinário (CRMV), serviços e agenda", () => {
  for (const t of [
    "/pet-profissionais",
    "/pet-servicos",
    "/pet-agenda",
    "/pets",
    "/pet-contatos",
    "/pet-campos",
  ])
    assert.ok((ITENS_PET_DA_CLINICA as readonly string[]).includes(t), t);
  for (const t of ["/pet-os", "/pet-pacotes", "/pet-comissoes"])
    assert.equal((ITENS_PET_DA_CLINICA as readonly string[]).includes(t), false, t);
});
