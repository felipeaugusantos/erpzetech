import { test } from "node:test";
import assert from "node:assert/strict";
import { empresaDoChamado, chamadoInput } from "../src/lib/chamados.ts";

test("chamados só usam a empresa do tenant autenticado", () => {
  const perfil = { tenant_id: "a", ativo: true };
  assert.equal(empresaDoChamado(perfil, { id: "empresa-a", tenant_id: "a" }), "empresa-a");
  assert.throws(() => empresaDoChamado(perfil, { id: "empresa-b", tenant_id: "b" }));
});
test("acesso inativo ou sem empresa não pode usar a chave central", () => {
  assert.throws(() => empresaDoChamado({ tenant_id: "a", ativo: false }, { id: "a", tenant_id: "a" }));
  assert.throws(() => empresaDoChamado(null, null));
});
test("formulário não aceita identidade da empresa enviada pelo navegador", () => {
  const dados = { requestId: "a0000000-0000-4000-8000-000000000001", subject: "Falha na venda", description: "Venda não conclui", priority: "normal", name: "Contato Teste", email: "teste@example.com" };
  assert.equal(chamadoInput.parse(dados).requestId, dados.requestId);
  assert.equal(chamadoInput.safeParse({ ...dados, company_external_id: "outra-empresa" }).success, false);
});