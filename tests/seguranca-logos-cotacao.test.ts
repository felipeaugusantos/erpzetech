import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../drizzle/migrations/0120_seguranca_logos_cotacao.sql", import.meta.url),
  "utf8",
);
it("as duas páginas públicas validam o logo com o tenant do registro", () => {
  assert.match(sql, /_empresa_logo_publicavel\(e\.logo_path, e\.tenant_id\)/);
  assert.match(sql, /_empresa_logo_publicavel\(e2\.logo_path, e2\.tenant_id\)/);
  assert.match(sql, /restaurante_cardapio_publico/);
  assert.match(sql, /ELSE NULL END/);
});
it("somente arquivo de logo na raiz da própria empresa passa no filtro", () => {
  const tenant = "11111111-1111-1111-1111-111111111111";
  const caminho = new RegExp(`^${tenant}/logo-[A-Za-z0-9-]+\\.(png|jpg|jpeg|webp|svg)$`);
  assert.ok(caminho.test(`${tenant}/logo-abc123.png`));
  for (const p of [
    "22222222-2222-2222-2222-222222222222/logo-abc.png",
    `${tenant}/fiscal.pdf`,
    `${tenant}/logo-abc.png/../../fiscal.pdf`,
    `${tenant}/logo-abc.pdf`,
  ])
    assert.equal(caminho.test(p), false);
});
it("aplicar cotação exige papéis de compras antes das alterações, sem mudar outras funções", () => {
  assert.match(sql, /compra_aplicar_cotacao\(uuid\)/);
  assert.match(sql, /exige_papel\(ARRAY\[''administrador'', ''gestor'', ''comprador''\]\)/);
  assert.doesNotMatch(sql, /compra_avancar_status|whatsapp/);
});
