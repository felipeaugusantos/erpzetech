/**
 * Webhooks de entrada: verificação de assinatura, idempotência e despacho para o provedor.
 * Sem dependências do app, para poder ser testado sem banco (ver tests/webhook.test.ts).
 * A ligação com o Supabase fica em webhook.server.ts.
 */

export type FormatoAssinatura = "hex" | "base64";

export type ConfigAssinatura = {
  segredo: string;
  /** Algoritmo do HMAC. Padrão: SHA-256. */
  algoritmo?: "SHA-256" | "SHA-1";
  /** Como a assinatura vem codificada no cabeçalho. Padrão: hex. */
  formato?: FormatoAssinatura;
  /** Prefixo a remover do cabeçalho antes de comparar (ex.: "sha256="). */
  prefixo?: string;
};

const encoder = new TextEncoder();

function paraHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function paraBase64(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

export async function calcularHmac(
  segredo: string,
  corpo: string,
  algoritmo: "SHA-256" | "SHA-1" = "SHA-256",
  formato: FormatoAssinatura = "hex",
): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw",
    encoder.encode(segredo),
    { name: "HMAC", hash: algoritmo },
    false,
    ["sign"],
  );
  const assinatura = new Uint8Array(await crypto.subtle.sign("HMAC", chave, encoder.encode(corpo)));
  return formato === "hex" ? paraHex(assinatura) : paraBase64(assinatura);
}

/** Comparação em tempo constante (não vaza em qual posição as strings diferem). */
export function compararSeguro(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diferenca = 0;
  for (let i = 0; i < x.length; i++) diferenca |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diferenca === 0;
}

/**
 * Confere a assinatura HMAC de `corpo` (o texto exato que o provedor assinou; se ele assina
 * "timestamp.corpo", monte essa string antes de chamar).
 */
export async function verificarAssinatura(
  corpo: string,
  assinatura: string | null | undefined,
  config: ConfigAssinatura,
): Promise<boolean> {
  if (!config.segredo || !assinatura) return false;
  let recebida = assinatura.trim();
  if (config.prefixo) {
    if (!recebida.startsWith(config.prefixo)) return false;
    recebida = recebida.slice(config.prefixo.length);
  }
  const formato = config.formato ?? "hex";
  const esperada = await calcularHmac(
    config.segredo,
    corpo,
    config.algoritmo ?? "SHA-256",
    formato,
  );
  // hex não diferencia maiúsculas de minúsculas; base64 diferencia
  return compararSeguro(esperada, formato === "hex" ? recebida.toLowerCase() : recebida);
}

/** Protege contra repetição de requisições antigas (replay). Timestamp em segundos. */
export function timestampValido(
  timestampSegundos: number,
  agoraMs: number = Date.now(),
  toleranciaSegundos = 300,
): boolean {
  if (!Number.isFinite(timestampSegundos)) return false;
  return Math.abs(agoraMs / 1000 - timestampSegundos) <= toleranciaSegundos;
}

// ---------------------------------------------------------------------------------------------

export type EventoWebhook = {
  provedor: string;
  id: string;
  tenantId: string | null;
  payload: unknown;
};

export type ProvedorWebhook = {
  nome: string;
  /** Lê o segredo compartilhado (variável de ambiente). Sem segredo, o provedor fica desativado. */
  segredo: () => string | undefined;
  cabecalhoAssinatura: string;
  assinatura?: Omit<ConfigAssinatura, "segredo">;
  /** Texto assinado pelo provedor. Padrão: o corpo bruto da requisição. */
  textoAssinado?: (corpo: string, headers: Headers) => string;
  /** Extrai o id único do evento (e, se houver, o tenant) do payload. null = payload inválido. */
  extrair: (payload: unknown, headers: Headers) => { id: string; tenantId?: string | null } | null;
  processar: (evento: EventoWebhook) => Promise<"processado" | "ignorado">;
};

export type DepsWebhook = {
  provedores: Record<string, ProvedorWebhook>;
  registrar: (p: {
    provedor: string;
    eventId: string;
    tenantId: string | null;
    payload: unknown;
  }) => Promise<"novo" | "reprocessar" | "duplicado">;
  concluir: (p: {
    provedor: string;
    eventId: string;
    status: "processado" | "ignorado" | "erro";
    erro?: string;
  }) => Promise<void>;
  /** Tamanho máximo do corpo em bytes. Padrão: 1 MiB. */
  maxBytes?: number;
};

function resposta(status: number, corpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function tratarWebhook(
  request: Request,
  nomeProvedor: string,
  deps: DepsWebhook,
): Promise<Response> {
  if (request.method !== "POST") return resposta(405, { erro: "Método não permitido" });

  const provedor = Object.hasOwn(deps.provedores, nomeProvedor)
    ? deps.provedores[nomeProvedor]
    : undefined;
  if (!provedor) return resposta(404, { erro: "Provedor desconhecido" });

  const segredo = provedor.segredo();
  if (!segredo) {
    console.error(`[webhook] segredo do provedor "${provedor.nome}" não configurado`);
    return resposta(500, { erro: "Provedor não configurado" });
  }

  const maxBytes = deps.maxBytes ?? 1024 * 1024;
  const declarado = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declarado) && declarado > maxBytes) {
    return resposta(413, { erro: "Corpo grande demais" });
  }
  const corpo = await request.text();
  if (encoder.encode(corpo).length > maxBytes)
    return resposta(413, { erro: "Corpo grande demais" });

  const assinado = provedor.textoAssinado ? provedor.textoAssinado(corpo, request.headers) : corpo;
  const valida = await verificarAssinatura(
    assinado,
    request.headers.get(provedor.cabecalhoAssinatura),
    { segredo, ...provedor.assinatura },
  );
  if (!valida) return resposta(401, { erro: "Assinatura inválida" });

  let payload: unknown;
  try {
    payload = JSON.parse(corpo);
  } catch {
    return resposta(400, { erro: "JSON inválido" });
  }

  const extraido = provedor.extrair(payload, request.headers);
  if (!extraido || !extraido.id) return resposta(400, { erro: "Evento sem identificador" });
  const tenantId = extraido.tenantId ?? null;

  const registro = await deps.registrar({
    provedor: provedor.nome,
    eventId: extraido.id,
    tenantId,
    payload,
  });
  if (registro === "duplicado") return resposta(200, { status: "duplicado" });

  try {
    const resultado = await provedor.processar({
      provedor: provedor.nome,
      id: extraido.id,
      tenantId,
      payload,
    });
    await deps.concluir({ provedor: provedor.nome, eventId: extraido.id, status: resultado });
    return resposta(200, { status: resultado });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    console.error(`[webhook] erro ao processar ${provedor.nome}/${extraido.id}: ${mensagem}`);
    await deps.concluir({
      provedor: provedor.nome,
      eventId: extraido.id,
      status: "erro",
      erro: mensagem,
    });
    // 500 faz o provedor tentar de novo; o registro permite reprocessar.
    return resposta(500, { erro: "Falha ao processar" });
  }
}
