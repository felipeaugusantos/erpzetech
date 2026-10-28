import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  contaParaExibir,
  ehEmailInterno,
  emailInterno,
  erroDoUsuario,
  normalizarUsuario,
  pareceEmail,
  usuarioSugerido,
  tenantDoCodigoDeAcesso,
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
  it("aceita código da empresa mesmo sem link personalizado", () => {
    assert.equal(
      tenantDoCodigoDeAcesso(" 11111111-2222-3333-4444-555555555555 "),
      "11111111-2222-3333-4444-555555555555",
    );
  });
  it("não confunde link, nome de usuário ou código inválido com empresa", () => {
    for (const codigo of ["minha-loja", "bruna", "", "11111111-2222-3333-4444-55555555555Z"])
      assert.equal(tenantDoCodigoDeAcesso(codigo), null);
  });
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

describe("identificação da conta na tela", () => {
  const t = "11111111-2222-3333-4444-555555555555";
  it("reconhece o endereço técnico", () => {
    assert.equal(ehEmailInterno(emailInterno("bruna", t)), true);
    assert.equal(ehEmailInterno("bruna@gmail.com"), false);
    assert.equal(ehEmailInterno(null), false);
  });
  it("quem entra por e-mail vê o e-mail; quem entra por usuário vê o usuário, nunca o endereço técnico", () => {
    assert.equal(contaParaExibir("ana@x.com", { usuario: "ana" }), "ana@x.com");
    assert.equal(
      contaParaExibir(emailInterno("bruna", t), { usuario: "bruna", email: "b@x.com" }),
      "bruna",
    );
    assert.equal(
      contaParaExibir(emailInterno("bruna", t), { usuario: null, email: "b@x.com" }),
      "b@x.com",
    );
    assert.equal(contaParaExibir(emailInterno("bruna", t), null), "");
  });
});
