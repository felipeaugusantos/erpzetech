/**
 * Integração com a API fiscal ACBr (https://dev.acbr.api.br/docs/api/).
 * Autenticação OAuth 2.0 client_credentials; ambientes homologação e produção.
 */

const AUTH_URL = "https://auth.acbr.api.br/realms/ACBrAPI/protocol/openid-connect/token";

export type Ambiente = "homologacao" | "producao";

/**
 * O token emitido para a conta tem audiência do host de produção; o ambiente de
 * homologação é escolhido pelo campo tpAmb de cada nota, não por outro host.
 */
export function baseUrl(_ambiente: Ambiente): string {
  return "https://prod.acbr.api.br";
}

let cache: { token: string; expira: number } | null = null;

export async function acbrToken(): Promise<string> {
  const agora = Date.now();
  if (cache && agora < cache.expira - 30_000) return cache.token;

  const clientId = process.env["ACBR_CLIENT_ID"];
  const clientSecret = process.env["ACBR_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error(
      "Credenciais do emissor fiscal ausentes. Cadastre ACBR_CLIENT_ID e ACBR_CLIENT_SECRET.",
    );
  }

  const corpo = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "empresa nfe",
  });

  const resposta = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo.toString(),
  });
  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`Falha na autenticação com o emissor fiscal (${resposta.status}): ${texto}`);
  }
  const json = JSON.parse(texto) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("O emissor fiscal não devolveu o token de acesso.");

  cache = { token: json.access_token, expira: agora + (json.expires_in ?? 300) * 1000 };
  return json.access_token;
}

export async function acbr<T = unknown>(
  ambiente: Ambiente,
  caminho: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const token = await acbrToken();
  const resposta = await fetch(`${baseUrl(ambiente)}${caminho}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const texto = await resposta.text();
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = { mensagem: texto };
  }
  if (!resposta.ok) {
    const erro = new Error(mensagemDeErro(json, resposta.status));
    (erro as Error & { detalhe?: unknown }).detalhe = json;
    throw erro;
  }
  return json as T;
}

export function mensagemDeErro(json: unknown, status?: number): string {
  const obj = (json ?? {}) as Record<string, unknown>;
  const partes: string[] = [];
  for (const chave of ["mensagem", "message", "detail", "erro", "error_description", "title"]) {
    const valor = obj[chave];
    if (typeof valor === "string" && valor) partes.push(valor);
  }
  const lista = obj["erros"] ?? obj["errors"];
  if (Array.isArray(lista)) {
    for (const item of lista) {
      if (typeof item === "string") partes.push(item);
      else if (item && typeof item === "object") {
        const m =
          (item as Record<string, unknown>)["mensagem"] ??
          (item as Record<string, unknown>)["message"];
        if (typeof m === "string") partes.push(m);
      }
    }
  }
  if (partes.length === 0)
    partes.push(`O emissor fiscal recusou a requisição${status ? ` (${status})` : ""}.`);
  return partes.join(" · ").slice(0, 900);
}

/** Código IBGE do município a partir do CEP (usado quando o cadastro não tem o código). */
export async function codigoMunicipioPorCep(
  ambiente: Ambiente,
  cep: string,
): Promise<{ codigo: string; municipio: string; uf: string } | null> {
  const limpo = (cep ?? "").replace(/\D/g, "");
  if (limpo.length !== 8) return null;
  try {
    const resposta = await acbr<{ codigo_ibge?: string | number; municipio?: string; uf?: string }>(
      ambiente,
      `/cep/${limpo}`,
    );
    if (!resposta?.codigo_ibge) return null;
    return {
      codigo: String(resposta.codigo_ibge),
      municipio: String(resposta.municipio ?? ""),
      uf: String(resposta.uf ?? ""),
    };
  } catch {
    return null;
  }
}

export const CODIGO_UF: Record<string, number> = {
  AC: 12,
  AL: 27,
  AP: 16,
  AM: 13,
  BA: 29,
  CE: 23,
  DF: 53,
  ES: 32,
  GO: 52,
  MA: 21,
  MT: 51,
  MS: 50,
  MG: 31,
  PA: 15,
  PB: 25,
  PR: 41,
  PE: 26,
  PI: 22,
  RJ: 33,
  RN: 24,
  RS: 43,
  RO: 11,
  RR: 14,
  SC: 42,
  SP: 35,
  SE: 28,
  TO: 17,
};

export function so(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

export function num(valor: unknown, casas = 2): number {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(casas));
}
