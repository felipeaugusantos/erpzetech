import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../drizzle/migrations/0091_clinica_pacientes_proxima_consulta.sql", import.meta.url), "utf8");
test("próxima consulta é a mais próxima futura, agendada ou confirmada, com serviço de consulta", () => {
  assert.match(sql, /SELECT min\(ag.inicio\)/);
  assert.match(sql, /ag.inicio >= now\(\)/);
  assert.match(sql, /ag.situacao IN \('agendado','confirmado'\)/);
  assert.match(sql, /s.categoria='consulta'/);
});
test("próxima consulta pertence ao paciente e empresa e mantém o acesso veterinário", () => {
  assert.match(sql, /ag.tenant_id=v_t AND ag.pet_id=pagina.id/);
  assert.match(sql, /i.tenant_id=v_t/);
  assert.match(sql, /s.tenant_id=v_t/);
  assert.match(sql, /PERFORM public\._clinica_vet\(\)/);
});