import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrescricaoInternacao } from "../src/lib/internacao.ts";
import {
  aguardaMeuCiente,
  avisosDoPlantao,
  dosesProximas,
  limparPendencias,
  rotuloPendencia,
  validarPassagem,
  type PendenciaTurno,
  type TurnoInternacao,
} from "../src/lib/passagem-turno.ts";

const AGORA = new Date("2026-11-05T12:00:00Z");
const h = (horas: number) => new Date(AGORA.getTime() + horas * 3_600_000).toISOString();

function turno(p: Partial<TurnoInternacao> = {}): TurnoInternacao {
  return {
    id: "t1",
    resumo: "Estável",
    created_at: h(-1),
    autor: { id: "pa", nome: "Aux Um", funcao: "auxiliar" },
    sou_autor: false,
    minha_ciencia: false,
    pendencias: [],
    ciencias: [],
    ...p,
  };
}

function presc(
  p: Partial<PrescricaoInternacao>,
  execucoes: { id: string; em: number; situacao?: string }[],
): PrescricaoInternacao {
  return {
    id: "pr1",
    medicamento: "Amoxicilina",
    dose: "10 mg",
    via: "VO",
    frequencia_horas: 8,
    dias: 2,
    inicio: h(-10),
    observacao: null,
    situacao: "ativa",
    suspensa_em: null,
    suspensa_motivo: null,
    veterinario: "Dra Vet",
    crmv: "1",
    crmv_uf: "SP",
    execucoes: execucoes.map((e) => ({
      id: e.id,
      previsto_em: h(e.em),
      situacao: (e.situacao ?? "pendente") as "pendente",
      executado_em: null,
      executado_por: null,
      observacao: null,
    })),
    ...p,
  };
}

describe("passagem de turno: validação", () => {
  it("exige resumo e respeita os limites do banco", () => {
    assert.match(validarPassagem({ resumo: "", pendencias: [] }) ?? "", /resumo/);
    assert.match(validarPassagem({ resumo: "ab", pendencias: [] }) ?? "", /resumo/);
    assert.equal(validarPassagem({ resumo: "Estável", pendencias: [] }), null);
    assert.match(validarPassagem({ resumo: "x".repeat(2001), pendencias: [] }) ?? "", /2000/);
    assert.match(
      validarPassagem({ resumo: "ok ok", pendencias: Array(21).fill("p") }) ?? "",
      /20 pendências/,
    );
    assert.match(validarPassagem({ resumo: "ok ok", pendencias: ["x".repeat(301)] }) ?? "", /300/);
  });
  it("campos de pendência vazios no meio não contam nem atrapalham", () => {
    assert.deepEqual(limparPendencias(["  Trocar curativo ", "", "   ", "Pesar"]), [
      "Trocar curativo",
      "Pesar",
    ]);
    assert.equal(validarPassagem({ resumo: "ok ok", pendencias: ["", "  ", "A"] }), null);
    assert.equal(validarPassagem({ resumo: "ok ok", pendencias: Array(25).fill("") }), null);
  });
});

describe("passagem de turno: ciente e pendências", () => {
  it("só quem recebe, com a internação aberta e sem ciente anterior, vê o botão de ciente", () => {
    assert.equal(aguardaMeuCiente(turno(), true), true);
    assert.equal(aguardaMeuCiente(turno({ sou_autor: true }), true), false);
    assert.equal(aguardaMeuCiente(turno({ minha_ciencia: true }), true), false);
    assert.equal(aguardaMeuCiente(turno(), false), false);
  });
  it("ciente não muda o estado da pendência: aberta é aberta até alguém baixar", () => {
    const aberta: PendenciaTurno = { id: "p", texto: "x", ordem: 1, baixa: null };
    const t = turno({
      minha_ciencia: true,
      pendencias: [aberta],
      ciencias: [{ profissional: "Aux Dois", funcao: "auxiliar", created_at: h(0) }],
    });
    assert.equal(rotuloPendencia(t.pendencias[0]!), "Aberta");
    assert.equal(
      rotuloPendencia({
        ...aberta,
        baixa: { situacao: "resolvida", observacao: null, profissional: "A", created_at: h(0) },
      }),
      "Resolvida",
    );
    assert.equal(
      rotuloPendencia({
        ...aberta,
        baixa: {
          situacao: "descartada",
          observacao: "motivo",
          profissional: "A",
          created_at: h(0),
        },
      }),
      "Descartada",
    );
  });
});

describe("passagem de turno: doses (só consulta)", () => {
  it("lista as pendentes das prescrições ativas até 12 h à frente, em ordem, incluindo as atrasadas", () => {
    const lista = dosesProximas(
      [
        presc({}, [
          { id: "e3", em: 10 },
          { id: "e1", em: -2 },
          { id: "e2", em: 4 },
          { id: "e4", em: 13 },
          { id: "e5", em: 1, situacao: "executada" },
        ]),
      ],
      AGORA,
    );
    assert.deepEqual(
      lista.map((d) => d.id),
      ["e1", "e2", "e3"],
    );
    assert.equal(lista[0]!.atraso_min, 120);
    assert.equal(lista[1]!.atraso_min, -240);
  });
  it("prescrição suspensa não entra e a função não altera os dados recebidos", () => {
    const suspensa = presc({ situacao: "suspensa" }, [{ id: "x", em: 1 }]);
    const ativa = presc({}, [{ id: "y", em: 1 }]);
    const copia = JSON.stringify([suspensa, ativa]);
    assert.deepEqual(
      dosesProximas([suspensa, ativa], AGORA).map((d) => d.id),
      ["y"],
    );
    assert.equal(JSON.stringify([suspensa, ativa]), copia);
  });
  it("sem prescrição não há doses", () => {
    assert.deepEqual(dosesProximas([], AGORA), []);
  });
});

describe("plantão: avisos do cartão", () => {
  it("ciente pendente vem em destaque, depois as pendências abertas, com singular e plural", () => {
    assert.deepEqual(avisosDoPlantao(undefined), []);
    assert.deepEqual(
      avisosDoPlantao({
        internacao_id: "i",
        pendencias_abertas: 0,
        ultima_passagem_em: null,
        ultima_passagem_por: null,
        aguarda_minha_ciencia: false,
      }),
      [],
    );
    const a = avisosDoPlantao({
      internacao_id: "i",
      pendencias_abertas: 1,
      ultima_passagem_em: h(-1),
      ultima_passagem_por: "Aux Um",
      aguarda_minha_ciencia: true,
    });
    assert.deepEqual(a, [
      { texto: "Passagem de Aux Um aguarda seu ciente", alerta: true },
      { texto: "1 pendência aberta", alerta: false },
    ]);
    assert.equal(
      avisosDoPlantao({
        internacao_id: "i",
        pendencias_abertas: 3,
        ultima_passagem_em: null,
        ultima_passagem_por: null,
        aguarda_minha_ciencia: false,
      })[0]!.texto,
      "3 pendências abertas",
    );
  });
});
