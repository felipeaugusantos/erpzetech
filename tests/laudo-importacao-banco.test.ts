import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../drizzle/migrations/0088_clinica_importar_pdf_completo.sql", import.meta.url), "utf8");
test("criação e preenchimento exigem veterinário e confirmação", () => {
  assert.match(sql, /v_vet := public\._clinica_vet\(\)/);
  assert.match(sql, /p_dados->>'confirmado' IS DISTINCT FROM 'true'/);
});
test("pet e modelos ficam isolados na empresa da sessão", () => {
  assert.match(sql, /id=p_pet_id AND tenant_id=v_tenant AND ativo/);
  assert.match(sql, /id=m AND tenant_id=v_tenant AND ativo/);
});
test("reenvio usa mesma chave e não fecha o laudo automaticamente", () => {
  assert.match(sql, /_clinica_op_repetida\(p_chave, 'pdf_exames'\)/);
  assert.match(sql, /IF anterior IS NOT NULL THEN RETURN anterior/);
  assert.doesNotMatch(sql, /clinica_exame_fechar/);
});
test("absolutos calculados precisam conferir exatamente com o PDF", () => {
  assert.match(sql, /IS DISTINCT FROM \(it->>'valor'\)::numeric/);
  assert.doesNotMatch(sql, /round\(/i);
});