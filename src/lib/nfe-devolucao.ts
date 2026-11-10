// Nota de devolução de venda (NF-e de entrada, finNFe 4): regras puras, sem rede nem banco.
// A nota nasce em `devolucao_registrar` (modo "nota") como rascunho de entrada, CFOP 1202. Aqui ficam as
// regras de como ela é montada na transmissão: finalidade, tipo de operação, CFOP por destino e referência
// à nota de venda original.

/** Dígito verificador da chave de acesso (módulo 11, pesos 2 a 9 da direita para a esquerda). */
export function dvChaveAcesso(base43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = base43.length - 1; i >= 0; i--) {
    soma += Number(base43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function chaveAcessoValida(chave: unknown): boolean {
  const c = String(chave ?? "");
  return /^\d{44}$/.test(c) && dvChaveAcesso(c.slice(0, 43)) === Number(c[43]);
}

/** CFOPs de venda com substituição tributária: a devolução usa 1.411 / 2.411. */
const CFOPS_VENDA_ST = ["5401", "5403", "5405", "6401", "6403", "6404"];

/**
 * CFOP da devolução de venda, de acordo com o destino da operação: 1.202 (dentro do estado) ou 2.202
 * (outro estado); venda com ST devolve em 1.411 / 2.411. O CFOP que está no item é o da venda ou o do
 * rascunho: a devolução sempre recalcula, para não sair 1.202 em operação interestadual.
 */
export function cfopDevolucaoVenda(cfopOriginal: unknown, interestadual: boolean): string {
  const cfop = String(cfopOriginal ?? "").replace(/\D/g, "");
  const st = CFOPS_VENDA_ST.includes(cfop) || cfop === "1411" || cfop === "2411";
  const prefixo = interestadual ? "2" : "1";
  return `${prefixo}${st ? "411" : "202"}`;
}

/** CFOPs de entrada (da compra) com substituição tributária: a devolução ao fornecedor usa 5.411 / 6.411. */
const CFOPS_COMPRA_ST = ["1401", "1403", "2401", "2403"];

/**
 * CFOP da devolução de compra (saída ao fornecedor): 5.202 (dentro do estado) ou 6.202 (outro estado); compra com
 * ST devolve em 5.411 / 6.411. O CFOP do item é o da entrada original (ou o do rascunho): recalcula sempre.
 */
export function cfopDevolucaoCompra(cfopOriginal: unknown, interestadual: boolean): string {
  const cfop = String(cfopOriginal ?? "").replace(/\D/g, "");
  const st = CFOPS_COMPRA_ST.includes(cfop) || cfop === "5411" || cfop === "6411";
  return `${interestadual ? "6" : "5"}${st ? "411" : "202"}`;
}

/** Chave da NF-e de entrada que a devolução de compra referencia; sem chave válida não há como referenciar. */
export function chaveDaCompra(chave: unknown): string {
  const c = String(chave ?? "").trim();
  if (!chaveAcessoValida(c)) {
    throw new Error(
      "A compra não tem a chave de acesso da NF-e de entrada (ou ela é inválida): a nota de devolução precisa referenciá-la.",
    );
  }
  return c;
}

export type NotaDeVenda = {
  id: string;
  chave: string | null;
  situacao: string;
  modelo?: string | null;
};

/**
 * Notas de venda que a devolução referencia: só as autorizadas, com chave válida, sem repetir e sem a
 * própria nota de devolução. Sem nenhuma, não há como referenciar e a transmissão é recusada.
 */
export function chavesDaVenda(notas: NotaDeVenda[], devolucaoId: string): string[] {
  const chaves = notas
    .filter(
      (n) =>
        n.id !== devolucaoId &&
        n.situacao === "autorizada" &&
        (n.modelo == null || n.modelo === "nfe" || n.modelo === "55") &&
        chaveAcessoValida(n.chave),
    )
    .map((n) => String(n.chave));
  const unicas = [...new Set(chaves)];
  if (unicas.length === 0) {
    throw new Error(
      "A nota de devolução precisa referenciar a NF-e de venda autorizada deste pedido, e o pedido não tem nenhuma. Se a venda não teve NF-e, registre a devolução só no pedido.",
    );
  }
  return unicas;
}

/**
 * Número do item (nItem) na nota de venda para o produto devolvido: posição, a partir de 1, do primeiro
 * item daquele produto na ordem em que a nota foi transmitida. Null se o produto não está na venda.
 */
export function nItemDaVenda(
  itensDaVenda: { produto_id: string | null }[],
  produtoId: string | null,
): number | null {
  if (!produtoId) return null;
  const i = itensDaVenda.findIndex((it) => it.produto_id === produtoId);
  return i < 0 ? null : i + 1;
}

/**
 * Campos do ide da nota de devolução. indPres 0 (não se aplica): a devolução não é uma venda presencial.
 * `entrada` true: devolução de venda (a empresa recebe a mercadoria, tpNF 0); false: devolução de compra
 * (a empresa devolve ao fornecedor, tpNF 1).
 */
export function ideDevolucao(chaves: string[], entrada = true) {
  return {
    finNFe: 4,
    tpNF: entrada ? 0 : 1,
    indPres: 0,
    NFref: chaves.map((refNFe) => ({ refNFe })),
  } as const;
}
