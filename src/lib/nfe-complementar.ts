// NF-e complementar (finNFe 2): regras puras, sem rede nem banco.
// Complementa VALOR (diferença de preço, imposto não destacado) de uma NF-e de venda já autorizada. Não serve para
// corrigir quantidade, destinatário nem dados cadastrais (para isso: nota de ajuste, carta de correção ou
// cancelamento e nova emissão). Regras da Sefaz usadas aqui: exatamente UMA nota referenciada (rejeições
// 254/255), do mesmo emitente (269), que não seja outra complementar (268).

import { chaveAcessoValida } from "./nfe-devolucao.ts";

export type NotaOriginal = {
  situacao: string;
  chave: string | null;
  modelo?: string | null;
  complementa_nfe_id?: string | null;
  fornecedor_id?: string | null;
};

/** Confere se a nota pode ser complementada e devolve a chave que a complementar referencia. */
export function chaveDaOrigemComplementar(o: NotaOriginal): string {
  if (o.situacao !== "autorizada") {
    throw new Error("Só nota autorizada pode ser complementada.");
  }
  if (o.modelo != null && o.modelo !== "nfe" && o.modelo !== "55") {
    throw new Error("Só NF-e (modelo 55) pode ser complementada por esta tela.");
  }
  if (o.complementa_nfe_id) {
    throw new Error("Uma nota complementar não pode ser complementada de novo (rejeição 268).");
  }
  if (o.fornecedor_id) {
    throw new Error("Nota de devolução de compra não pode ser complementada por esta tela.");
  }
  const chave = String(o.chave ?? "").trim();
  if (!chaveAcessoValida(chave)) {
    throw new Error("A nota original não tem uma chave de acesso válida para ser referenciada.");
  }
  return chave;
}

export type ItemComplemento = { nfe_item_id: string; valor: number };

/**
 * Itens da complementar: cada um precisa ser da nota original, com valor maior que zero, sem repetir.
 * O valor é arredondado em 2 casas; valor que vira zero depois de arredondar é recusado.
 */
export function validarItensComplemento(
  itens: { nfe_item_id: unknown; valor: unknown }[],
  idsDaOriginal: string[],
): ItemComplemento[] {
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new Error("Informe o valor a complementar em pelo menos um item.");
  }
  const vistos = new Set<string>();
  return itens.map((i) => {
    const id = String(i?.nfe_item_id ?? "");
    if (!idsDaOriginal.includes(id)) throw new Error("Item não pertence à nota original.");
    if (vistos.has(id)) throw new Error("Item repetido na complementar.");
    vistos.add(id);
    const valor = Math.round(Number(i?.valor) * 100) / 100;
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new Error("O valor a complementar de cada item precisa ser maior que zero.");
    }
    if (valor > 9_999_999_999.99) throw new Error("Valor a complementar grande demais.");
    return { nfe_item_id: id, valor };
  });
}

/** Campos do ide da complementar: finalidade 2, saída, indPres 0 e a ÚNICA nota referenciada. */
export function ideComplementar(chave: string) {
  return { finNFe: 2, tpNF: 1, indPres: 0, NFref: [{ refNFe: chave }] } as const;
}

/**
 * Campos do item da complementar: não há mercadoria nova, então quantidade e valor unitário vão zerados e o
 * valor complementado vai em vProd. (Prática de mercado; confirmar a validação na homologação.)
 */
export function itemComplementar(valor: number) {
  return { qCom: 0, vUnCom: 0, qTrib: 0, vUnTrib: 0, vProd: Math.round(valor * 100) / 100 };
}
