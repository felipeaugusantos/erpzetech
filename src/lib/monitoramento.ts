// Monitoramento de erros: lógica pura (limpeza de dados pessoais, filtro de ruído, impressão digital e limite de envio).
// O texto de um erro pode carregar dado pessoal (e-mail do usuário, CPF numa URL, token). Tudo passa por limparTexto ANTES de
// sair do navegador e de novo no servidor, que nunca confia no que recebe.

export const LIMITE_MENSAGEM = 500;
export const LIMITE_STACK = 4000;
export const LIMITE_ROTA = 200;
export const LIMITE_CORPO = 16_000;

export type Relato = {
  origem: "navegador" | "servidor";
  mensagem: string;
  stack: string | null;
  rota: string | null;
  navegador: string | null;
};

/** Troca por marcadores tudo que pode identificar uma pessoa ou dar acesso: e-mail, token, documento, telefone, query e fragmento de URL. */
export function limparTexto(texto: string): string {
  return texto
    .replace(/eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g, "[token]")
    .replace(/\bBearer\s+[\w.~+/=-]+/gi, "Bearer [token]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/((?:https?|wss?):\/\/[^\s?#"'`)<>]+|\/[\w./%-]*)[?#][^\s"'`)<>]*/g, "$1")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[documento]")
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "[documento]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/(?<![\w.-])\d{11}(?:\d{3})?(?![\w.-])/g, "[documento]")
    .replace(/(?<![\w.-])\+?\d[\d\s().-]{7,}\d(?![\w.-])/g, "[numero]")
    .replace(/(?<![\w./-])[A-Za-z0-9_-]{32,}(?![\w./-])/g, "[token]");
}

/** Só o caminho da página: sem query nem fragmento (o código de convite do portal vai no fragmento), sem ids. */
export function limparRota(rota: string | null | undefined): string | null {
  if (!rota) return null;
  const semResto = String(rota).split(/[?#]/)[0] ?? "";
  const limpa = limparTexto(semResto).slice(0, LIMITE_ROTA);
  return limpa || null;
}

/** Ruído que não é defeito do sistema: não vale registrar. */
export function ehRuido(mensagem: string, stack?: string | null, online = true): boolean {
  const m = mensagem.trim();
  if (!m) return true;
  if (/ResizeObserver loop/i.test(m)) return true;
  if (/^Script error\.?$/i.test(m)) return true;
  if (/AbortError|The operation was aborted|aborted a request/i.test(m)) return true;
  // aba aberta antes de publicar: o sistema recarrega sozinho
  if (
    /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError/i.test(
      m,
    )
  )
    return true;
  if (/(?:chrome|moz|safari)-extension:\/\//i.test(`${m}\n${stack ?? ""}`)) return true;
  // sem internet o navegador falha todo pedido; o sistema já trata isso (fila local)
  if (
    !online &&
    /Failed to fetch|Load failed|NetworkError|Network request failed|fetch failed/i.test(m)
  )
    return true;
  return false;
}

/** Texto estável do erro: sem números, ids nem nomes de arquivo com hash, para o mesmo defeito cair sempre no mesmo grupo. */
export function textoDaImpressao(r: Pick<Relato, "origem" | "mensagem" | "stack">): string {
  const norm = (s: string) =>
    s
      .replace(/-[A-Za-z0-9_-]{6,12}\.(js|mjs|css)/g, ".$1")
      .replace(/:\d+:\d+/g, "")
      .replace(/\d+/g, "#");
  const frames = (r.stack ?? "")
    .split("\n")
    .filter((l) => /^\s*at\s|@/.test(l))
    .slice(0, 3)
    .map((l) => norm(l.trim()));
  return [r.origem, norm(r.mensagem.split("\n")[0] ?? ""), ...frames].join("|");
}

/** SHA-256 em hexadecimal (WebCrypto: existe no navegador e no servidor). */
export async function impressaoDoErro(
  r: Pick<Relato, "origem" | "mensagem" | "stack">,
): Promise<string> {
  const dados = new TextEncoder().encode(textoDaImpressao(r));
  const hash = await crypto.subtle.digest("SHA-256", dados);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function textoDoErro(error: unknown): { mensagem: string; stack: string | null } {
  if (typeof Response !== "undefined" && error instanceof Response) {
    return { mensagem: `Response ${error.status}`, stack: null };
  }
  if (error instanceof Error) {
    return { mensagem: `${error.name}: ${error.message}`, stack: error.stack ?? null };
  }
  if (typeof error === "string") return { mensagem: error, stack: null };
  try {
    return { mensagem: JSON.stringify(error) ?? String(error), stack: null };
  } catch {
    return { mensagem: String(error), stack: null };
  }
}

/** Monta o relato já limpo e cortado nos limites. */
export function montarRelato(
  error: unknown,
  extra: { origem: Relato["origem"]; rota?: string | null; navegador?: string | null },
): Relato {
  const { mensagem, stack } = textoDoErro(error);
  return {
    origem: extra.origem,
    mensagem: limparTexto(mensagem).slice(0, LIMITE_MENSAGEM),
    stack: stack ? limparTexto(stack).slice(0, LIMITE_STACK) : null,
    rota: limparRota(extra.rota),
    navegador: extra.navegador ? limparTexto(extra.navegador).slice(0, 200) : null,
  };
}

/** Valida e limpa o corpo recebido do navegador. Devolve nulo para qualquer coisa fora do formato. */
export function lerCorpoDoNavegador(corpo: unknown): Relato | null {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return null;
  const c = corpo as Record<string, unknown>;
  if (typeof c["mensagem"] !== "string" || !c["mensagem"].trim()) return null;
  const texto = (v: unknown) => (typeof v === "string" ? v : null);
  const stack = texto(c["stack"]);
  const navegador = texto(c["navegador"]);
  return {
    origem: "navegador",
    mensagem: limparTexto(c["mensagem"]).slice(0, LIMITE_MENSAGEM),
    stack: stack ? limparTexto(stack).slice(0, LIMITE_STACK) : null,
    rota: limparRota(texto(c["rota"])),
    navegador: navegador ? limparTexto(navegador).slice(0, 200) : null,
  };
}

/** Limite simples por chave (ex.: IP): no máximo `max` envios por janela. */
export function criarLimitador(max: number, janelaMs: number) {
  const marcas = new Map<string, number[]>();
  return (chave: string, agora = Date.now()): boolean => {
    const recentes = (marcas.get(chave) ?? []).filter((t) => agora - t < janelaMs);
    if (recentes.length >= max) {
      marcas.set(chave, recentes);
      return false;
    }
    recentes.push(agora);
    marcas.set(chave, recentes);
    // não deixa o mapa crescer sem fim
    if (marcas.size > 5000) {
      for (const k of marcas.keys()) {
        marcas.delete(k);
        if (marcas.size <= 2500) break;
      }
    }
    return true;
  };
}
