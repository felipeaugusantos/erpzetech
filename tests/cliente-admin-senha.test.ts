import { test } from "node:test";
import assert from "node:assert/strict";
import { exigirOperadorZeTech, validarSenhaAdminCliente, validarVinculoAdminCliente } from "../src/lib/cliente-admin-senha.ts";

const cliente = { admin_user_id: "admin-loja", tenant_id: "loja-a" };
const perfil = { id: "admin-loja", tenant_id: "loja-a" };
const papeis = [{ role: "administrador", tenant_id: "loja-a" }];

test("somente operador Ze Tech pode redefinir senha de assinante", () => {
  assert.doesNotThrow(() => exigirOperadorZeTech(true));
  for (const negado of [false, null, undefined, "true"]) assert.throws(() => exigirOperadorZeTech(negado));
});
test("senha exige oito caracteres e preserva o valor digitado", () => {
  assert.throws(() => validarSenhaAdminCliente("1234567"));
  assert.equal(validarSenhaAdminCliente("12345678"), "12345678");
});
test("reset usa exclusivamente o administrador vinculado ao assinante", () => {
  assert.equal(validarVinculoAdminCliente(cliente, perfil, papeis), "admin-loja");
  assert.throws(() => validarVinculoAdminCliente(cliente, { ...perfil, id: "outro-admin" }, papeis));
  assert.throws(() => validarVinculoAdminCliente(null, perfil, papeis));
});
test("administrador de outra empresa não pode ser alvo do reset", () => {
  assert.throws(() => validarVinculoAdminCliente(cliente, { ...perfil, tenant_id: "loja-b" }, papeis));
});
test("alvo deve manter papel de administrador na empresa vinculada", () => {
  assert.throws(() => validarVinculoAdminCliente(cliente, perfil, [{ role: "vendedor", tenant_id: "loja-a" }]));
  assert.throws(() => validarVinculoAdminCliente(cliente, perfil, [{ role: "administrador", tenant_id: "loja-b" }]));
});