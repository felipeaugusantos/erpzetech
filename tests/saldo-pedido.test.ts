import { describe, expect, it } from "vitest";
import { planejadoPorItem, saldoItem, validaSaida } from "../src/lib/saldo-pedido";

const base = { quantidade: 100, quantidade_separada: 100, quantidade_conferida: 100 };

describe("saldo do pedido", () => {
  it("pedido de 100 com 40 entregues deixa 60 pendentes", () => {
    const s = saldoItem({ ...base, quantidade_entregue: 40, planejado: 0 });
    expect(s.pendente).toBe(60);
    expect(s.disponivelParaSaida).toBe(60);
  });

  it("o que já está programado em entrega não pode sair de novo", () => {
    const s = saldoItem({ ...base, quantidade_entregue: 40, planejado: 50 });
    expect(s.disponivelParaSaida).toBe(10);
    expect(validaSaida(s, 11)).not.toBeNull();
    expect(validaSaida(s, 10)).toBeNull();
  });

  it("não permite sair acima do saldo pendente", () => {
    const s = saldoItem({ ...base, quantidade_entregue: 100, planejado: 0 });
    expect(validaSaida(s, 1)).not.toBeNull();
  });

  it("aceita quantidade fracionada dentro do saldo", () => {
    const s = saldoItem({ ...base, quantidade: 2.5, quantidade_entregue: 1.25, planejado: 0 });
    expect(validaSaida(s, 1.25)).toBeNull();
  });

  it("só entregas planejadas ou em rota contam como programadas", () => {
    const mapa = planejadoPorItem([
      { situacao: "planejada", entrega_itens: [{ pedido_item_id: "a", quantidade: 5 }] },
      { situacao: "em_rota", entrega_itens: [{ pedido_item_id: "a", quantidade: 3 }] },
      { situacao: "entregue", entrega_itens: [{ pedido_item_id: "a", quantidade: 9 }] },
    ]);
    expect(mapa["a"]).toBe(8);
  });
});
