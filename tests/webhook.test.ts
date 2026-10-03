import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calcularHmac,
  compararSeguro,
  timestampValido,
  tratarWebhook,
  verificarAssinatura,
  type DepsWebhook,
  type ProvedorWebhook,
  type RegistroWebhook,
} from "../src/lib/webhook.ts";

// Vetor de teste do RFC 4231 (caso 2) para HMAC-SHA256.
const CHAVE = "Jefe";
const DADOS = "what do ya want for nothing?";
const HMAC_HEX = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";
const HMAC_B64 = Buffer.from(HMAC_HEX, "hex").toString("base64");

test("HMAC-SHA256 confere com o vetor do RFC 4231", async () => {
  assert.equal(await calcularHmac(CHAVE, DADOS), HMAC_HEX);
  assert.equal(await calcularHmac(CHAVE, DADOS, "SHA-256", "base64"), HMAC_B64);
});

test("compararSeguro compara em valor e tamanho", () => {
  assert.equal(compararSeguro("abc", "abc"), true);
  assert.equal(compararSeguro("abc", "abd"), false);
  assert.equal(compararSeguro("abc", "abcd"), false);
  assert.equal(compararSeguro("", ""), true);
});

test("verificarAssinatura aceita hex, base64 e prefixo", async () => {
  assert.equal(await verificarAssinatura(DADOS, HMAC_HEX, { segredo: CHAVE }), true);
  assert.equal(await verificarAssinatura(DADOS, HMAC_HEX.toUpperCase(), { segredo: CHAVE }), true);
  assert.equal(
    await verificarAssinatura(DADOS, HMAC_B64, { segredo: CHAVE, formato: "base64" }),
    true,
  );
  assert.equal(
    await verificarAssinatura(DADOS, `sha256=${HMAC_HEX}`, { segredo: CHAVE, prefixo: "sha256=" }),
    true,
  );
});

test("verificarAssinatura recusa corpo alterado, segredo errado e assinatura ausente", async () => {
  assert.equal(await verificarAssinatura(`${DADOS}!`, HMAC_HEX, { segredo: CHAVE }), false);
  assert.equal(await verificarAssinatura(DADOS, HMAC_HEX, { segredo: "outro" }), false);
  assert.equal(await verificarAssinatura(DADOS, null, { segredo: CHAVE }), false);
  assert.equal(await verificarAssinatura(DADOS, "", { segredo: CHAVE }), false);
  assert.equal(await verificarAssinatura(DADOS, HMAC_HEX, { segredo: "" }), false);
  assert.equal(await verificarAssinatura(DADOS, "curta", { segredo: CHAVE }), false);
  assert.equal(
    await verificarAssinatura(DADOS, HMAC_HEX, { segredo: CHAVE, prefixo: "sha256=" }),
    false,
  );
});

test("timestampValido respeita a tolerância", () => {
  const agora = 1_700_000_000_000;
  assert.equal(timestampValido(1_700_000_000, agora), true);
  assert.equal(timestampValido(1_700_000_000 - 299, agora), true);
  assert.equal(timestampValido(1_700_000_000 - 301, agora), false);
  assert.equal(timestampValido(1_700_000_000 + 301, agora), false);
  assert.equal(timestampValido(Number.NaN, agora), false);
});

// ---------------------------------------------------------------------------------------------

const SEGREDO = "segredo-de-teste";

type Chamada = { tipo: "registrar" | "concluir" | "processar"; dados: unknown };

function montar(opcoes?: {
  registro?: RegistroWebhook["resultado"];
  concluir?: (dados: Record<string, unknown>) => Promise<boolean>;
  processar?: () => Promise<"processado" | "ignorado">;
  segredo?: string | undefined;
  maxBytes?: number;
}) {
  const chamadas: Chamada[] = [];
  const provedor: ProvedorWebhook = {
    nome: "teste",
    segredo: () => (opcoes && "segredo" in opcoes ? opcoes.segredo : SEGREDO),
    cabecalhoAssinatura: "x-assinatura",
    extrair: (payload) => {
      const p = payload as { id?: string; tenant?: string };
      return p.id ? { id: p.id, tenantId: p.tenant ?? null } : null;
    },
    processar: async (evento) => {
      chamadas.push({ tipo: "processar", dados: evento });
      return opcoes?.processar ? opcoes.processar() : "processado";
    },
  };
  const deps: DepsWebhook = {
    provedores: { teste: provedor },
    registrar: async (dados) => {
      chamadas.push({ tipo: "registrar", dados });
      return { resultado: opcoes?.registro ?? "novo", tentativa: 7 };
    },
    concluir: async (dados) => {
      chamadas.push({ tipo: "concluir", dados });
      return opcoes?.concluir ? opcoes.concluir({ ...dados }) : true;
    },
    ...(opcoes?.maxBytes ? { maxBytes: opcoes.maxBytes } : {}),
  };
  return { deps, chamadas };
}

async function requisicao(corpo: string, opcoes?: { assinatura?: string; metodo?: string }) {
  const assinatura = opcoes?.assinatura ?? (await calcularHmac(SEGREDO, corpo));
  return new Request("https://app.test/api/public/webhooks/teste", {
    method: opcoes?.metodo ?? "POST",
    headers: { "x-assinatura": assinatura, "content-type": "application/json" },
    ...((opcoes?.metodo ?? "POST") === "POST" ? { body: corpo } : {}),
  });
}

const EVENTO = JSON.stringify({ id: "evt_1", tenant: "11111111-1111-1111-1111-111111111111" });

test("evento válido é registrado, processado e concluído", async () => {
  const { deps, chamadas } = montar();
  const r = await tratarWebhook(await requisicao(EVENTO), "teste", deps);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: "processado" });
  assert.deepEqual(
    chamadas.map((c) => c.tipo),
    ["registrar", "processar", "concluir"],
  );
  assert.deepEqual(chamadas[0]?.dados, {
    provedor: "teste",
    eventId: "evt_1",
    tenantId: "11111111-1111-1111-1111-111111111111",
    payload: { id: "evt_1", tenant: "11111111-1111-1111-1111-111111111111" },
  });
});

test("assinatura inválida: 401 e nada é registrado nem processado", async () => {
  const { deps, chamadas } = montar();
  const r = await tratarWebhook(await requisicao(EVENTO, { assinatura: "00" }), "teste", deps);
  assert.equal(r.status, 401);
  assert.equal(chamadas.length, 0);
});

test("evento duplicado: 200 sem processar de novo", async () => {
  const { deps, chamadas } = montar({ registro: "duplicado" });
  const r = await tratarWebhook(await requisicao(EVENTO), "teste", deps);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: "duplicado" });
  assert.deepEqual(
    chamadas.map((c) => c.tipo),
    ["registrar"],
  );
});

test("reprocessar executa o provedor de novo", async () => {
  const { deps, chamadas } = montar({ registro: "reprocessar" });
  const r = await tratarWebhook(await requisicao(EVENTO), "teste", deps);
  assert.equal(r.status, 200);
  assert.ok(chamadas.some((c) => c.tipo === "processar"));
});

test("erro ao processar: 500 e o evento é marcado com erro", async () => {
  const { deps, chamadas } = montar({
    processar: async () => {
      throw new Error("falhou");
    },
  });
  const r = await tratarWebhook(await requisicao(EVENTO), "teste", deps);
  assert.equal(r.status, 500);
  const ultima = chamadas.at(-1);
  assert.equal(ultima?.tipo, "concluir");
  assert.deepEqual(ultima?.dados, {
    provedor: "teste",
    eventId: "evt_1",
    tentativa: 7,
    status: "erro",
    erro: "falhou",
  });
});

test("resultado 'ignorado' é repassado ao registro", async () => {
  const { deps, chamadas } = montar({ processar: async () => "ignorado" });
  const r = await tratarWebhook(await requisicao(EVENTO), "teste", deps);
  assert.deepEqual(await r.json(), { status: "ignorado" });
  assert.equal((chamadas.at(-1)?.dados as { status: string }).status, "ignorado");
});

test("provedor desconhecido (inclusive nomes herdados de Object): 404", async () => {
  const { deps } = montar();
  for (const nome of ["nao-existe", "constructor", "__proto__", "toString"]) {
    const r = await tratarWebhook(await requisicao(EVENTO), nome, deps);
    assert.equal(r.status, 404, nome);
  }
});

test("método diferente de POST: 405", async () => {
  const { deps } = montar();
  const r = await tratarWebhook(await requisicao("", { metodo: "GET" }), "teste", deps);
  assert.equal(r.status, 405);
});

test("provedor sem segredo configurado: 500 e nada é aceito", async () => {
  const { deps, chamadas } = montar({ segredo: undefined });
  const r = await tratarWebhook(await requisicao(EVENTO), "teste", deps);
  assert.equal(r.status, 500);
  assert.equal(chamadas.length, 0);
});

test("corpo acima do limite: 413", async () => {
  const { deps, chamadas } = montar({ maxBytes: 10 });
  const r = await tratarWebhook(await requisicao(EVENTO), "teste", deps);
  assert.equal(r.status, 413);
  assert.equal(chamadas.length, 0);
});

test("JSON inválido ou sem identificador: 400", async () => {
  const { deps } = montar();
  const invalido = await tratarWebhook(await requisicao("não é json"), "teste", deps);
  assert.equal(invalido.status, 400);
  const semId = await tratarWebhook(await requisicao(JSON.stringify({ x: 1 })), "teste", deps);
  assert.equal(semId.status, 400);
});

test("falha ao gravar a conclusão depois de processar NÃO marca erro nem devolve 500", async () => {
  const { deps, chamadas } = montar({
    concluir: async () => {
      throw new Error("banco indisponível");
    },
  });
  const r = await tratarWebhook(await requisicao(EVENTO), "teste", deps);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: "processado" });
  const conclusoes = chamadas.filter((c) => c.tipo === "concluir");
  assert.equal(conclusoes.length, 3, "tenta gravar a conclusão 3 vezes");
  assert.ok(conclusoes.every((c) => (c.dados as { status: string }).status === "processado"));
  assert.equal(chamadas.filter((c) => c.tipo === "processar").length, 1, "processa uma única vez");
});

test("falha transitória ao gravar a conclusão é repetida e o evento fecha como processado", async () => {
  let falhas = 1;
  const { deps, chamadas } = montar({
    concluir: async () => {
      if (falhas-- > 0) throw new Error("timeout");
      return true;
    },
  });
  const r = await tratarWebhook(await requisicao(EVENTO), "teste", deps);
  assert.equal(r.status, 200);
  assert.equal(chamadas.filter((c) => c.tipo === "concluir").length, 2);
});

test("conclusão descartada (outra tentativa assumiu o evento) segue como 200", async () => {
  const { deps } = montar({ concluir: async () => false });
  const r = await tratarWebhook(await requisicao(EVENTO), "teste", deps);
  assert.equal(r.status, 200);
});

test("erro ao processar e falha ao registrar o erro: ainda 500", async () => {
  const { deps } = montar({
    processar: async () => {
      throw new Error("falhou");
    },
    concluir: async () => {
      throw new Error("banco indisponível");
    },
  });
  const r = await tratarWebhook(await requisicao(EVENTO), "teste", deps);
  assert.equal(r.status, 500);
});

test("corpo em fluxo sem Content-Length acima do limite: 413 e a leitura é interrompida", async () => {
  const { deps, chamadas } = montar({ maxBytes: 10 });
  let lidos = 0;
  const fluxo = new ReadableStream<Uint8Array>({
    pull(controle) {
      lidos++;
      if (lidos > 100) {
        controle.close();
        return;
      }
      controle.enqueue(new TextEncoder().encode("123456"));
    },
  });
  const r = await tratarWebhook(
    new Request("https://app.test/api/public/webhooks/teste", {
      method: "POST",
      headers: { "x-assinatura": "00" },
      body: fluxo,
      duplex: "half",
    } as RequestInit),
    "teste",
    deps,
  );
  assert.equal(r.status, 413);
  assert.equal(chamadas.length, 0);
  assert.ok(lidos < 10, `a leitura devia parar logo após estourar o limite (leu ${lidos} blocos)`);
});
