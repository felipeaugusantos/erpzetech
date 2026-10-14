// Leitura de código de barras nos itens do pedido: separação, conferência, saída e inclusão de produtos.
// "3*7891234567895" lê 3 unidades; sem multiplicador vale 1 por leitura.
import { interpretarBusca } from "./busca-pdv.ts";

export type ProdutoLeitura = { codigo_barras?: string | null; codigo_interno?: string | null };

const soDigitos = (v: string) => v.replace(/\D/g, "");

const TAMANHOS_GTIN = [8, 12, 13, 14];

/**
 * O mesmo produto lido como EAN-13 ou GTIN-14 só difere pelos zeros à esquerda. Essa equivalência vale só
 * entre códigos numéricos de tamanho GTIN; códigos internos (123 e 00123 podem ser produtos diferentes)
 * casam apenas quando são iguais.
 */
export function mesmoCodigo(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  if (!x || !y) return false;
  if (x.toLowerCase() === y.toLowerCase()) return true;
  const gtin = (v: string) => v === soDigitos(v) && TAMANHOS_GTIN.includes(v.length);
  return gtin(x) && gtin(y) && x.padStart(14, "0") === y.padStart(14, "0");
}

/** Produto cujo código de barras ou código interno é o texto lido. */
export function acharProdutoPorCodigo<T extends ProdutoLeitura>(
  produtos: T[],
  termo: string,
): T | null {
  const t = termo.trim();
  if (!t) return null;
  return (
    produtos.find((p) => mesmoCodigo(p.codigo_barras, t)) ??
    produtos.find((p) => mesmoCodigo(p.codigo_interno, t)) ??
    null
  );
}

/** Quantidade e código de uma leitura; null se o texto está vazio ou a quantidade não vale. */
export function lerCodigo(texto: string): { quantidade: number; termo: string } | null {
  const b = interpretarBusca(texto);
  if (!b.termo) return null;
  const quantidade = b.quantidade ?? 1;
  if (!(quantidade > 0)) return null;
  return { quantidade, termo: b.termo };
}

export type ItemLeitura = { id: string; produtos?: ProdutoLeitura | null };

export type ResultadoLeitura =
  | {
      tipo: "ok";
      /** Novo valor de cada item que mudou (o contado depois da leitura). */
      alteracoes: Record<string, number>;
      quantidade: number;
      itemId: string;
    }
  | { tipo: "vazio" }
  | { tipo: "desconhecido"; termo: string }
  | { tipo: "completo"; itemId: string }
  | { tipo: "excede"; itemId: string; restante: number };

const arred = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Soma a leitura ao que já foi contado. `contados` e `limites` são por item do pedido; o limite é o que
 * a etapa aceita (quantidade pedida, ou o saldo livre para sair). Se o produto está em mais de uma linha
 * do pedido, a leitura preenche uma linha e passa para a próxima. Nada é alterado quando passa do limite.
 */
export function aplicarLeitura(
  itens: ItemLeitura[],
  contados: Record<string, number>,
  limites: Record<string, number>,
  texto: string,
): ResultadoLeitura {
  const leitura = lerCodigo(texto);
  if (!leitura) return { tipo: "vazio" };
  const alvo = acharProdutoPorCodigo(
    itens.map((i) => ({ ...(i.produtos ?? {}), id: i.id })),
    leitura.termo,
  );
  if (!alvo) return { tipo: "desconhecido", termo: leitura.termo };

  const linhas = itens.filter((i) => {
    const p = i.produtos;
    return (
      !!p &&
      (mesmoCodigo(p.codigo_barras, leitura.termo) || mesmoCodigo(p.codigo_interno, leitura.termo))
    );
  });
  const sobra = (i: ItemLeitura) =>
    arred(Math.max((limites[i.id] ?? 0) - (contados[i.id] ?? 0), 0));
  const livre = arred(linhas.reduce((s, i) => s + sobra(i), 0));
  if (livre <= 0) return { tipo: "completo", itemId: linhas[0]!.id };
  if (leitura.quantidade > livre + 1e-9)
    return { tipo: "excede", itemId: linhas[0]!.id, restante: livre };

  const alteracoes: Record<string, number> = {};
  let falta = leitura.quantidade;
  for (const i of linhas) {
    if (falta <= 0) break;
    const cabe = Math.min(sobra(i), falta);
    if (cabe <= 0) continue;
    alteracoes[i.id] = arred((contados[i.id] ?? 0) + cabe);
    falta = arred(falta - cabe);
  }
  return {
    tipo: "ok",
    alteracoes,
    quantidade: leitura.quantidade,
    itemId: Object.keys(alteracoes)[0]!,
  };
}

/** Texto para o operador ver na tela depois de cada leitura. */
export function mensagemLeitura(
  r: ResultadoLeitura,
  nomeDe: (itemId: string) => string,
): { ok: boolean; texto: string } {
  switch (r.tipo) {
    case "ok":
      return { ok: true, texto: `${r.quantidade} × ${nomeDe(r.itemId)}` };
    case "vazio":
      return { ok: false, texto: "" };
    case "desconhecido":
      return { ok: false, texto: `Código ${r.termo} não está neste pedido` };
    case "completo":
      return { ok: false, texto: `${nomeDe(r.itemId)}: quantidade já completa` };
    case "excede":
      return { ok: false, texto: `${nomeDe(r.itemId)}: só faltam ${r.restante}` };
  }
}
