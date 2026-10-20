import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TIPO_VACINA_APLICAR,
  TIPO_VACINA_EXTERNA,
  aplicacaoVazia,
  consultasDeVacina,
  dosesDaCopia,
  dosesReservadas,
  erroDaAplicacao,
  erroDaExterna,
  externaVazia,
  itensDaCopia,
  lotesDisponiveis,
  operacaoDeAplicar,
  operacaoDeExterna,
  servicosDeVacina,
  somarDose,
  trocarLote,
} from "../src/lib/vacina-offline.ts";
import { situacaoNaFila } from "../src/lib/fila-clinica.ts";

const hoje = "2026-10-20";
const agora = new Date("2026-10-20T12:00:00Z");
const paciente = { petId: "pet-1", petNome: "Rex", tutorNome: "Ana", especie: "cao" };

const copia = {
  dados: {
    agenda: [
      {
        id: "ag-1",
        inicio: "2026-10-20T13:00:00Z",
        situacao: "agendado",
        pet: { id: "pet-1", nome: "Rex", especie: "cao" },
        tutor: { nome: "Ana" },
        servicos: [{ categoria: "vacina" }],
      },
      {
        id: "ag-2",
        inicio: "2026-10-20T14:00:00Z",
        situacao: "agendado",
        pet: { id: "pet-2", nome: "Mia", especie: "gato" },
        tutor: { nome: "Zé" },
        servicos: [{ categoria: "consulta" }],
      },
    ],
    catalogo_vacinas: [
      {
        id: "c-cao",
        nome: "V10",
        tipo: "vacina",
        especie: "cao",
        ativo: true,
        lotes: [
          { id: "l-1", lote: "A", validade: "2027-01-01", quantidade: 1, deposito: "D" },
          { id: "l-2", lote: "B", validade: "2026-10-01", quantidade: 9, deposito: "D" },
          { id: "l-3", lote: "C", validade: "2027-02-01", quantidade: 3, deposito: "D" },
        ],
      },
      { id: "c-gato", nome: "Quádrupla", especie: "gato", ativo: true, lotes: [] },
      { id: "c-todas", nome: "Vermífugo", tipo: "vermifugo", especie: "todas", ativo: true },
      { id: "c-off", nome: "Antiga", especie: "cao", ativo: false, lotes: [] },
    ],
    servicos_vacina: [{ id: "sv", nome: "Vacinação", duracao_min: 15 }],
  },
};

describe("copia da visita", () => {
  it("itens servem para a espécie e ignoram os inativos", () => {
    assert.deepEqual(
      itensDaCopia(copia, "cao").map((i) => i.id),
      ["c-cao", "c-todas"],
    );
    assert.deepEqual(
      itensDaCopia(copia, "gato").map((i) => i.id),
      ["c-gato", "c-todas"],
    );
  });
  it("consultas de vacina e serviços", () => {
    assert.deepEqual(
      consultasDeVacina(copia).map((c) => c.agendamentoId),
      ["ag-1"],
    );
    assert.equal(servicosDeVacina(copia)[0]?.id, "sv");
    assert.deepEqual(servicosDeVacina({ dados: {} }), []);
  });
});

describe("lotes", () => {
  const item = itensDaCopia(copia, "cao")[0]!;
  it("tira o vencido e conta o saldo", () => {
    assert.deepEqual(
      lotesDisponiveis(item, [], hoje).map((l) => l.id),
      ["l-1", "l-3"],
    );
  });
  it("desconta as doses já aplicadas e ainda não enviadas", () => {
    const op = operacaoDeAplicar(
      paciente,
      { tipo: "agenda", agendamentoId: "ag-1" },
      item,
      { ...aplicacaoVazia(hoje), catalogoId: item.id, loteId: "l-1" },
      agora,
    );
    assert.equal(dosesReservadas([op], "l-1"), 1);
    assert.deepEqual(
      lotesDisponiveis(item, [op], hoje).map((l) => l.id),
      ["l-3"],
    );
    assert.equal(dosesReservadas([{ ...op, estado: "recusada" }], "l-1"), 0);
  });
});

describe("doses já enviadas", () => {
  const item = itensDaCopia(copia, "cao")[0]!;
  it("o lote de uma dose só continua esgotado depois do envio", () => {
    const doses = somarDose(null, "t1", "l-1");
    assert.deepEqual(dosesDaCopia(doses, "t1"), { "l-1": 1 });
    assert.deepEqual(
      lotesDisponiveis(item, [], hoje, dosesDaCopia(doses, "t1")).map((l) => l.id),
      ["l-3"],
    );
    assert.deepEqual(somarDose(doses, "t1", "l-1").porLote, { "l-1": 2 });
  });
  it("uma cópia nova zera a conta", () => {
    const doses = somarDose(null, "t1", "l-1");
    assert.deepEqual(dosesDaCopia(doses, "t2"), {});
    assert.deepEqual(somarDose(doses, "t2", "l-3").porLote, { "l-3": 1 });
  });
});

describe("aplicação", () => {
  const ok = { ...aplicacaoVazia(hoje), catalogoId: "c", loteId: "l" };
  it("confere o formulário", () => {
    assert.equal(erroDaAplicacao(ok, hoje), null);
    assert.match(erroDaAplicacao({ ...ok, catalogoId: "" }, hoje) ?? "", /vacina/);
    assert.match(erroDaAplicacao({ ...ok, loteId: "" }, hoje) ?? "", /lote/);
    assert.match(erroDaAplicacao({ ...ok, aplicadaEm: "2026-10-21" }, hoje) ?? "", /futuro/);
    assert.match(erroDaAplicacao({ ...ok, aplicadaEm: "2026-10-01" }, hoje) ?? "", /7 dias/);
    assert.equal(erroDaAplicacao({ ...ok, aplicadaEm: "2026-10-13" }, hoje), null);
  });
  it("na agenda leva o agendamento; avulsa leva paciente e serviço", () => {
    const a = operacaoDeAplicar(
      paciente,
      { tipo: "agenda", agendamentoId: "ag-1" },
      { nome: "V10" },
      ok,
      agora,
    );
    const p = a.payload as Record<string, string>;
    assert.equal(a.tipo, TIPO_VACINA_APLICAR);
    assert.equal(p["agendamento_id"], "ag-1");
    assert.equal(p["pet_id"], undefined);
    const v = operacaoDeAplicar(
      { ...paciente, cadastroOpId: "cad" },
      { tipo: "avulsa", servicoId: "sv" },
      { nome: "V10" },
      ok,
      agora,
    );
    const q = v.payload as Record<string, string>;
    assert.equal(q["pet_id"], "pet-1");
    assert.equal(q["servico_id"], "sv");
    assert.equal(q["agendamento_id"], undefined);
    assert.deepEqual(v.dependeDe, ["cad"]);
  });
  it("vacina de outro local exige quem informou", () => {
    const f = { ...externaVazia(hoje), catalogoId: "c" };
    assert.match(erroDaExterna(f, hoje) ?? "", /quem passou/);
    assert.equal(erroDaExterna({ ...f, informadoPor: "Carteira" }, hoje), null);
    const op = operacaoDeExterna(
      paciente,
      { nome: "V10" },
      { ...f, informadoPor: " Carteira ", lote: "X1" },
      agora,
    );
    assert.equal(op.tipo, TIPO_VACINA_EXTERNA);
    assert.equal((op.payload as Record<string, string>)["informado_por"], "Carteira");
  });
});

describe("trocarLote", () => {
  const op = operacaoDeAplicar(
    paciente,
    { tipo: "agenda", agendamentoId: "ag-1" },
    { nome: "V10" },
    { ...aplicacaoVazia(hoje), catalogoId: "c", loteId: "l-1" },
    agora,
  );
  it("só vale para aplicação recusada e mantém a chave", () => {
    assert.equal(trocarLote(op, "l-3"), op);
    const recusada = {
      ...op,
      estado: "recusada" as const,
      erro: "O lote A não tem saldo",
      tentativas: 1,
    };
    const nova = trocarLote(recusada, "l-3");
    assert.equal(nova.id, op.id);
    assert.equal(nova.estado, "pendente");
    assert.equal(nova.erro, null);
    assert.equal(nova.tentativas, 1);
    assert.equal((nova.payload as Record<string, string>)["estoque_lote_id"], "l-3");
    assert.equal(situacaoNaFila(nova, [nova]), "pronta");
  });
});
