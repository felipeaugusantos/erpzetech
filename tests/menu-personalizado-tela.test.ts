import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), "utf8");
const shell = ler("../src/components/app/AppShell.tsx");
const tela = ler("../src/routes/_authenticated/menu-personalizado.tsx");

test("o menu da empresa só é personalizado no menu completo e depois de filtrar por permissão", () => {
  assert.ok(/const areasBase = useMemo\(\(\) => montarAreas\(menu\), \[menu\]\)/.test(shell));
  assert.ok(
    /!somenteMotorista && !somenteSalao && !somenteProfissional && !somenteProducao && !naAreaZeTech/.test(
      shell,
    ),
    "motorista, salão, profissional, produção e equipe Ze Tech ficam fora",
  );
  assert.ok(/aplicarMenuPersonalizado<Item, Area>\(areasBase, configMenu/.test(shell));
});

test("o editor recebe o menu base (antes da personalização) pelo contexto do AppShell", () => {
  assert.ok(/<MenuBaseContext\.Provider value=\{areasBase\}>/.test(shell));
  assert.ok(/useMenuBase\(\)/.test(tela));
});

test("o item do menu e a tela são da administração (administrador e gestor)", () => {
  assert.ok(/i\.to === "\/menu-personalizado"\) return souGestao/.test(shell));
  assert.ok(/r === "administrador" \|\| r === "gestor"/.test(tela));
});

test("a tela não promete o que o sistema não faz", () => {
  assert.equal(/Ctrl K/.test(tela), false, "a busca do sistema não procura telas");
  assert.ok(/Esconder não bloqueia a tela/.test(tela));
});
