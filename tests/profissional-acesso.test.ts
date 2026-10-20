import assert from "node:assert/strict";
import { test } from "node:test";

import {
  erroDoAcessoNovo,
  perfilDoProfissional,
  usuarioSugeridoDoNome,
} from "../src/lib/profissional-acesso.ts";

test("veterinário recebe o perfil Veterinário; os demais, Profissional", () => {
  assert.equal(perfilDoProfissional("veterinario"), "veterinario");
  assert.equal(perfilDoProfissional("tosador"), "profissional");
  assert.equal(perfilDoProfissional("banhista"), "profissional");
});

test("sugere o primeiro nome sem acento nem símbolos", () => {
  assert.equal(usuarioSugeridoDoNome("Bruna Nascimento"), "bruna");
  assert.equal(usuarioSugeridoDoNome("  Zélia Maria"), "zelia");
  assert.equal(usuarioSugeridoDoNome("João-Pedro Silva"), "joao-pedro");
  assert.equal(usuarioSugeridoDoNome(""), "");
});

test("confere usuário e senha do acesso novo", () => {
  assert.equal(erroDoAcessoNovo("bruna", "senha-boa-123"), null);
  assert.match(erroDoAcessoNovo("br", "senha-boa-123") ?? "", /3 a 30/);
  assert.match(erroDoAcessoNovo("Bruna Silva", "senha-boa-123") ?? "", /sem espaços/);
  assert.match(erroDoAcessoNovo("bruna", "curta") ?? "", /8 caracteres/);
});
