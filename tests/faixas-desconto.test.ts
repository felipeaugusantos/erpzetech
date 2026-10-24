import assert from "node:assert/strict";
import { test } from "node:test";

import { especificidade, rotuloAlvo, rotuloPerfil } from "../src/lib/faixas-desconto.ts";

test("rótulos de perfil e de alvo", () => {
  assert.equal(rotuloPerfil(null), "Todos os perfis");
  assert.equal(rotuloPerfil("vendedor"), "Vendedor");
  assert.equal(rotuloPerfil("motorista"), "motorista");
  assert.equal(rotuloAlvo(null, null), "Todos os produtos");
  assert.equal(rotuloAlvo("Cimento", null), "Cimento");
  assert.equal(rotuloAlvo(null, "Votoran"), "Todos os grupos · marca Votoran");
  assert.equal(rotuloAlvo("Cimento", "Votoran"), "Cimento · marca Votoran");
});

test("grupo + marca vence grupo, que vence marca, que vence só o perfil; perfil desempata", () => {
  const f = (perfil: string | null, categoria_id: string | null, marca: string | null) => ({
    perfil,
    categoria_id,
    marca,
  });
  assert.ok(especificidade(f(null, "g", "m")) > especificidade(f(null, "g", null)));
  assert.ok(especificidade(f(null, "g", null)) > especificidade(f(null, null, "m")));
  assert.ok(especificidade(f(null, null, "m")) > especificidade(f("vendedor", null, null)));
  assert.ok(especificidade(f("vendedor", "g", null)) > especificidade(f(null, "g", null)));
  assert.equal(especificidade(f(null, null, null)), 0);
});
