import assert from "node:assert/strict";
import { test } from "node:test";

import { acharContato, mesmoTelefone, zonaDoBairro } from "../src/lib/delivery-busca.ts";

test("mesmo telefone com ou sem 55, DDD e pontuação", () => {
  assert.equal(mesmoTelefone("(16) 99999-0000", "16999990000"), true);
  assert.equal(mesmoTelefone("+55 16 99999-0000", "(16) 99999-0000"), true);
  assert.equal(mesmoTelefone("99999-0000", "(16) 99999-0000"), true);
  assert.equal(mesmoTelefone("(16) 3333-4444", "33334444"), true);
});

test("o 9 na frente não separa o mesmo número", () => {
  assert.equal(mesmoTelefone("(16) 99999-0000", "(16) 9999-0000"), true);
});

test("DDD diferente (os dois com DDD) ou número diferente não é o mesmo telefone", () => {
  assert.equal(mesmoTelefone("(16) 99999-0000", "(66) 99999-0000"), false);
  assert.equal(mesmoTelefone("(16) 99999-0000", "(16) 99999-0001"), false);
});

test("telefone curto demais não compara", () => {
  assert.equal(mesmoTelefone("9999", "9999"), false);
  assert.equal(mesmoTelefone("", "16999990000"), false);
});

const pedidos = [
  {
    cliente_nome: "Maria",
    entrega_telefone: "16999990000",
    entrega_endereco: "Rua A, 10",
    entrega_bairro: "Centro",
    entrega_referencia: "Portão azul",
  },
  {
    cliente_nome: "Maria antiga",
    entrega_telefone: "16999990000",
    entrega_endereco: "Rua Velha, 1",
    entrega_bairro: "Vila",
    entrega_referencia: null,
  },
];
const clientes = [
  {
    nome: "João da Silva",
    telefone: "(16) 3333-4444",
    whatsapp: "(16) 98888-1111",
    endereco: "Av. Brasil",
    numero: "200",
    bairro: "Jardim",
  },
  {
    nome: "Sem dados",
    telefone: "(16) 97777-2222",
    whatsapp: null,
    endereco: null,
    numero: null,
    bairro: null,
  },
];

test("o pedido mais recente vale mais que o cadastro", () => {
  const c = acharContato("(16) 99999-0000", pedidos, clientes);
  assert.deepEqual(c, {
    origem: "pedido",
    nome: "Maria",
    endereco: "Rua A, 10",
    bairro: "Centro",
    referencia: "Portão azul",
  });
});

test("quem nunca pediu é achado no cadastro, pelo telefone ou pelo WhatsApp", () => {
  const porTelefone = acharContato("1633334444", [], clientes);
  assert.equal(porTelefone?.origem, "cliente");
  assert.equal(porTelefone?.endereco, "Av. Brasil, 200");
  assert.equal(porTelefone?.bairro, "Jardim");
  assert.equal(acharContato("(16) 98888-1111", [], clientes)?.nome, "João da Silva");
});

test("sem pedido nem cadastro, ou cadastro sem dados úteis, não acha", () => {
  assert.equal(acharContato("(21) 95555-6666", pedidos, clientes), null);
  assert.equal(acharContato("(16) 97777-2222", [], clientes)?.nome, "Sem dados");
  assert.equal(acharContato("(16) 97777-2222", [], [{ ...clientes[1]!, nome: null }]), null);
});

const zonas = [
  { id: "1", nome: "Centro", ativo: true },
  { id: "2", nome: "Jardim América", ativo: true },
  { id: "3", nome: "Vila Nova", ativo: false },
];

test("zona pelo nome do bairro, sem acento nem caixa", () => {
  assert.equal(zonaDoBairro("CENTRO", zonas)?.id, "1");
  assert.equal(zonaDoBairro("jardim america", zonas)?.id, "2");
});

test("nome contido no outro vale a partir de 4 letras; zona inativa e bairro curto não", () => {
  assert.equal(zonaDoBairro("Jardim", zonas)?.id, "2");
  assert.equal(zonaDoBairro("Centro Histórico", zonas)?.id, "1");
  assert.equal(zonaDoBairro("Vila Nova", zonas), null);
  assert.equal(zonaDoBairro("Ce", zonas), null);
  assert.equal(zonaDoBairro("Bairro Qualquer", zonas), null);
});
