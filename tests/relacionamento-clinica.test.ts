import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  estadoDoAviso,
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
  const aceita = (p: Partial<LinhaMensagem> = {}) =>
    msg({ situacao: "enviada", referencia: `${PET}:2026-11-10`, ...p });

  it("WhatsApp que coincide com aviso aceito tem origem indeterminada; sem aviso é da recepção", () => {
    const r = separarContatos(
      [c({}), c({ pet_id: "22222222-2222-4222-8222-222222222222" })],
      [aceita({ referencia: `${PET.toUpperCase()}:2026-11-10` })],
    );
    assert.deepEqual(r, { whatsappDaRecepcao: 1, declaradoPelaRecepcao: 0, coincideComAviso: 1 });
  });
  it("telefone e outro canal são sempre da recepção, mesmo com aviso aceito na mesma ocasião", () => {
    const r = separarContatos(
      [
        c({ canal: "telefone" }),
        c({ canal: "outro", pet_id: "33333333-3333-4333-8333-333333333333" }),
      ],
      [aceita(), aceita({ referencia: "33333333-3333-4333-8333-333333333333:2026-11-10" })],
    );
    assert.deepEqual(r, { whatsappDaRecepcao: 0, declaradoPelaRecepcao: 2, coincideComAviso: 0 });
  });
  it("mensagem que não foi aceita (fila, falha, cancelada) não explica o contato", () => {
    for (const situacao of ["na_fila", "falhou", "cancelada", "enviando"]) {
      const r = separarContatos([c({})], [aceita({ situacao })]);
      assert.equal(r.coincideComAviso, 0, situacao);
      assert.equal(r.whatsappDaRecepcao, 1, situacao);
    }
  });
  it("retorno de consulta não entra na conta de reforço", () => {
    const r = separarContatos([c({})], [aceita({ tipo: "retorno_consulta", situacao: "lida" })]);
    assert.equal(r.coincideComAviso, 0);
  });
  it("origem vem de lista própria: aviso criado antes do período e aceito nele explica o contato", () => {
    // o painel busca as mensagens de origem por updated_at, não pelo created_at do funil; aqui a lista de
    // origem tem um aviso criado fora da janela do funil e o contato cai dentro do período
    const origem = [aceita({ updated_at: "2026-11-05T01:00:00Z" })];
    const funil = resumirMensagens([], AGORA);
    assert.equal(funil.total, 0);
    assert.equal(separarContatos([c({})], origem).coincideComAviso, 1);
  });
});

describe("percentual", () => {
  it("sem base não inventa 0%", () => {
    assert.equal(percentual(0, 0), null);
    assert.equal(percentual(1, 3), 33);
    assert.equal(percentual(3, 3), 100);
  });
});

describe("estado do aviso na lista de reforços", () => {
  const enviadaHa = (h: number) => new Date(AGORA.getTime() - h * 3_600_000).toISOString();
  it("na fila e em tentativa bloqueiam novo envio", () => {
    for (const s of ["na_fila", "enviando"]) {
      const e = estadoDoAviso(s, null, null, AGORA);
      assert.equal(e.bloqueiaNovoEnvio, true, s);
      assert.equal(e.rotulo, "Na fila do sistema");
    }
  });
  it("serviço aceitou aguarda entrega e bloqueia; passadas 24 h libera e alerta", () => {
    const novo = estadoDoAviso("enviada", enviadaHa(2), null, AGORA);
    assert.equal(novo.bloqueiaNovoEnvio, true);
    assert.match(novo.rotulo ?? "", /aguardando confirmação de entrega/);
    const velho = estadoDoAviso("enviada", enviadaHa(25), null, AGORA);
    assert.equal(velho.bloqueiaNovoEnvio, false);
    assert.equal(velho.tom, "alerta");
    assert.match(velho.rotulo ?? "", /Sem confirmação de entrega há mais de 24 h/);
  });
  it("entrega confirmada e leitura bloqueiam; falha libera e mostra o motivo", () => {
    assert.equal(estadoDoAviso("entregue", enviadaHa(1), null, AGORA).bloqueiaNovoEnvio, true);
    assert.equal(estadoDoAviso("lida", enviadaHa(1), null, AGORA).rotulo, "Entrega confirmada");
    const f = estadoDoAviso("falhou", null, "Número sem WhatsApp", AGORA);
    assert.equal(f.bloqueiaNovoEnvio, false);
    assert.equal(f.rotulo, "Falhou: Número sem WhatsApp");
    assert.equal(estadoDoAviso("falhou", null, null, AGORA).rotulo, "Falhou");
  });
  it("cancelada, desconhecida ou sem aviso: nada a mostrar e nada bloqueado", () => {
    for (const s of ["cancelada", undefined, "algo_novo"]) {
      const e = estadoDoAviso(s, null, null, AGORA);
      assert.deepEqual(e, { rotulo: null, bloqueiaNovoEnvio: false, tom: "neutro" });
    }
  });
  it("enviada sem data de envio não é tratada como antiga", () => {
    assert.equal(estadoDoAviso("enviada", null, null, AGORA).bloqueiaNovoEnvio, true);
  });
});
