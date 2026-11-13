import assert from "node:assert/strict";
import { test } from "node:test";
import { excluirExameSchema, limparArquivosExcluidos } from "../src/lib/exame-exclusao.ts";

test("exclusão exige motivo, confirmação explícita e id válido", () => {
  const base = { id: "11111111-1111-1111-1111-111111111111", motivo: "Importado no paciente errado", confirmado: true };
  assert.equal(excluirExameSchema.safeParse(base).success, true);
  assert.equal(excluirExameSchema.safeParse({ ...base, motivo: " " }).success, false);
  assert.equal(excluirExameSchema.safeParse({ ...base, confirmado: false }).success, false);
  assert.equal(excluirExameSchema.safeParse({ ...base, motivo: "x".repeat(501) }).success, false);
  assert.equal(excluirExameSchema.safeParse({ ...base, id: "outro" }).success, false);
});

test("falha de remoção do PDF permanece pendente e nova tentativa conclui", async () => {
  const arquivo = [{ id: "a", caminho: "empresa/exame/a.pdf" }];
  const registros: boolean[] = [];
  const registrar = async (_id: string, sucesso: boolean) => { registros.push(sucesso); };
  assert.deepEqual(await limparArquivosExcluidos(arquivo, async () => false, registrar), { pendentes: 1 });
  assert.deepEqual(await limparArquivosExcluidos(arquivo, async () => { throw new Error("offline"); }, registrar), { pendentes: 1 });
  assert.deepEqual(await limparArquivosExcluidos(arquivo, async caminho => caminho === "empresa/exame/a.pdf", registrar), { pendentes: 0 });
  assert.deepEqual(registros, [false, false, true]);
});