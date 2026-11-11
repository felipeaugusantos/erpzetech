import test from "node:test";
import assert from "node:assert/strict";
import {
  janelaNoturnaDrive,
  exigirAdministradorBackup,
  nomeBackupDrive,
  completarDriveInput,
} from "../src/lib/backup-drive.ts";
import { politicaDoCliente, selecionarParaApagar } from "../src/lib/backup-rotina.ts";

test("envio noturno apenas entre 2h e 5h de Brasília", () => {
  assert.equal(janelaNoturnaDrive(new Date("2026-11-10T04:59:00Z")), false);
  assert.equal(janelaNoturnaDrive(new Date("2026-11-10T05:00:00Z")), true);
  assert.equal(janelaNoturnaDrive(new Date("2026-11-10T07:45:00Z")), true);
  assert.equal(janelaNoturnaDrive(new Date("2026-11-10T08:00:00Z")), false);
});
test("apenas administrador ativo configura o próprio cliente", () => {
  assert.equal(exigirAdministradorBackup({ ativo: true, tenant_id: "tenant-A" }, true), "tenant-A");
  assert.throws(() => exigirAdministradorBackup({ ativo: true, tenant_id: "tenant-A" }, false));
  assert.throws(() => exigirAdministradorBackup({ ativo: false, tenant_id: "tenant-A" }, true));
  assert.throws(() => exigirAdministradorBackup(null, true));
});
test("retenção mantém sete diárias e não considera falhas", () => {
  const lista = Array.from({ length: 9 }, (_, i) => ({
    id: String(i),
    dia: `2026-11-${String(10 + i).padStart(2, "0")}`,
    tipos: ["diario"],
    situacao: "concluido",
  }));
  lista.push({ id: "erro", dia: "2026-12-01", tipos: ["diario"], situacao: "erro" });
  assert.deepEqual(selecionarParaApagar(lista, politicaDoCliente([])), ["1", "0"]);
});
test("nomes isolam tenant e callback exige nonce sem permitir tenant do navegador", () => {
  assert.notEqual(nomeBackupDrive("A", "2026-11-10"), nomeBackupDrive("B", "2026-11-10"));
  assert.equal(completarDriveInput.safeParse({ code: "code" }).success, false);
  assert.equal(
    completarDriveInput.safeParse({ code: "code", nonce: "x".repeat(72), tenantId: "other" })
      .success,
    false,
  );
});
