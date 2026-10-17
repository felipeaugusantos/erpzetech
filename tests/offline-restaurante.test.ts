import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { totalOffline, prepararReenvio, conciliarSincronizacao, type ComandaOffline } from "../src/lib/offline-restaurante-conta.ts";

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
  it("reenvio preserva identidade, itens e dinheiro recebido e permite corrigir o caixa fechado", () => {
    const recusada = { ...base, erro: "Caixa fechado", fechar: { caixa_id: "fechado", cobrar_servico: true, pagamentos: [{ forma: "dinheiro", valor: 61.38 }] } };
    const reenvio = prepararReenvio(recusada, "aberto");
    assert.equal(reenvio.offline_id, "x");
    assert.equal(reenvio.erro, undefined);
    assert.deepEqual(reenvio.itens, base.itens);
    assert.deepEqual(reenvio.fechar?.pagamentos, [{ forma: "dinheiro", valor: 61.38 }]);
    assert.equal(reenvio.fechar?.caixa_id, "aberto");
    assert.equal(recusada.erro, "Caixa fechado");
  });
  it("recusa continua guardada até correção explícita", () => {
    const recusada = { ...base, erro: "Caixa fechado" };
    assert.deepEqual(conciliarSincronizacao([base], [base], [recusada]), [recusada]);
  });
  it("sucesso remove só a operação confirmada, sem apagar novas comandas ou correções", () => {
    const nova = { ...base, offline_id: "nova" };
    assert.deepEqual(conciliarSincronizacao([base, nova], [base], []), [nova]);
    const corrigida = { ...base, cliente_nome: "Corrigido" };
    assert.deepEqual(conciliarSincronizacao([corrigida, nova], [base], []), [corrigida, nova]);
  });
  it("salão soma 10% de serviço igual ao banco", () => {
    assert.equal(totalOffline(base, true), 61.38);
  });
  it("salão sem serviço cobra só os itens", () => {
    assert.equal(totalOffline(base, false), 55.8);
  });
  it("delivery soma a taxa de entrega e não cobra serviço", () => {
    const d: ComandaOffline = {
      ...base,
      tipo: "delivery",
      taxa_servico: 0,
      delivery: {
        cliente: "Ana",
        telefone: "",
        endereco: "Rua A, 1",
        bairro: "",
        taxa: 7,
        pagamento: "dinheiro",
      },
    };
    assert.equal(totalOffline(d, true), 62.8);
  });
});
