import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  percentual,
  resumirMensagens,
  rotuloEvidencia,
  separarContatos,
  type LinhaContato,
  type LinhaMensagem,
} from "../src/lib/relacionamento-clinica.ts";

const AGORA = new Date("2026-11-05T12:00:00Z");
const PET = "11111111-1111-4111-8111-111111111111";

function msg(p: Partial<LinhaMensagem>): LinhaMensagem {
  return {
    tipo: "reforco_vacina",
    situacao: "na_fila",
    origem: "manual",
    erro: null,
    tentativas: 0,
    referencia: `${PET}:2026-11-10`,
    updated_at: "2026-11-05T11:59:00Z",
    ...p,
  };
}

describe("relacionamento da clínica: resumo da fila", () => {
  it("funil cumulativo: aceita inclui entregue e lida; entrega só com confirmação", () => {
    const r = resumirMensagens(
      [
        msg({ situacao: "enviada" }),
        msg({ situacao: "entregue" }),
        msg({ situacao: "lida" }),
        msg({ situacao: "na_fila" }),
      ],
      AGORA,
    );
    assert.equal(r.aceitas, 3);
    assert.equal(r.entregues, 2);
    assert.equal(r.lidas, 1);
    assert.equal(r.naFila, 1);
    assert.equal(r.tentadas, 3);
  });
  it("na fila com tentativa anterior conta como tentada e aguardando nova tentativa", () => {
    const r = resumirMensagens([msg({ tentativas: 2 }), msg({ tentativas: 0 })], AGORA);
    assert.equal(r.naFila, 2);
    assert.equal(r.aguardandoNovaTentativa, 1);
    assert.equal(r.tentadas, 1);
  });
  it("enviando há mais de 10 minutos pede conferência; recente não", () => {
    const r = resumirMensagens(
      [
        msg({ situacao: "enviando", updated_at: "2026-11-05T11:49:00Z" }),
        msg({ situacao: "enviando", updated_at: "2026-11-05T11:55:00Z" }),
      ],
      AGORA,
    );
    assert.equal(r.conferir, 1);
    assert.equal(r.tentadas, 2);
  });
  it("falhas agrupadas por motivo, sem motivo vira texto claro, e origem separada", () => {
    const r = resumirMensagens(
      [
        msg({ situacao: "falhou", erro: "  Número  inválido " }),
        msg({ situacao: "falhou", erro: "Número inválido", origem: "automatico" }),
        msg({ situacao: "falhou", erro: null }),
        msg({ situacao: "cancelada" }),
      ],
      AGORA,
    );
    assert.equal(r.falhas, 3);
    assert.equal(r.canceladas, 1);
    assert.deepEqual(r.motivosDeFalha[0], { motivo: "Número inválido", quantidade: 2 });
    assert.equal(r.motivosDeFalha[1]?.motivo, "Sem motivo registrado");
    assert.equal(r.automaticas, 1);
    assert.equal(r.pedidasPelaRecepcao, 3);
  });
  it("lista vazia e situação desconhecida não quebram", () => {
    assert.equal(resumirMensagens([], AGORA).total, 0);
    const r = resumirMensagens([msg({ situacao: "algo_novo" })], AGORA);
    assert.equal(r.total, 1);
    assert.equal(r.tentadas, 0);
    assert.equal(rotuloEvidencia("algo_novo"), "algo_novo");
  });
  it("o rótulo de aceita deixa claro que não é entrega", () => {
    assert.match(rotuloEvidencia("enviada"), /entrega não confirmada/);
    assert.equal(rotuloEvidencia("entregue"), "Entrega confirmada");
  });
});

describe("relacionamento da clínica: contatos", () => {
  const c = (p: Partial<LinhaContato>): LinhaContato => ({
    pet_id: PET,
    referencia: "2026-11-10",
    canal: "whatsapp",
    ...p,
  });
  it("contato gravado pelo envio aceito é do sistema; link aberto e telefone são da recepção", () => {
    const mensagens = [msg({ situacao: "enviada", referencia: `${PET.toUpperCase()}:2026-11-10` })];
    const r = separarContatos(
      [
        c({}),
        c({ pet_id: "22222222-2222-4222-8222-222222222222" }),
        c({ pet_id: "33333333-3333-4333-8333-333333333333", canal: "telefone" }),
        c({ pet_id: "44444444-4444-4444-8444-444444444444", canal: "outro" }),
      ],
      mensagens,
    );
    assert.deepEqual(r, { viaSistema: 1, abriuWhatsApp: 1, declaradoPelaRecepcao: 2 });
  });
  it("mensagem que não foi aceita (fila, falha, cancelada) não explica o contato", () => {
    for (const situacao of ["na_fila", "falhou", "cancelada", "enviando"]) {
      const r = separarContatos([c({})], [msg({ situacao })]);
      assert.equal(r.viaSistema, 0, situacao);
      assert.equal(r.abriuWhatsApp, 1, situacao);
    }
  });
  it("retorno de consulta não entra na conta de reforço", () => {
    const r = separarContatos([c({})], [msg({ tipo: "retorno_consulta", situacao: "lida" })]);
    assert.equal(r.viaSistema, 0);
  });
});

describe("percentual", () => {
  it("sem base não inventa 0%", () => {
    assert.equal(percentual(0, 0), null);
    assert.equal(percentual(1, 3), 33);
    assert.equal(percentual(3, 3), 100);
  });
});
