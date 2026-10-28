// Adaptador do Evolution API (WhatsApp autohospedado). Tudo que fala com o servidor Evolution fica neste arquivo: se a versão do
// Evolution mudar um endereço ou um formato, é aqui que se ajusta. Sem dependência de tela nem do banco, para os testes rodarem no Node
// com um servidor falso (o `f` recebido no lugar do fetch).
//
// Endereços (Evolution API v2, cabeçalho "apikey"): POST /instance/create, GET /instance/connect/{i}, GET /instance/connectionState/{i},
// DELETE /instance/logout/{i}, DELETE /instance/delete/{i}, POST /message/sendText/{i}, POST /webhook/set/{i}, GET /instance/fetchInstances.
// Os formatos de resposta e de aviso (webhook) são lidos de forma tolerante: aceitam as variações conhecidas entre as versões 2.x.

export type ConfigEvolution = { url: string; apikey: string };

export type Estado = "conectada" | "desconectada" | "conectando";

export class ErroEvolution extends Error {
  /** código HTTP (0 quando nem chegou ao servidor) */
  status: number;
  /** falha de conexão ou tempo esgotado: vale tentar de novo depois */
  rede: boolean;
  constructor(mensagem: string, status: number, rede = false) {
    super(mensagem);
    this.name = "ErroEvolution";
    this.status = status;
    this.rede = rede;
  }
}

type Fetch = typeof fetch;

/** Nome da instância desta empresa no servidor Evolution: fixo e derivado da empresa (sem consulta). */
export function nomeDaInstancia(tenantId: string) {
  return `zt-${tenantId.replace(/-/g, "").slice(0, 16)}`;
}

const TEMPO_LIMITE_MS = 15_000;

function textoDoErro(corpo: unknown, padrao: string) {
  if (corpo && typeof corpo === "object") {
    const c = corpo as Record<string, unknown>;
    const resp = c["response"] as Record<string, unknown> | undefined;
    const m = resp?.["message"] ?? c["message"] ?? c["error"];
    if (Array.isArray(m)) return m.map(String).join("; ");
    if (typeof m === "string" && m) return m;
  }
  return padrao;
}

async function chamar(
  cfg: ConfigEvolution,
  metodo: "GET" | "POST" | "DELETE",
  caminho: string,
  corpo?: unknown,
  f: Fetch = fetch,
): Promise<unknown> {
  const base = cfg.url.replace(/\/+$/, "");
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resp: Response;
  try {
    resp = await f(`${base}${caminho}`, {
      method: metodo,
      headers: { apikey: cfg.apikey, "Content-Type": "application/json" },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
      signal: controle.signal,
    });
  } catch (e) {
    throw new ErroEvolution(
      `Sem conexão com o servidor do WhatsApp: ${(e as Error).message}`,
      0,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
  const texto = await resp.text();
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) {
    throw new ErroEvolution(
      textoDoErro(json, `O servidor do WhatsApp respondeu ${resp.status}`),
      resp.status,
      resp.status >= 500,
    );
  }
  return json;
}

function mapaEstado(bruto: unknown): Estado {
  const s = String(bruto ?? "").toLowerCase();
  if (s === "open") return "conectada";
  if (s === "connecting") return "conectando";
  return "desconectada";
}

/** Cria a instância da empresa. Se ela já existir, segue sem erro. Devolve o QR code quando o servidor já o traz. */
export async function criarInstancia(cfg: ConfigEvolution, instancia: string, f?: Fetch) {
  try {
    const r = (await chamar(
      cfg,
      "POST",
      "/instance/create",
      { instanceName: instancia, qrcode: true, integration: "WHATSAPP-BAILEYS" },
      f,
    )) as Record<string, unknown> | null;
    const qr = r?.["qrcode"] as Record<string, unknown> | undefined;
    return {
      criada: true,
      qrBase64: typeof qr?.["base64"] === "string" ? (qr["base64"] as string) : null,
    };
  } catch (e) {
    // nome já em uso: a instância existe, o que importa é conectar
    if (
      e instanceof ErroEvolution &&
      (e.status === 403 || e.status === 409) &&
      /already|in use|exist/i.test(e.message)
    ) {
      return { criada: false, qrBase64: null };
    }
    throw e;
  }
}

/** Liga os avisos do servidor (conexão, entrega e respostas) ao endereço do sistema. Tenta o formato aninhado e depois o plano. */
export async function configurarWebhook(
  cfg: ConfigEvolution,
  instancia: string,
  webhook: { url: string; eventos: readonly string[] },
  f?: Fetch,
) {
  const base = {
    url: webhook.url,
    enabled: true,
    webhookByEvents: false,
    webhookBase64: false,
    events: [...webhook.eventos],
  };
  try {
    await chamar(
      cfg,
      "POST",
      `/webhook/set/${encodeURIComponent(instancia)}`,
      { webhook: base },
      f,
    );
  } catch (e) {
    if (e instanceof ErroEvolution && (e.status === 400 || e.status === 422)) {
      await chamar(cfg, "POST", `/webhook/set/${encodeURIComponent(instancia)}`, base, f);
      return;
    }
    throw e;
  }
}

export const EVENTOS_WEBHOOK = [
  "CONNECTION_UPDATE",
  "MESSAGES_UPDATE",
  "MESSAGES_UPSERT",
  "QRCODE_UPDATED",
] as const;

/** Pede o QR code. Se a instância já estiver conectada, devolve o estado sem QR. */
export async function conectar(cfg: ConfigEvolution, instancia: string, f?: Fetch) {
  const r = (await chamar(
    cfg,
    "GET",
    `/instance/connect/${encodeURIComponent(instancia)}`,
    undefined,
    f,
  )) as Record<string, unknown> | null;
  const inst = r?.["instance"] as Record<string, unknown> | undefined;
  const base64 = typeof r?.["base64"] === "string" ? (r["base64"] as string) : null;
  const pareamento = typeof r?.["pairingCode"] === "string" ? (r["pairingCode"] as string) : null;
  return {
    qrBase64: base64,
    codigoPareamento: pareamento,
    estado: inst?.["state"] !== undefined ? mapaEstado(inst["state"]) : null,
  };
}

export async function estadoConexao(
  cfg: ConfigEvolution,
  instancia: string,
  f?: Fetch,
): Promise<Estado> {
  const r = (await chamar(
    cfg,
    "GET",
    `/instance/connectionState/${encodeURIComponent(instancia)}`,
    undefined,
    f,
  )) as Record<string, unknown> | null;
  const inst = (r?.["instance"] as Record<string, unknown> | undefined) ?? r ?? {};
  return mapaEstado(inst["state"]);
}

/** Número conectado (só dígitos), quando o servidor informa. */
export async function numeroConectado(
  cfg: ConfigEvolution,
  instancia: string,
  f?: Fetch,
): Promise<string | null> {
  const r = await chamar(
    cfg,
    "GET",
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`,
    undefined,
    f,
  );
  const lista = Array.isArray(r) ? r : [r];
  const item = (lista[0] ?? {}) as Record<string, unknown>;
  const inst = (item["instance"] as Record<string, unknown> | undefined) ?? item;
  const dono = inst["ownerJid"] ?? inst["owner"] ?? inst["number"] ?? inst["wuid"];
  return typeof dono === "string"
    ? (numeroDoJid(dono) ?? (/^\d{10,15}$/.test(dono) ? dono : null))
    : null;
}

export async function desconectar(cfg: ConfigEvolution, instancia: string, f?: Fetch) {
  await chamar(cfg, "DELETE", `/instance/logout/${encodeURIComponent(instancia)}`, undefined, f);
}

export async function excluirInstancia(cfg: ConfigEvolution, instancia: string, f?: Fetch) {
  await chamar(cfg, "DELETE", `/instance/delete/${encodeURIComponent(instancia)}`, undefined, f);
}

/** Envia um texto. `numero` com DDI (ex.: 5511999990000). `atrasoMs` é o tempo de "digitando…" antes de enviar. */
export async function enviarTexto(
  cfg: ConfigEvolution,
  instancia: string,
  numero: string,
  texto: string,
  atrasoMs = 0,
  f?: Fetch,
) {
  const r = (await chamar(
    cfg,
    "POST",
    `/message/sendText/${encodeURIComponent(instancia)}`,
    { number: numero, text: texto, delay: Math.max(0, Math.round(atrasoMs)), linkPreview: false },
    f,
  )) as Record<string, unknown> | null;
  const key = (r?.["key"] as Record<string, unknown> | undefined) ?? {};
  const id = key["id"];
  if (typeof id !== "string" || !id)
    throw new ErroEvolution("O servidor do WhatsApp não confirmou o envio", 200);
  return {
    idMensagem: id,
    jid: typeof key["remoteJid"] === "string" ? (key["remoteJid"] as string) : null,
  };
}

// ============ avisos que o servidor manda ao sistema (webhook) ============

/** Só os dígitos do número quando o endereço é de telefone. Endereços "@lid" não revelam o número e devolvem null. */
export function numeroDoJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const m = /^(\d{8,15})(?::\d+)?@(s\.whatsapp\.net|c\.us)$/.exec(jid);
  return m?.[1] ?? null;
}

export type EventoWhatsApp =
  | { tipo: "conexao"; instancia: string; estado: Estado; numero: string | null }
  | {
      tipo: "status";
      instancia: string;
      idMensagem: string;
      status: "enviada" | "entregue" | "lida";
    }
  | { tipo: "entrada"; instancia: string; jid: string; numero: string | null; texto: string }
  | { tipo: "ignorar" };

function statusDaMensagem(bruto: unknown): "enviada" | "entregue" | "lida" | null {
  if (typeof bruto === "number")
    return bruto >= 4 ? "lida" : bruto === 3 ? "entregue" : bruto === 2 ? "enviada" : null;
  const s = String(bruto ?? "").toUpperCase();
  if (s === "READ" || s === "PLAYED" || s === "READ_ACK") return "lida";
  if (s === "DELIVERY_ACK" || s === "DELIVERED") return "entregue";
  if (s === "SERVER_ACK" || s === "SENT") return "enviada";
  return null;
}

function textoDaMensagem(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const m = msg as Record<string, unknown>;
  if (typeof m["conversation"] === "string") return m["conversation"] as string;
  const ext = m["extendedTextMessage"] as Record<string, unknown> | undefined;
  return typeof ext?.["text"] === "string" ? (ext["text"] as string) : "";
}

/** Lê o corpo de um aviso do servidor Evolution. Qualquer formato desconhecido vira "ignorar" (nunca erro). */
export function interpretarEvento(corpo: unknown): EventoWhatsApp {
  if (!corpo || typeof corpo !== "object") return { tipo: "ignorar" };
  const c = corpo as Record<string, unknown>;
  const evento = String(c["event"] ?? "")
    .toLowerCase()
    .replace(/_/g, ".");
  const instancia = typeof c["instance"] === "string" ? (c["instance"] as string) : "";
  const dados = (Array.isArray(c["data"]) ? (c["data"] as unknown[])[0] : c["data"]) as
    Record<string, unknown> | undefined;
  if (!instancia || !dados || typeof dados !== "object") return { tipo: "ignorar" };

  if (evento === "connection.update") {
    const estado = mapaEstado(dados["state"]);
    const dono = dados["wuid"] ?? dados["ownerJid"];
    return {
      tipo: "conexao",
      instancia,
      estado,
      numero: typeof dono === "string" ? numeroDoJid(dono) : null,
    };
  }
  if (evento === "messages.update") {
    const key = dados["key"] as Record<string, unknown> | undefined;
    const id = dados["keyId"] ?? dados["messageId"] ?? key?.["id"];
    const upd = dados["update"] as Record<string, unknown> | undefined;
    const status = statusDaMensagem(dados["status"] ?? upd?.["status"]);
    if (typeof id !== "string" || !id || !status) return { tipo: "ignorar" };
    return { tipo: "status", instancia, idMensagem: id, status };
  }
  if (evento === "messages.upsert") {
    const key = dados["key"] as Record<string, unknown> | undefined;
    if (!key || key["fromMe"] === true) return { tipo: "ignorar" };
    const jid = typeof key["remoteJid"] === "string" ? (key["remoteJid"] as string) : "";
    if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return { tipo: "ignorar" };
    const texto = textoDaMensagem(dados["message"]).trim();
    if (!texto) return { tipo: "ignorar" };
    // alguns servidores trazem o número real quando o endereço é "@lid"
    const alt = typeof key["remoteJidAlt"] === "string" ? (key["remoteJidAlt"] as string) : null;
    return { tipo: "entrada", instancia, jid, numero: numeroDoJid(jid) ?? numeroDoJid(alt), texto };
  }
  return { tipo: "ignorar" };
}

/** O cliente pediu para parar de receber? Só reconhece mensagens curtas e claras, para não tratar conversa como pedido. */
export function ehPedidoDeSaida(texto: string): boolean {
  const t = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 30) return false;
  return /^(sair|parar|pare|stop|descadastrar|cancelar|remover|nao quero (mais )?receber)( |$)/.test(
    t,
  );
}
