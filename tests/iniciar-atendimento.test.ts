import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  atendimentoAbertoDoPaciente,
  dadosDaVisitaAvulsa,
  servicoInicial,
  servicosDaResposta,
} from "../src/lib/iniciar-atendimento.ts";

describe("iniciar atendimento", () => {
  it("monta a visita avulsa com os identificadores recebidos", () => {
    const d = dadosDaVisitaAvulsa("pet", "serv", "atend", new Date("2026-10-20T12:00:00Z"));
    assert.deepEqual(d, {
      atendimento_id: "atend",
      pet_id: "pet",
      servico_id: "serv",
      aberto_em: "2026-10-20T12:00:00.000Z",
    });
  });

  it("gera identificador novo a cada visita", () => {
    assert.notEqual(
      dadosDaVisitaAvulsa("p", "s").atendimento_id,
      dadosDaVisitaAvulsa("p", "s").atendimento_id,
    );
  });

  it("acha o atendimento aberto e ignora os fechados", () => {
    assert.equal(atendimentoAbertoDoPaciente([{ situacao: "fechado" }]), null);
    const lista = [{ situacao: "fechado" }, { situacao: "aberto", x: 1 }];
    assert.deepEqual(atendimentoAbertoDoPaciente(lista), { situacao: "aberto", x: 1 });
  });

  it("escolhe sozinho só quando há um serviço", () => {
    const um = [{ id: "a", nome: "Consulta", duracao_min: 30 }];
    assert.equal(servicoInicial(um), "a");
    assert.equal(servicoInicial([...um, { id: "b", nome: "Retorno", duracao_min: 15 }]), "");
    assert.equal(servicoInicial([]), "");
  });

  it("aceita só o formato esperado da resposta do banco", () => {
    assert.deepEqual(servicosDaResposta(null), []);
    assert.deepEqual(
      servicosDaResposta([{ id: "a", nome: "C", duracao_min: "30" }, { id: 1 }, null]),
      [{ id: "a", nome: "C", duracao_min: 30 }],
    );
  });
});
