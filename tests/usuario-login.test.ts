import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  emailInterno,
  erroDoUsuario,
  normalizarUsuario,
  pareceEmail,
  usuarioSugerido,
} from "../src/lib/usuario-login.ts";

describe("usuário", () => {
  it("normaliza espaços e maiúsculas", () => {
    assert.equal(normalizarUsuario("  Bruna.Silva "), "bruna.silva");
  });
  it("aceita o formato do banco", () => {
    for (const u of ["bruna", "bruna.silva", "b_r-1", "abc", "a".repeat(30)])
      assert.equal(erroDoUsuario(u), null, u);
  });
  it("recusa curto, longo, com espaço, acento ou símbolo", () => {
    for (const u of ["ab", "a".repeat(31), "bruna silva", "brúna", "bruna@x", ""])
      assert.notEqual(erroDoUsuario(u), null, u);
  });
  it("maiúscula digitada é aceita porque vira minúscula", () => {
    assert.equal(erroDoUsuario("Bruna"), null);
  });
});

describe("campo de login", () => {
  it("com @ é e-mail; sem @ é usuário", () => {
    assert.equal(pareceEmail("a@b.com"), true);
    assert.equal(pareceEmail("bruna"), false);
  });
});

describe("endereço interno", () => {
  const t = "11111111-2222-3333-4444-555555555555";
  it("é único por usuário e empresa e usa o domínio reservado", () => {
    const a = emailInterno("Bruna", t);
    assert.equal(a, "bruna.11111111222233334444555555555555@usuarios.erpzetech.invalid");
    assert.notEqual(a, emailInterno("bruna", "99999999-2222-3333-4444-555555555555"));
    assert.notEqual(a, emailInterno("outra", t));
  });
});

describe("usuário sugerido", () => {
  it("usa a parte do e-mail antes do @, limpa", () => {
    assert.equal(usuarioSugerido("Felipe.Augu_Santos+x@gmail.com"), "felipe.augu_santosx");
  });
  it("e-mail curto ou sem nada aproveitável vira 'usuario'", () => {
    assert.equal(usuarioSugerido("ab@x.com"), "usuario");
    assert.equal(usuarioSugerido("!!!@x.com"), "usuario");
  });
  it("respeita o limite de tamanho com folga para um número no fim", () => {
    assert.ok(usuarioSugerido(`${"a".repeat(60)}@x.com`).length <= 26);
  });
});
