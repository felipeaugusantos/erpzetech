import { test } from "node:test";
import assert from "node:assert/strict";
import { serieFaturamento } from "../src/lib/dashboard-faturamento.ts";

test("faturamento diário preserva centavos, soma itens e preenche dias sem vendas", () => {
  const serie = serieFaturamento([
    { created_at: "2026-11-06T12:00:00Z", situacao: "aprovado", pedido_itens: [{ total: 159.66 }, { total: 40.59 }] },
    { created_at: "2026-11-06T15:00:00Z", situacao: "entregue", pedido_itens: [{ total: 9.77 }] },
  ], { de: "2026-11-06", ate: "2026-11-07" });
  assert.deepEqual(serie, [
    { data: "2026-11-06", faturamento: 210.02 },
    { data: "2026-11-07", faturamento: 0 },
  ]);
});

test("faturamento respeita o período e exclui pedidos cancelados como o resumo existente", () => {
  const serie = serieFaturamento([
    { created_at: "2026-11-05", situacao: "aprovado", pedido_itens: [{ total: 999 }] },
    { created_at: "2026-11-06", situacao: "cancelado", pedido_itens: [{ total: 888 }] },
    { created_at: "2026-11-06", situacao: "aprovado", pedido_itens: [{ total: "14.29" }] },
    { created_at: "2026-11-07", situacao: "aprovado", pedido_itens: [{ total: 777 }] },
  ], { de: "2026-11-06", ate: "2026-11-06" });
  assert.deepEqual(serie, [{ data: "2026-11-06", faturamento: 14.29 }]);
});

test("período inválido não cria pontos", () => {
  assert.deepEqual(serieFaturamento([], { de: "2026-11-07", ate: "2026-11-06" }), []);
  assert.deepEqual(serieFaturamento([], { de: "", ate: "" }), []);
});