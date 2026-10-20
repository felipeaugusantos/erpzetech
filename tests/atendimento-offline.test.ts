import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TIPO_ATENDIMENTO_FECHAR,
  TIPO_ATENDIMENTO_SALVAR,
  TIPO_VISITA_REGISTRAR,
  abrirAtendimento,
  consultasDaCopia,
  formAtendimentoVazio,
  operacaoDeFechar,
  pacientesGuardados,
  operacaoDeSalvar,
  rascunhoJaEnviado,
  salvamentosSubstituidos,
  servicosDeConsulta,
} from "../src/lib/atendimento-offline.ts";
import { situacaoNaFila } from "../src/lib/fila-clinica.ts";

const agora = new Date("2026-10-20T12:00:00Z");
const consulta = {
  id: "ag-1",
  inicio: "2026-10-20T13:00:00Z",
  situacao: "confirmado",
  pet: { id: "pet-1", nome: "Rex", especie: "cao" },
  tutor: { nome: "Ana" },
  servicos: [{ categoria: "consulta" }],
};

describe("consultasDaCopia", () => {
  it("lista só consultas atendíveis, em ordem de hora", () => {
    const agenda = [
      { ...consulta, id: "ag-2", inicio: "2026-10-20T15:00:00Z" },
      consulta,
      { ...consulta, id: "ag-3", situacao: "pronto" },
      { ...consulta, id: "ag-4", servicos: [{ categoria: "banho" }] },
      { id: 5 },
    ];
    const r = consultasDaCopia({ dados: { agenda } });
    assert.deepEqual(
      r.map((c) => c.agendamentoId),
      ["ag-1", "ag-2"],
    );
    assert.equal(r[0]?.tutorNome, "Ana");
  });
});

describe("servicosDeConsulta", () => {
  it("cópia antiga sem a lista devolve vazio", () => {
    assert.deepEqual(servicosDeConsulta({ dados: {} }), []);
  });
  it("ordena por nome", () => {
    const r = servicosDeConsulta({
      dados: {
        servicos_consulta: [
          { id: "b", nome: "Retorno", duracao_min: 20 },
          { id: "a", nome: "Consulta", duracao_min: 30 },
        ],
      },
    });
    assert.deepEqual(
      r.map((s) => s.id),
      ["a", "b"],
    );
  });
});

describe("abrirAtendimento", () => {
  it("consulta marcada leva o agendamento e não depende de nada", () => {
    const [c] = consultasDaCopia({ dados: { agenda: [consulta] } });
    const { rascunho, operacao } = abrirAtendimento(
      { tipo: "consulta_marcada", consulta: c! },
      agora,
    );
    assert.equal(operacao.tipo, TIPO_VISITA_REGISTRAR);
    assert.deepEqual(operacao.dependeDe, []);
    const p = operacao.payload as Record<string, string>;
    assert.equal(p["agendamento_id"], "ag-1");
    assert.equal(p["servico_id"], undefined);
    assert.equal(p["atendimento_id"], rascunho.atendimentoId);
    assert.equal(p["aberto_em"], agora.toISOString());
    assert.equal(rascunho.registrarOpId, operacao.id);
  });
  it("visita avulsa de pet novo espera o cadastro", () => {
    const { operacao, rascunho } = abrirAtendimento(
      {
        tipo: "visita_avulsa",
        paciente: { petId: "p", petNome: "Mia", tutorNome: "Zé", cadastroOpId: "cad-1" },
        servicoId: "sv-1",
      },
      agora,
    );
    assert.deepEqual(operacao.dependeDe, ["cad-1"]);
    const p = operacao.payload as Record<string, string>;
    assert.equal(p["servico_id"], "sv-1");
    assert.equal(p["agendamento_id"], undefined);
    assert.equal(rascunho.modo, "visita_avulsa");
  });
});

describe("salvar e fechar", () => {
  const { rascunho, operacao: registrar } = abrirAtendimento(
    {
      tipo: "visita_avulsa",
      paciente: { petId: "p", petNome: "Mia", tutorNome: "Zé" },
      servicoId: "sv-1",
    },
    agora,
  );
  it("salvar depende do registro e leva o texto", () => {
    const s = operacaoDeSalvar(rascunho, { ...formAtendimentoVazio, queixa: "tosse" }, agora);
    assert.equal(s.tipo, TIPO_ATENDIMENTO_SALVAR);
    assert.deepEqual(s.dependeDe, [registrar.id]);
    assert.equal((s.payload as { dados: { queixa: string } }).dados.queixa, "tosse");
  });
  it("só os salvamentos pendentes do mesmo atendimento são substituídos", () => {
    const a = operacaoDeSalvar(rascunho, formAtendimentoVazio, agora);
    const b = {
      ...operacaoDeSalvar(rascunho, formAtendimentoVazio, agora),
      estado: "recusada" as const,
    };
    const outro = operacaoDeSalvar(
      { ...rascunho, atendimentoId: "outro" },
      formAtendimentoVazio,
      agora,
    );
    assert.deepEqual(salvamentosSubstituidos([registrar, a, b, outro], rascunho.atendimentoId), [
      a.id,
    ]);
  });
  it("fechar espera o registro e o último salvar", () => {
    const s = operacaoDeSalvar(rascunho, formAtendimentoVazio, agora);
    const f = operacaoDeFechar(rascunho, s.id, agora);
    assert.equal(f.tipo, TIPO_ATENDIMENTO_FECHAR);
    const fila = [registrar, s, f];
    assert.equal(situacaoNaFila(f, fila), "aguardando");
    assert.equal(situacaoNaFila(registrar, fila), "pronta");
    const recusado = { ...s, estado: "recusada" as const, erro: "x" };
    assert.equal(situacaoNaFila(f, [registrar, recusado, f]), "bloqueada");
  });
  it("rascunho fechado só some quando nada dele resta na fila", () => {
    const s = operacaoDeSalvar(rascunho, formAtendimentoVazio, agora);
    assert.equal(rascunhoJaEnviado({ ...rascunho, fechado: false }, []), false);
    assert.equal(rascunhoJaEnviado({ ...rascunho, fechado: true }, [s]), false);
    assert.equal(rascunhoJaEnviado({ ...rascunho, fechado: true }, []), true);
  });
});

describe("pacientesGuardados", () => {
  const g = (guardadoEm: string, operacaoId = "cad-1") => ({
    petId: "p",
    petNome: "Mia",
    tutorNome: "Zé",
    operacaoId,
    guardadoEm,
  });
  it("continua listando o paciente depois que o cadastro saiu da fila", () => {
    const r = pacientesGuardados([g("2026-10-19T12:00:00Z")], [], agora);
    assert.equal(r.length, 1);
    assert.equal(r[0]?.cadastroOpId, undefined);
  });
  it("depende do cadastro enquanto ele está na fila", () => {
    const cad = abrirAtendimento(
      {
        tipo: "visita_avulsa",
        paciente: { petId: "p", petNome: "Mia", tutorNome: "Zé" },
        servicoId: "s",
      },
      agora,
      { operacao: "cad-1" },
    ).operacao;
    const r = pacientesGuardados([g("2026-10-19T12:00:00Z")], [cad], agora);
    assert.equal(r[0]?.cadastroOpId, "cad-1");
  });
  it("some depois de 7 dias", () => {
    assert.equal(pacientesGuardados([g("2026-10-01T12:00:00Z")], [], agora).length, 0);
  });
});
