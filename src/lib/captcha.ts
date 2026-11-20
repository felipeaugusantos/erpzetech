// Verificação do CAPTCHA (Cloudflare Turnstile) e origem do envio do formulário de contato.
// Fica à parte da função de servidor para poder ser testado com um fetch de mentira.

import { ipDoCliente } from "./ip-cliente.ts";

export const URL_VERIFICACAO_TURNSTILE =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type MotivoCaptcha = "ausente" | "recusado" | "indisponivel" | "nao_configurado";

export type ResultadoCaptcha = { ok: true } | { ok: false; motivo: MotivoCaptcha };

type Fetch = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * Confere o token do Turnstile com a Cloudflare. Com segredo, token ausente, recusado ou verificação fora do ar
 * bloqueiam o envio. Sem segredo, em produção, o envio também é BLOQUEADO (falha fechada: uma variável esquecida não
 * deixa o formulário aberto a robôs); só `desligado` (TURNSTILE_DESLIGADO=true, decisão explícita) ou o ambiente de
 * desenvolvimento deixam passar sem CAPTCHA.
 */
export async function verificarTurnstile(
  token: string | null | undefined,
  segredo: string | null | undefined,
  ip: string | null,
  buscar: Fetch,
  opcoes: { producao?: boolean; desligado?: boolean } = {},
): Promise<ResultadoCaptcha> {
  if (!segredo) {
    if (opcoes.producao && !opcoes.desligado) return { ok: false, motivo: "nao_configurado" };
    return { ok: true };
  }
  if (!token || !token.trim()) return { ok: false, motivo: "ausente" };
  try {
    const corpo = new URLSearchParams({ secret: segredo, response: token });
    if (ip) corpo.set("remoteip", ip);
    const r = await buscar(URL_VERIFICACAO_TURNSTILE, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: corpo.toString(),
    });
    if (!r.ok) return { ok: false, motivo: "indisponivel" };
    const j = (await r.json()) as { success?: boolean };
    return j.success === true ? { ok: true } : { ok: false, motivo: "recusado" };
  } catch {
    return { ok: false, motivo: "indisponivel" };
  }
}

export const MENSAGEM_CAPTCHA: Record<MotivoCaptcha, string> = {
  nao_configurado:
    "O envio por formulário está temporariamente indisponível. Fale pelo WhatsApp, por favor.",
  ausente: "Confirme que você não é um robô e envie de novo.",
  recusado:
    "Não conseguimos confirmar que você não é um robô. Recarregue a página e tente de novo.",
  indisponivel:
    "Não foi possível verificar agora. Tente de novo em instantes ou fale pelo WhatsApp.",
};

/** IP de quem enviou, como a borda informou: `cf-connecting-ip`, senão o primeiro de `x-forwarded-for`. */
export function ipDoEnvio(cabecalhos: { get(nome: string): string | null }): string | null {
  return ipDoCliente(cabecalhos);
}
