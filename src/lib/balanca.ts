import { digitoEan13 } from "./ean.ts";
import { calcularPesagem } from "./pesagem.ts";

/**
 * Código de barras de balança (EAN-13 que começa com 2): `2` + código do produto (6 dígitos) + peso em
 * gramas (5 dígitos) + dígito verificador. O caixa lê o código, acha o produto pelo código interno e calcula
 * o valor pelo preço do kg do cadastro: mudar o preço não deixa etiqueta velha com valor errado.
 * Só vale para produto vendido por kg cujo código interno tem apenas números (até 6 dígitos).
 */
export const PESO_MAXIMO_G = 99_999;

export const ehUnidadeDePeso = (unidade: string | null | undefined) =>
  /^\s*kg\s*$/i.test(unidade ?? "");

/** Código interno que cabe no código de balança: só números, de 1 a 6 dígitos, maior que zero. */
export function codigoBalancaDoProduto(codigoInterno: string | null | undefined): string | null {
  const c = (codigoInterno ?? "").trim();
  if (!/^\d{1,6}$/.test(c) || Number(c) === 0) return null;
  return c.padStart(6, "0");
}

export function gerarCodigoBalanca(codigoInterno: string, pesoG: number): string {
  const cod = codigoBalancaDoProduto(codigoInterno);
  if (!cod)
    throw new Error(
      "O código interno do produto precisa ter de 1 a 6 números para o código de balança.",
    );
  if (!Number.isInteger(pesoG) || pesoG < 1 || pesoG > PESO_MAXIMO_G) {
    throw new Error("Peso fora do limite do código de balança (1 g a 99,999 kg).");
  }
  const doze = `2${cod}${String(pesoG).padStart(5, "0")}`; // 1 + 6 + 5 = 12 dígitos
  return doze + digitoEan13(doze);
}

export type LeituraBalanca = { codigo: string; pesoG: number };

/** Lê um código de balança; null se não for EAN-13 de prefixo 2 com dígito certo e peso maior que zero. */
export function lerCodigoBalanca(texto: string): LeituraBalanca | null {
  const t = texto.trim();
  if (!/^2\d{12}$/.test(t)) return null;
  if (digitoEan13(t.slice(0, 12)) !== Number(t[12])) return null;
  const pesoG = Number(t.slice(7, 12));
  if (pesoG < 1) return null;
  return { codigo: t.slice(1, 7), pesoG };
}

/** Produto vendido por kg cujo código interno é o código lido; mais de um igual (123 e 00123) = ambíguo = null. */
export function acharProdutoDeBalanca<
  T extends {
    codigo_interno?: string | null;
    unidade?: string | null;
    unidade_venda?: string | null;
  },
>(produtos: T[], codigo: string): T | null {
  const achados = produtos.filter(
    (p) =>
      ehUnidadeDePeso(p.unidade_venda ?? p.unidade) &&
      codigoBalancaDoProduto(p.codigo_interno) === codigo,
  );
  return achados.length === 1 ? achados[0]! : null;
}

/** Valor a pagar de uma pesagem (mesma conta do restaurante: centavos inteiros). */
export function valorDaPesagem(pesoG: number, precoKg: number): number | null {
  return calcularPesagem({ brutoG: pesoG, taraG: 0, precoKg })?.valor ?? null;
}

export type LeituraDeBalancaNoPdv<T> = { produto: T; quantidade: number } | { erro: string };

/**
 * Leitura do campo de busca do caixa: se o texto for um código de balança, devolve o produto por kg e o peso em kg
 * (ou o motivo de não achar o produto); se não for código de balança, devolve null e a busca segue como sempre.
 * O caixa só chega aqui depois de não achar nenhum produto com esse código de barras ou código interno exato.
 */
export function leituraDeBalancaNoPdv<
  T extends {
    codigo_interno?: string | null;
    unidade?: string | null;
    unidade_venda?: string | null;
  },
>(produtos: T[], texto: string): LeituraDeBalancaNoPdv<T> | null {
  const l = lerCodigoBalanca(texto);
  if (!l) return null;
  const produto = acharProdutoDeBalanca(produtos, l.codigo);
  if (!produto) {
    return {
      erro: `Etiqueta de balança lida (código ${Number(l.codigo)}), mas não há um único produto vendido por kg com esse código interno.`,
    };
  }
  return { produto, quantidade: l.pesoG / 1000 };
}
