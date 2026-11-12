import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { consultaPersistivel } from "../src/lib/cache-clinico.ts";

const sql = readFileSync(
  new URL("../drizzle/migrations/0085_clinica_painel_pacientes.sql", import.meta.url),
  "utf8",
);

test("o painel de pacientes exige administrador ou gestor no banco", () => {
  assert.match(sql, /exige_papel\(ARRAY\['administrador','gestor'\]\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC,anon/);
});

test("visitas e os dois tipos de exame são restritos à empresa e ao período", () => {
  assert.match(sql, /a\.tenant_id=v_t AND a\.aberto_em >= v_ini AND a\.aberto_em < v_fim/);
  assert.match(sql, /e\.tenant_id=v_t AND e\.aberto_em >= v_ini AND e\.aberto_em < v_fim/);
  assert.match(sql, /e\.tenant_id=v_t AND e\.agendado_para >= v_ini AND e\.agendado_para < v_fim/);
  assert.match(sql, /WHERE p\.tenant_id=v_t/);
});

test("a lista administrativa não seleciona texto clínico nem resultados", () => {
  const consulta = sql.slice(sql.indexOf("RETURN (WITH"), sql.indexOf("END $$"));
  assert.doesNotMatch(
    consulta,
    /\b(queixa|anamnese|diagnostico|conduta|observacoes|resultados|alergias)\b/,
  );
});

test("pacientes do painel não são persistidos no navegador", () => {
  assert.equal(
    consultaPersistivel([
      "clinica-painel-pacientes",
      "gestor",
      "empresa",
      "2026-11-01",
      "2026-11-30",
    ]),
    false,
  );
  assert.equal(consultaPersistivel(["estoques"]), true);
});
