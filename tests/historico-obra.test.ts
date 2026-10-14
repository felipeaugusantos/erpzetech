import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filtrarEventos,
  montarHistoricoObra,
  resumoPedidos,
  type EntregaObra,
} from "../src/lib/historico-obra.ts";

const pedidos = [
  {
    id: "p1",
    numero: 10,
    situacao: "em_rota",
    created_at: "2026-10-01T10:00:00Z",
    pedido_itens: [
      { quantidade: 10, quantidade_entregue: 8 },
      { quantidade: 4, quantidade_entregue: 4 },
    ],
  },
  {
    id: "p2",
    numero: 11,
    situacao: "aprovado",
    created_at: "2026-10-03T10:00:00Z",
    pedido_itens: [{ quantidade: 5, quantidade_entregue: 0 }],
  },
];

const retirada: EntregaObra = {
  id: "e1",
  pedido_id: "p1",
  numero: 1,
  tipo: "retirada",
  situacao: "entregue",
  created_at: "2026-10-02T09:00:00Z",
  data_entrega: "2026-10-02T09:00:00Z",
  previsao_data: null,
  recebedor: "João",
  entrega_itens: [{ quantidade: 4, produtos: { descricao: "Cimento", unidade: "sc" } }],
};
const agendada: EntregaObra = {
  id: "e2",
  pedido_id: "p1",
  numero: 2,
  tipo: "entrega",
  situacao: "insucesso",
  created_at: "2026-10-02T11:00:00Z",
  data_entrega: "2026-10-04T15:00:00Z",
  data_saida: "2026-10-04T08:00:00Z",
  previsao_data: "2026-10-04",
  motivo_insucesso: "Obra fechada",
  responsavel: "Mestre Zé",
  entrega_itens: [{ quantidade: 2, produtos: { descricao: "Cimento", unidade: "sc" } }],
};

const eventos = montarHistoricoObra({
  pedidos,
  historico: [
    {
      id: "h1",
      pedido_id: "p1",
      situacao_anterior: null,
      situacao_nova: "aguardando_pagamento",
      observacao: "Pedido criado direto",
      usuario_id: "u1",
      created_at: "2026-10-01T10:00:00Z",
    },
    {
      id: "h2",
      pedido_id: "p1",
      situacao_anterior: "pronto_entrega",
      situacao_nova: "em_rota",
      observacao: "Retirada parcial registrada",
      usuario_id: "u1",
      created_at: "2026-10-02T09:00:00Z",
    },
  ],
  entregas: [retirada, agendada],
  reagendamentos: [
    {
      id: "r1",
      entrega_id: "e2",
      data_anterior: "2026-10-03",
      data_nova: "2026-10-04",
      motivo: "Chuva",
      usuario_id: "u2",
      created_at: "2026-10-02T12:00:00Z",
    },
  ],
  ocorrencias: [
    {
      id: "o1",
      pedido_id: "p1",
      etapa: "separacao",
      tipo: "avaria",
      quantidade: 3,
      observacao: "Sacos rasgados",
      usuario_id: "u1",
      created_at: "2026-10-01T15:00:00Z",
      pedido_itens: { produtos: { descricao: "Cimento" } },
    },
  ],
});

test("a linha do tempo vai do início ao fim", () => {
  const ordem = eventos.map((e) => e.id);
  assert.deepEqual(ordem, ["h-h1", "oc-o1", "es-e1", "h-h2", "ea-e2", "rg-r1", "er-e2", "ei-e2"]);
});

test("retirada direta não gera agendamento, só a saída", () => {
  assert.ok(!eventos.some((e) => e.id === "ea-e1"));
  const saida = eventos.find((e) => e.id === "es-e1")!;
  assert.equal(saida.tipo, "saida");
  assert.match(saida.titulo, /Retirada 0001 concluída/);
  assert.equal(saida.detalhe, "Recebido por João");
  assert.deepEqual(saida.itens, [{ descricao: "Cimento", quantidade: 4, unidade: "sc" }]);
});

test("entrega agendada mostra data, responsável, rota, reagendamento e insucesso", () => {
  const ag = eventos.find((e) => e.id === "ea-e2")!;
  // a data do agendamento é a original (03/10); a nova aparece no reagendamento
  assert.match(ag.titulo, /Entrega 0002 agendada para 03\/10\/2026/);
  assert.equal(ag.detalhe, "Responsável na obra: Mestre Zé");
  const rg = eventos.find((e) => e.id === "rg-r1")!;
  assert.match(rg.titulo, /reagendada de 03\/10\/2026 para 04\/10\/2026/);
  assert.equal(rg.detalhe, "Chuva");
  assert.equal(rg.pedidoNumero, 10);
  const falha = eventos.find((e) => e.id === "ei-e2")!;
  assert.equal(falha.detalhe, "Obra fechada");
});

test("ocorrência traz tipo, etapa, quantidade e item", () => {
  const o = eventos.find((e) => e.id === "oc-o1")!;
  assert.equal(o.titulo, "Avaria na separação: 3 × Cimento");
  assert.equal(o.pedidoNumero, 10);
});

test("pedido criado e mudança de situação", () => {
  assert.equal(eventos.find((e) => e.id === "h-h1")!.titulo, "Pedido criado");
  assert.equal(
    eventos.find((e) => e.id === "h-h2")!.titulo,
    "Pedido: Pronto para entrega → Em rota",
  );
});

test("resumo mostra quanto de cada pedido já saiu", () => {
  const r = resumoPedidos(pedidos);
  assert.deepEqual(
    r.map((x) => [x.numero, x.pedido, x.entregue, x.pendente, x.percentual]),
    [
      [10, 14, 12, 2, 86],
      [11, 5, 0, 5, 0],
    ],
  );
});

test("filtros por tipo e por pedido", () => {
  assert.equal(filtrarEventos(eventos, { tipos: ["ocorrencia"] }).length, 1);
  assert.equal(filtrarEventos(eventos, { pedidoNumero: 11 }).length, 0);
  assert.equal(filtrarEventos(eventos, {}).length, eventos.length);
  assert.equal(
    filtrarEventos(eventos, { tipos: ["saida", "insucesso"], pedidoNumero: 10 }).length,
    2,
  );
});

test("cada tentativa que falhou continua na linha do tempo depois de reagendar", () => {
  const reagendada: EntregaObra = {
    ...agendada,
    id: "e9",
    numero: 9,
    situacao: "planejada",
    previsao_data: "2026-10-09",
    motivo_insucesso: "Cliente ausente",
  };
  const ev = montarHistoricoObra({
    pedidos,
    historico: [],
    entregas: [reagendada],
    reagendamentos: [
      {
        id: "x1",
        entrega_id: "e9",
        data_anterior: "2026-10-04",
        data_nova: "2026-10-06",
        motivo: "obra reabre",
        usuario_id: null,
        created_at: "2026-10-04T16:00:00Z",
      },
      {
        id: "x2",
        entrega_id: "e9",
        data_anterior: "2026-10-06",
        data_nova: "2026-10-09",
        motivo: "cliente confirmou",
        usuario_id: null,
        created_at: "2026-10-06T16:00:00Z",
      },
    ],
    ocorrencias: [],
    tentativas: [
      {
        id: "t1",
        entrega_id: "e9",
        motivo: "Obra fechada",
        observacao: null,
        usuario_id: "u1",
        created_at: "2026-10-04T15:00:00Z",
      },
      {
        id: "t2",
        entrega_id: "e9",
        motivo: "Cliente ausente",
        observacao: "ninguém atendeu",
        usuario_id: "u1",
        created_at: "2026-10-06T15:00:00Z",
      },
    ],
  });
  const falhas = ev.filter((e) => e.tipo === "insucesso");
  assert.deepEqual(
    falhas.map((e) => e.detalhe),
    ["Obra fechada", "Cliente ausente · ninguém atendeu"],
  );
  assert.match(ev.find((e) => e.tipo === "agendamento")!.titulo, /agendada para 04\/10\/2026/);
});
