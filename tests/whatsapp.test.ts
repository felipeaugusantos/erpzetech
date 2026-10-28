import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ErroEvolution,
  configurarWebhook,
  criarInstancia,
  ehPedidoDeSaida,
  enviarTexto,
  estadoConexao,
  interpretarEvento,
  nomeDaInstancia,
  numeroDoJid,
} from "../src/lib/whatsapp-evolution.ts";
import {
  RODAPE_SAIR,
  atrasoDeEnvio,
  dentroDoHorario,
  proximaTentativaEm,
  textoDoAviso,
} from "../src/lib/whatsapp-despacho.ts";

function contem(real: unknown, esperado: Record<string, unknown>) {
  const r = real as Record<string, unknown>;
  for (const [k, v] of Object.entries(esperado)) {
    if (v && typeof v === "object") contem(r[k], v as Record<string, unknown>);
    else assert.equal(r[k], v);
  }
}

const cfg = { url: "https://evo.exemplo.com/", apikey: "segredo" };

function falso(respostas: { status?: number; corpo?: unknown }[]) {
  const chamadas: { url: string; metodo: string; corpo: unknown; apikey: string | null }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    chamadas.push({
      url,
      metodo: String(init.method),
      corpo: init.body ? JSON.parse(String(init.body)) : null,
      apikey: new Headers(init.headers).get("apikey"),
    });
    const r = respostas.shift() ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, chamadas };
}

describe("adaptador Evolution", () => {
  it("nome da instância é estável e curto", () => {
    assert.equal(nomeDaInstancia("123e4567-e89b-12d3-a456-426614174000"), "zt-123e4567e89b12d3");
  });

  it("envia texto com a chave e devolve o id da mensagem", async () => {
    const { f, chamadas } = falso([
      { corpo: { key: { id: "ABC", remoteJid: "5511999990000@s.whatsapp.net" } } },
    ]);
    const r = await enviarTexto(cfg, "zt-1", "5511999990000", "oi", 2000, f);
    assert.deepEqual(r, { idMensagem: "ABC", jid: "5511999990000@s.whatsapp.net" });
    contem(chamadas[0], {
      url: "https://evo.exemplo.com/message/sendText/zt-1",
      metodo: "POST",
      apikey: "segredo",
      corpo: { number: "5511999990000", text: "oi", delay: 2000 },
    });
  });

  it("resposta sem id de mensagem é erro", async () => {
    const { f } = falso([{ corpo: {} }]);
    await assert.rejects(enviarTexto(cfg, "zt-1", "55", "oi", 0, f), ErroEvolution);
  });

  it("falha de rede marca o erro como repetível", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const erro = await enviarTexto(cfg, "zt-1", "55", "oi", 0, f).catch((e) => e as ErroEvolution);
    assert.ok(erro instanceof ErroEvolution);
    assert.equal(erro.rede, true);
  });

  it("webhook: tenta o formato aninhado e cai no plano quando recusado", async () => {
    const { f, chamadas } = falso([{ status: 400, corpo: { message: "x" } }, { status: 200 }]);
    await configurarWebhook(
      cfg,
      "zt-1",
      { url: "https://app/api/x?t=tok", eventos: ["CONNECTION_UPDATE"] },
      f,
    );
    assert.equal(chamadas.length, 2);
    assert.ok((chamadas[0]!.corpo as Record<string, unknown>)["webhook"]);
    assert.equal((chamadas[1]!.corpo as Record<string, unknown>)["webhook"], undefined);
  });

  it("criar instância que já existe não é erro", async () => {
    const { f } = falso([
      { status: 403, corpo: { response: { message: ["This name is already in use"] } } },
    ]);
    await criarInstancia(cfg, "zt-1", f);
  });

  it("estado da conexão", async () => {
    for (const [estado, esperado] of [
      ["open", "conectada"],
      ["connecting", "conectando"],
      ["close", "desconectada"],
    ] as const) {
      const { f } = falso([{ corpo: { instance: { state: estado } } }]);
      assert.equal(await estadoConexao(cfg, "zt-1", f), esperado);
    }
  });
});

describe("avisos do servidor", () => {
  it("jid de telefone e jid oculto", () => {
    assert.equal(numeroDoJid("5511999990000@s.whatsapp.net"), "5511999990000");
    assert.equal(numeroDoJid("5511999990000:12@s.whatsapp.net"), "5511999990000");
    assert.equal(numeroDoJid("123456@lid"), null);
    assert.equal(numeroDoJid(null), null);
  });

  it("conexão", () => {
    contem(
      interpretarEvento({
        event: "connection.update",
        instance: "zt-1",
        data: { state: "open", wuid: "5511999990000@s.whatsapp.net" },
      }),
      { tipo: "conexao", estado: "conectada", numero: "5511999990000" },
    );
  });

  it("status por nome e por número, em vários formatos de evento", () => {
    assert.deepEqual(
      interpretarEvento({
        event: "MESSAGES_UPDATE",
        instance: "zt-1",
        data: { keyId: "A1", status: "DELIVERY_ACK" },
      }),
      { tipo: "status", instancia: "zt-1", idMensagem: "A1", status: "entregue" },
    );
    contem(
      interpretarEvento({
        event: "messages.update",
        instance: "zt-1",
        data: [{ key: { id: "A2" }, update: { status: 4 } }],
      }),
      { idMensagem: "A2", status: "lida" },
    );
  });

  it("mensagem recebida; ignora as próprias, grupos e sem texto", () => {
    const base = { event: "messages.upsert", instance: "zt-1" };
    contem(
      interpretarEvento({
        ...base,
        data: {
          key: { remoteJid: "5511999990000@s.whatsapp.net", fromMe: false },
          message: { conversation: "SAIR" },
        },
      }),
      { tipo: "entrada", numero: "5511999990000", texto: "SAIR" },
    );
    assert.deepEqual(
      interpretarEvento({
        ...base,
        data: {
          key: { remoteJid: "1@s.whatsapp.net", fromMe: true },
          message: { conversation: "x" },
        },
      }),
      { tipo: "ignorar" },
    );
    assert.deepEqual(
      interpretarEvento({
        ...base,
        data: { key: { remoteJid: "1@g.us" }, message: { conversation: "x" } },
      }),
      { tipo: "ignorar" },
    );
    assert.deepEqual(
      interpretarEvento({ ...base, data: { key: { remoteJid: "1@s.whatsapp.net" }, message: {} } }),
      {
        tipo: "ignorar",
      },
    );
  });

  it("lid sem número real fica sem número, mas guarda o jid", () => {
    const e = interpretarEvento({
      event: "messages.upsert",
      instance: "zt-1",
      data: { key: { remoteJid: "999@lid" }, message: { conversation: "parar" } },
    });
    contem(e, { tipo: "entrada", jid: "999@lid", numero: null });
  });

  it("lixo vira ignorar", () => {
    assert.deepEqual(interpretarEvento(null), { tipo: "ignorar" });
    assert.deepEqual(interpretarEvento("x"), { tipo: "ignorar" });
    assert.deepEqual(interpretarEvento({ event: "x" }), { tipo: "ignorar" });
  });

  it("pedido de saída só em mensagem curta e clara", () => {
    for (const t of ["SAIR", "Sair!", "parar", "Não quero mais receber", "STOP"])
      assert.equal(ehPedidoDeSaida(t), true);
    for (const t of ["", "quero sair às 18h para buscar o carro", "obrigado", "ok"])
      assert.equal(ehPedidoDeSaida(t), false);
  });
});

describe("regras de envio", () => {
  it("texto traz o modelo e o rodapé de saída", () => {
    const t = textoDoAviso("pronto", { cliente: "Ana", veiculo: "Gol", loja: "Lava Top" });
    assert.ok(t.includes("Ana"));
    assert.equal(t.endsWith(RODAPE_SAIR), true);
    assert.equal(
      textoDoAviso("pronto", { cliente: "Ana" }, "Olá {cliente}!"),
      `Olá Ana!${RODAPE_SAIR}`,
    );
  });

  it("espera entre tentativas e esgotamento", () => {
    const agora = new Date("2026-01-01T12:00:00Z");
    assert.equal(proximaTentativaEm(1, agora)?.toISOString(), "2026-01-01T12:02:00.000Z");
    assert.equal(proximaTentativaEm(2, agora)?.toISOString(), "2026-01-01T12:10:00.000Z");
    assert.equal(proximaTentativaEm(3, agora)?.toISOString(), "2026-01-01T12:30:00.000Z");
    assert.equal(proximaTentativaEm(4, agora), null);
  });

  it("atraso e horário", () => {
    assert.equal(
      atrasoDeEnvio(() => 0),
      1500,
    );
    assert.equal(
      atrasoDeEnvio(() => 1),
      4000,
    );
    assert.equal(dentroDoHorario(new Date("2026-01-01T11:00:00Z")), true); // 8h em Brasília
    assert.equal(dentroDoHorario(new Date("2026-01-01T10:59:00Z")), false);
    assert.equal(dentroDoHorario(new Date("2026-01-01T23:00:00Z")), false); // 20h
  });
});
