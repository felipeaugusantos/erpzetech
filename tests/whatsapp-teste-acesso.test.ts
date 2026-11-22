import { it } from "node:test";
import assert from "node:assert/strict";
import { exigirAcessoTesteWhatsApp } from "../src/lib/whatsapp-teste-acesso.ts";

for (const papel of ["veterinario", "administrador", "gestor"]) {
  it(`permite teste para ${papel}`, async () => {
    await assert.doesNotReject(() =>
      exigirAcessoTesteWhatsApp(async (r) => ({ data: r === papel, error: null })),
    );
  });
}
it("bloqueia quem não tem nenhum dos três papéis", async () => {
  await assert.rejects(
    () => exigirAcessoTesteWhatsApp(async () => ({ data: false, error: null })),
    /Somente veterinário/,
  );
});
it("falha fechada quando a consulta de permissão falha", async () => {
  await assert.rejects(
    () =>
      exigirAcessoTesteWhatsApp(async () => ({ data: true, error: { message: "indisponível" } })),
    /Não foi possível conferir/,
  );
});
