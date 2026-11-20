// IP do cliente para limites de uso e anti-spam. Os cabeçalhos de IP só valem se vierem de um proxy nosso: o cliente pode
// mandar qualquer valor neles. Por isso:
//  - `x-forwarded-for` é lido pelo ÚLTIMO item (o que o nosso proxy acrescentou), nunca pelo primeiro (que o cliente escreve);
//  - `cf-connecting-ip` só vale atrás da Cloudflare (que sobrescreve o cabeçalho). Fora dela, defina IP_ORIGEM=proxy.
// IP_ORIGEM: "cloudflare" (padrão: cf-connecting-ip, senão o último do x-forwarded-for), "proxy" (só o último do
// x-forwarded-for, para nginx na VPS sem Cloudflare) ou "nenhum" (não confia em cabeçalho algum).

type Cabecalhos = { get(nome: string): string | null };

export type OrigemDoIp = "cloudflare" | "proxy" | "nenhum";

export function origemDoIpConfigurada(valor = process.env["IP_ORIGEM"]): OrigemDoIp {
  const v = (valor ?? "").trim().toLowerCase();
  return v === "proxy" || v === "nenhum" ? v : "cloudflare";
}

export function ipDoCliente(
  cabecalhos: Cabecalhos,
  origem: OrigemDoIp = origemDoIpConfigurada(),
): string | null {
  if (origem === "nenhum") return null;
  if (origem === "cloudflare") {
    const cf = cabecalhos.get("cf-connecting-ip")?.trim();
    if (cf) return cf;
  }
  const itens = (cabecalhos.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return itens.length > 0 ? itens[itens.length - 1]! : null;
}
