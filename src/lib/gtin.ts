// Código de barras (GTIN/EAN) e leitura da resposta do Cosmos (Bluesoft).
export const somenteDigitos = (v: string) => (v ?? "").replace(/\D/g, "");

/** GTIN-8, 12, 13 ou 14 com dígito verificador correto. */
export function gtinValido(codigo: string): boolean {
  const d = somenteDigitos(codigo);
  if (![8, 12, 13, 14].includes(d.length) || d !== codigo.trim()) return false;
  let soma = 0;
  for (let i = 0; i < d.length - 1; i++) {
    const n = Number(d[d.length - 2 - i]);
    soma += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (soma % 10)) % 10 === Number(d[d.length - 1]);
}

export type ProdutoGtin = { descricao: string; marca: string; ncm: string };

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Extrai nome, marca e NCM da resposta do Cosmos; devolve null se não houver descrição. */
export function interpretarCosmos(json: unknown): ProdutoGtin | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const descricao = texto(j["description"]);
  if (!descricao) return null;
  const marca =
    j["brand"] && typeof j["brand"] === "object" ? (j["brand"] as { name?: unknown }) : null;
  const ncm = j["ncm"] && typeof j["ncm"] === "object" ? (j["ncm"] as { code?: unknown }) : null;
  return {
    descricao,
    marca: texto(marca?.name),
    ncm: somenteDigitos(String(ncm?.code ?? "")),
  };
}
