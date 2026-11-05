import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_EQUIPE_ZE_TECH,
  exigirAdminEquipe,
  validarRemocaoEquipe,
  cadastroEquipe,
} from "../src/lib/equipe-ze-tech.ts";

test("administrador existente da Ze Tech pode gerenciar a equipe", () => {
  assert.equal(ADMIN_EQUIPE_ZE_TECH, "458b7232-b5be-4f67-a3f8-3979db96088a");
  assert.doesNotThrow(() => exigirAdminEquipe("458b7232-b5be-4f67-a3f8-3979db96088a", true));
});
test("integrantes e administradores das lojas não gerenciam a equipe", () => {
  assert.throws(() => exigirAdminEquipe("outro-operador", true));
  assert.throws(() => exigirAdminEquipe("administrador-loja", false));
  assert.throws(() => exigirAdminEquipe(ADMIN_EQUIPE_ZE_TECH, false));
});
test("acesso do administrador principal não pode ser removido", () => {
  assert.throws(() => validarRemocaoEquipe("458b7232-b5be-4f67-a3f8-3979db96088a"));
  assert.doesNotThrow(() => validarRemocaoEquipe("outro-integrante"));
});
test("conta nova exige senha com 12 caracteres, conta existente não altera senha", () => {
  const entrada = {
    nome: "Equipe",
    email: "equipe@example.com",
    modo: "novo",
    senha: "abcdefghijk",
  };
  assert.equal(cadastroEquipe.safeParse(entrada).success, false);
  assert.equal(cadastroEquipe.safeParse({ ...entrada, senha: "abcdefghijkl" }).success, true);
  assert.equal(
    cadastroEquipe.safeParse({ ...entrada, modo: "existente", senha: "" }).success,
    true,
  );
});
