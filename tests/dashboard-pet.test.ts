import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aFrente,
  agendaDoDia,
  atendimentosPorDia,
  clientesSemRetorno,
  diasPorGrupo,
  faltas,
  faturamento,
  servicosMaisVendidos,
  somaDiasISO,
  type AgendamentoDash,
} from "../src/lib/dashboard-pet.ts";
import { ehEmpresaPet } from "../src/lib/ramo-clinica.ts";

// 12h de Brasília = 15h UTC (não muda de dia)
const em = (dia: string) => `${dia}T15:00:00Z`;
const ag = (
  id: string,
  dia: string,
  situacao: string,
  cliente: string,
  itens: [string, number][] = [],
): AgendamentoDash => ({
  id,
  inicio: em(dia),
  situacao,
  cliente_id: cliente,
  itens: itens.map(([servico, preco_aplicado]) => ({ servico, preco_aplicado })),
});

const lista = [
  ag("1", "2026-10-20", "pronto", "A", [["Consulta", 120]]),
  ag("2", "2026-10-20", "em_atendimento", "B", [["Banho", 60]]),
  ag("3", "2026-10-20", "agendado", "C", [["Vacina", 90]]),
  ag("4", "2026-10-20", "faltou", "D", [["Banho", 60]]),
  ag("5", "2026-10-19", "retirado", "A", [
    ["Banho", 60],
    ["Tosa", 40],
  ]),
  ag("6", "2026-10-19", "cancelado", "E"),
  ag("7", "2026-06-01", "retirado", "F", [["Consulta", 120]]),
  ag("8", "2026-10-25", "confirmado", "G", [["Consulta", 120]]),
];

test("agenda do dia separa marcado, em atendimento e concluído; falta não conta", () => {
  assert.deepEqual(agendaDoDia(lista, "2026-10-20"), {
    total: 3,
    emAtendimento: 1,
    concluidos: 1,
    aguardando: 1,
  });
});

test("faturamento só soma concluídos e dá o ticket médio", () => {
  const f = faturamento(lista, "2026-10-19", "2026-10-20");
  assert.equal(f.atendimentos, 2);
  assert.equal(f.total, 220);
  assert.equal(f.ticket, 110);
  assert.deepEqual(faturamento(lista, "2026-01-01", "2026-01-02"), {
    total: 0,
    atendimentos: 0,
    ticket: 0,
  });
});

test("taxa de faltas e cancelamentos sobre tudo o que estava marcado", () => {
  const r = faltas(lista, "2026-10-19", "2026-10-20");
  assert.equal(r.total, 6);
  assert.equal(r.faltas, 1);
  assert.equal(r.cancelados, 1);
  assert.ok(Math.abs(r.taxa - 33.333) < 0.01);
  assert.equal(faltas([], "2026-10-01", "2026-10-31").taxa, 0);
});

test("o que está por vir conta só agendado e confirmado a partir de agora", () => {
  const agora = new Date("2026-10-20T10:00:00Z");
  assert.deepEqual(aFrente(lista, agora, 7), { total: 2, proximosDias: 2 });
  assert.deepEqual(aFrente(lista, agora, 2), { total: 2, proximosDias: 1 });
});

test("clientes sem retorno: ativos nos 12 meses que não voltaram em 90 dias", () => {
  // A e F tiveram atendimento; A voltou em outubro, F só em junho (141 dias antes de 20/10)
  assert.deepEqual(clientesSemRetorno(lista, "2026-10-20", 90), { ativos: 2, semRetorno: 1 });
  assert.deepEqual(clientesSemRetorno(lista, "2026-10-20", 200), { ativos: 2, semRetorno: 0 });
});

test("serviços mais vendidos ordena por faturamento e ignora o que não foi concluído", () => {
  const top = servicosMaisVendidos(lista, "2026-10-19", "2026-10-20", 5);
  assert.deepEqual(
    top.map((t) => [t.servico, t.quantidade, t.total]),
    [
      ["Consulta", 1, 120],
      ["Banho", 1, 60],
      ["Tosa", 1, 40],
    ],
  );
  assert.equal(servicosMaisVendidos(lista, "2026-10-19", "2026-10-20", 1).length, 1);
});

test("atendimentos por dia completa os dias sem atendimento", () => {
  assert.deepEqual(atendimentosPorDia(lista, "2026-10-18", "2026-10-20"), [
    { dia: "2026-10-18", atendimentos: 0 },
    { dia: "2026-10-19", atendimentos: 1 },
    { dia: "2026-10-20", atendimentos: 1 },
  ]);
});

test("gráfico cobre o período inteiro: semana em período longo, mês em período muito longo", () => {
  const tres = atendimentosPorDia(lista, "2026-08-01", "2026-10-31"); // 92 dias
  assert.equal(tres[0]?.dia, "2026-08-01");
  assert.ok((tres.at(-1)?.dia ?? "") >= "2026-10-24");
  assert.equal(
    tres.reduce((s, x) => s + x.atendimentos, 0),
    2,
  );
  assert.equal(diasPorGrupo("2026-01-01", "2026-02-01"), 1);
  assert.equal(diasPorGrupo("2026-01-01", "2026-06-30"), 7);
  assert.equal(diasPorGrupo("2025-01-01", "2026-10-31"), 30);
});

test("período com data apagada ou invertido não gera gráfico nem erro", () => {
  assert.deepEqual(atendimentosPorDia(lista, "", "2026-10-20"), []);
  assert.deepEqual(atendimentosPorDia(lista, "2026-10-20", ""), []);
  assert.deepEqual(atendimentosPorDia(lista, "2026-10-20", "2026-10-01"), []);
});

test("soma de dias de data", () => {
  assert.equal(somaDiasISO("2026-10-31", 1), "2026-11-01");
  assert.equal(somaDiasISO("2026-03-01", -1), "2026-02-28");
});

test("dashboard pet: clínica, ramo pet shop e CNAE de pet shop; liberação de outro módulo desfaz", () => {
  assert.equal(ehEmpresaPet({ ramo_atividade: "clinica" }), true);
  assert.equal(ehEmpresaPet({ ramo_atividade: "petshop" }), true);
  assert.equal(ehEmpresaPet({ cnae: "4789-0/04", cnpj: "11222333000181" }), true);
  assert.equal(ehEmpresaPet({ ramo_atividade: "petshop", modulos_liberados: ["obras"] }), false);
  assert.equal(ehEmpresaPet({ ramo_atividade: "construcao" }), false);
  // liberação explícita e escolha sem CNPJ (resolvidas pelo mesmo critério do menu)
  assert.equal(
    ehEmpresaPet({ ramo_atividade: "construcao", modulos_liberados: ["petshop"] }),
    true,
  );
  assert.equal(
    ehEmpresaPet({ ramo_atividade: "construcao", modulos_liberados: ["clinica"] }),
    true,
  );
  assert.equal(
    ehEmpresaPet({ ramo_atividade: "construcao", cnpj: "", modulos_sem_cnpj: ["petshop"] }),
    true,
  );
  assert.equal(
    ehEmpresaPet({
      ramo_atividade: "construcao",
      cnpj: "",
      modulos_sem_cnpj: ["petshop", "locacao"],
    }),
    false,
  );
  // CNAE de pet shop só como secundário não troca o dashboard
  assert.equal(
    ehEmpresaPet({ cnae: "4744-0/01", cnae_secundarios: "4789-0/04", cnpj: "11222333000181" }),
    false,
  );
  assert.equal(ehEmpresaPet(null), false);
});
