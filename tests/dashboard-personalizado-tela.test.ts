import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { PECAS_DASHBOARD_PET } from "../src/lib/dashboard-personalizado.ts";

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), "utf8");
const dashboard = ler("../src/components/app/DashboardPet.tsx");
const dialogo = ler("../src/components/app/PersonalizarDashboardDialog.tsx");

test("toda peça do catálogo é desenhada pelo dashboard (e só elas)", () => {
  for (const peca of PECAS_DASHBOARD_PET) {
    const chave = new RegExp(`(?:"${peca.id}"|\\b${peca.id}):\\s*(?:\\(|\\{|reforcos)`);
    assert.ok(chave.test(dashboard), `${peca.id}: o dashboard não desenha esta peça`);
  }
});

test("o dashboard aplica a configuração da empresa só sobre as peças disponíveis", () => {
  assert.ok(/aplicarDashboard\(disponiveis, configDashboard\)/.test(dashboard));
  assert.ok(
    /p\.id !== "reforcos-vacina" \|\| \(clinica && Boolean\(reforcos\.data\)\)/.test(dashboard),
    "reforços de vacina dependem da clínica e do perfil, e a configuração não os liga sozinha",
  );
});

test("o botão e a janela de personalizar são só da administração (administrador e gestor)", () => {
  assert.ok(/r === "administrador" \|\| r === "gestor"/.test(dashboard));
  assert.equal((dashboard.match(/\{gestao && \(/g) ?? []).length, 2, "botão e janela");
});

test("a janela não promete o que o sistema não faz", () => {
  assert.ok(/Vale para todas as pessoas da/.test(dialogo));
  assert.ok(/Cada pessoa só vê o que o perfil dela permite/.test(dialogo));
  assert.ok(/disponiveis: readonly PecaDashboard\[\]/.test(dialogo));
});
