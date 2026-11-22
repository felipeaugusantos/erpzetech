import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const original = readFileSync(
  new URL("../drizzle/migrations/0045_zerar_dados_quebra_ciclos.sql", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../drizzle/migrations/0121_empresa_reset_static_statements.sql", import.meta.url),
  "utf8",
);
function capture(text: string, pattern: RegExp): string {
  const value = text.match(pattern)?.[1];
  assert.ok(value !== undefined, `Missing expected SQL pattern: ${pattern}`);
  return value;
}
function tableNames(text: string): string[] {
  return [...text.matchAll(/'([^']+)'/g)].map((match) => {
    const name = match[1];
    assert.ok(name !== undefined, "Missing table name capture");
    return name;
  });
}
const tables = tableNames(capture(migration, /tables text\[\] := ARRAY\[([^\]]+)\]/));
const fixed =
  "case tab\n" +
  tables
    .map((table) => `when '${table}' then delete from public.${table} where tenant_id = t;`)
    .join("\n") +
  "\nelse raise exception 'Tabela de exclusão não autorizada'; end case;";
const rewritten = original.replace(
  "execute format('delete from public.%I where tenant_id = $1', tab) using t;",
  fixed,
);

it("fixed commands cover every original reset table, with no additions", () => {
  const originalTables = [
    ...tableNames(capture(original, /movs text\[\] := array\[([\s\S]+?)\];/)),
    ...tableNames(capture(original, /cads text\[\] := array\[([\s\S]+?)\];/)),
  ];
  assert.deepEqual(tables, originalTables);
  assert.equal(new Set(tables).size, tables.length);
  tables.forEach((table) => assert.match(table, /^[a-z_]+$/));
});
it("callable function has no dynamic execute and all deletes are tenant-scoped", () => {
  assert.doesNotMatch(rewritten, /\bexecute\b/i);
  assert.equal(
    [...rewritten.matchAll(/delete from public\.[a-z_]+ where tenant_id = t;/g)].length,
    tables.length,
  );
  assert.match(rewritten, /has_role\(auth\.uid\(\), 'administrador'\)/);
  assert.match(rewritten, /_confirmacao is distinct from 'ZERAR TUDO'/);
  assert.match(rewritten, /exception when foreign_key_violation/);
  assert.match(rewritten, /insert into public\.auditoria/);
});
it("migration preserves access restrictions and rejects null mode", () => {
  assert.match(migration, /if _modo is null or _modo not in/);
  assert.match(migration, /FROM PUBLIC, anon/);
  assert.match(migration, /TO authenticated/);
  assert.match(migration, /Unexpected reset definition; no changes applied/);
  assert.doesNotMatch(
    migration,
    /whatsapp|CREATE OR REPLACE FUNCTION public\.(?!empresa_zerar_dados)/,
  );
});
