import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Toda função de servidor, menos a do contador, usa o middleware que recusa o contador. Se alguém voltar a
// importar requireSupabaseAuth direto de auth-middleware, o contador alcançaria funções que usam a chave de serviço
// ou a conta compartilhada do emissor.
test("funções de servidor não importam o middleware que aceita o contador (só contador.functions.ts)", () => {
  const dir = new URL("../src/lib/", import.meta.url);
  const direto = readdirSync(dir)
    .filter((f) => f.endsWith(".functions.ts") && f !== "contador.functions.ts")
    .filter((f) =>
      readFileSync(new URL(f, dir), "utf8").includes("integrations/supabase/auth-middleware"),
    );
  assert.deepEqual(direto, []);
});

test("contador.functions.ts nunca recebe o id do emissor nem a empresa do cliente", () => {
  const src = readFileSync(new URL("../src/lib/contador.functions.ts", import.meta.url), "utf8");
  assert.ok(!/provider_id\s*:/.test(src.split("inputValidator")[1]?.split("handler")[0] ?? ""));
  assert.ok(src.includes("exigirContador(supabase)"));
  assert.equal((src.match(/exigirContador\(supabase\)/g) ?? []).length, 2);
});
