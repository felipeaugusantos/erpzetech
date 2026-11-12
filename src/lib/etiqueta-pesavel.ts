import { gerarCodigoBalanca, valorDaPesagem } from "./balanca.ts";
import { dataEtiqueta, type DadosEtiqueta } from "./etiqueta.ts";

/**
 * Etiqueta de uma pesagem: a partir do produto vendido por kg (`base.pesavel`) e do peso, monta o valor a pagar,
 * o texto de peso e preço do kg e o código de balança (que o caixa lê para vender o peso certo).
 * `validade` é a data em AAAA-MM-DD (opcional).
 */
export function etiquetaPesavel(
  base: DadosEtiqueta,
  pesoG: number,
  validade?: string | null,
): DadosEtiqueta {
  if (!base.pesavel) throw new Error("Produto sem preço por kg.");
  const { codigoInterno, precoKg } = base.pesavel;
  if (!(precoKg > 0))
    throw new Error(`O produto “${base.descricao}” está sem preço de venda por kg.`);
  const valor = valorDaPesagem(pesoG, precoKg);
  if (valor == null) throw new Error("Peso inválido.");
  return {
    ...base,
    pesavel: null,
    pesagem: { pesoG, precoKg },
    preco: valor,
    unidade: null,
    codigo: gerarCodigoBalanca(codigoInterno, pesoG),
    validade: dataEtiqueta(validade) ?? base.validade ?? null,
  };
}
