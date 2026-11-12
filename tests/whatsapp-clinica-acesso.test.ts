import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(
  new URL("../drizzle/migrations/0086_whatsapp_gestor_clinica.sql", import.meta.url),
  "utf8",
);

test("WhatsApp aceita clínica liberada sem exigir Lava rápido", () => {
  assert.match(sql, /IF NOT \(public\.clinica_liberada\(\) OR public\.lava_rapido_liberado\(\)\) THEN/);
  assert.doesNotMatch(sql, /PERFORM public\._lr_exige_liberado/);
});

test("a conexão continua exclusiva da gestão e devolve somente o tenant da sessão", () => {
  assert.match(sql, /exige_nao_contador\(\)/);
  assert.match(sql, /exige_nao_salao\(\)/);
  assert.match(sql, /exige_papel\(ARRAY\['administrador', 'gestor'\]\)/);
  assert.match(sql, /RETURN public\.current_tenant_id\(\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.wa_exige_gestor\(\) FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.wa_exige_gestor\(\) TO authenticated/);
});