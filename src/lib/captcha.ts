// Verificação do CAPTCHA (Cloudflare Turnstile) e origem do envio do formulário de contato.
// Fica à parte da função de servidor para poder ser testado com um fetch de mentira.

export const URL_VERIFICACAO_TURNSTILE =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type ResultadoCaptcha =
  { ok: true } | { ok: false; motivo: "ausente" | "recusado" | "indisponivel" };

type Fetch = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * Confere o token do Turnstile com a Cloudflare. Sem segredo configurado o CAPTCHA fica desligado (a tela também
 * não mostra o desafio); com segredo, token ausente, recusado ou verificação fora do ar bloqueiam o envio.
 */
export async function verificarTurnstile(
  token: string | null | undefined,
  segredo: string | null | undefined,
  ip: string | null,
  buscar: Fetch,
): Promise<ResultadoCaptcha> {
  if (!segredo) return { ok: true };
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

export const MENSAGEM_CAPTCHA: Record<"ausente" | "recusado" | "indisponivel", string> = {
  ausente: "Confirme que você não é um robô e envie de novo.",
  recusado:
    "Não conseguimos confirmar que você não é um robô. Recarregue a página e tente de novo.",
  indisponivel:
    "Não foi possível verificar agora. Tente de novo em instantes ou fale pelo WhatsApp.",
};

/** IP de quem enviou, como a borda informou: `cf-connecting-ip`, senão o primeiro de `x-forwarded-for`. */
export function ipDoEnvio(cabecalhos: { get(nome: string): string | null }): string | null {
  const cf = cabecalhos.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const primeiro = cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim();
  return primeiro || null;
}
