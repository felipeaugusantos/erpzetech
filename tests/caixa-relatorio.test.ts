import { test } from "node:test";
import assert from "node:assert/strict";
import { resumirDiaCaixa } from "../src/lib/caixa-relatorio.ts";

test("relatório do dia respeita Brasília, abertura e pagamentos separados", () => {
  const r = resumirDiaCaixa([
    { tipo: "abertura", valor: 100, forma_pagamento: "dinheiro", created_at: "2026-11-15T12:00:00Z" },
    { tipo: "venda", valor: 10.29, forma_pagamento: "dinheiro", pedido_id: "v1", created_at: "2026-11-16T02:00:00Z" },
    { tipo: "venda", valor: 20.10, forma_pagamento: "pix", pedido_id: "v1", created_at: "2026-11-15T14:00:00Z" },
    { tipo: "sangria", valor: 5, forma_pagamento: "dinheiro", created_at: "2026-11-15T15:00:00Z" },
    { tipo: "venda", valor: 999, forma_pagamento: "pix", created_at: "2026-11-16T03:00:00Z" },
  ], "2026-11-15");
  assert.equal(r.abertura, 100);
  assert.equal(r.entradas, 30.39);
  assert.equal(r.saidas, 5);
  assert.equal(r.pedidos, 1);
  assert.deepEqual(r.formas.find(f => f.forma === "dinheiro"), { forma: "dinheiro", entradas: 10.29, saidas: 5 });
});