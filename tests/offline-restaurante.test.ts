import { describe, expect, it } from "bun:test";

import { totalOffline, type ComandaOffline } from "../src/lib/offline-restaurante";

const base: ComandaOffline = {
  offline_id: "x",
  criada_em: "2026-10-12T00:00:00Z",
  tipo: "salao",
  mesa_id: null,
  mesa_rotulo: null,
  cliente_nome: null,
  pessoas: 2,
  taxa_servico: 10,
  delivery: null,
  itens: [
    { cardapio_item_id: "a", nome: "X-Burger", preco: 24.9, quantidade: 2 },
    { cardapio_item_id: "b", nome: "Refrigerante", preco: 6, quantidade: 1 },
  ],
  fechar: null,
};

describe("conta de comanda feita sem internet", () => {
  it("salão soma 10% de serviço igual ao banco", () => {
    expect(totalOffline(base, true)).toBe(61.38);
  });
  it("salão sem serviço cobra só os itens", () => {
    expect(totalOffline(base, false)).toBe(55.8);
  });
  it("delivery soma a taxa de entrega e não cobra serviço", () => {
    const d: ComandaOffline = {
      ...base,
      tipo: "delivery",
      taxa_servico: 0,
      delivery: { cliente: "Ana", telefone: "", endereco: "Rua A, 1", bairro: "", taxa: 7, pagamento: "dinheiro" },
    };
    expect(totalOffline(d, true)).toBe(62.8);
  });
});
