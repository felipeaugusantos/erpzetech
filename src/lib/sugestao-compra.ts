/**
 * Sugestão de reposição: quanto comprar de cada produto, com os fatores que explicam a conta.
 * Quantidades em unidade de venda/estoque; a compra é arredondada para cima em embalagens de compra
 * (fator = quantas unidades de estoque vêm em uma unidade de compra).
 */
export type EntradaSugestao = {
  vendidoNaJanela: number;
  diasJanela: number;
  fisico: number;
  reservado: number;
  /** Já pedido ao fornecedor e ainda não recebido. */
  emCompra: number;
  minimo: number;
  maximo: number;
  prazoFornecedorDias: number;
  /** Dias de venda que a compra deve cobrir, além do prazo de entrega. */
  coberturaDias: number;
  fatorCompra: number;
};

export type Sugestao = {
  mediaDia: number;
  disponivel: number;
  projetado: number;
  consumoNoPrazo: number;
  alvo: number;
  quantidade: number;
  embalagens: number;
  fatores: string[];
};

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function sugerirCompra(e: EntradaSugestao): Sugestao {
  const dias = Math.max(n(e.diasJanela), 1);
  const mediaDia = n(e.vendidoNaJanela) / dias;
  const disponivel = n(e.fisico) - n(e.reservado);
  const projetado = disponivel + n(e.emCompra);
  const prazo = Math.max(n(e.prazoFornecedorDias), 0);
  const consumoNoPrazo = mediaDia * prazo;
  const minimo = Math.max(n(e.minimo), 0);
  const maximo = n(e.maximo) > minimo ? n(e.maximo) : 0;

  // alvo: cobrir o prazo de entrega + a cobertura pedida, nunca abaixo do mínimo e nunca acima do máximo
  let alvo = Math.max(consumoNoPrazo + mediaDia * Math.max(n(e.coberturaDias), 0), minimo);
  if (maximo > 0) alvo = Math.min(alvo, maximo);

  // o projetado (disponível + já pedido) precisa atravessar o prazo de entrega e ainda chegar ao alvo
  const bruto = Math.max(alvo + consumoNoPrazo - projetado, 0);

  const fator = n(e.fatorCompra) > 0 ? n(e.fatorCompra) : 1;
  const embalagens = bruto > 0 ? Math.ceil(r3(bruto / fator)) : 0;
  const quantidade = r3(embalagens * fator);

  const fatores: string[] = [];
  fatores.push(
    mediaDia > 0
      ? `Venda média de ${r3(mediaDia)}/dia nos últimos ${dias} dias`
      : `Sem vendas nos últimos ${dias} dias`,
  );
  fatores.push(`Disponível ${r3(disponivel)} (físico ${r3(n(e.fisico))} − reservado ${r3(n(e.reservado))})`);
  if (n(e.emCompra) > 0) fatores.push(`${r3(n(e.emCompra))} já pedidos ao fornecedor`);
  if (prazo > 0) fatores.push(`Prazo do fornecedor ${prazo} dias (consumo previsto ${r3(consumoNoPrazo)})`);
  if (minimo > 0) fatores.push(`Estoque mínimo ${r3(minimo)}`);
  if (maximo > 0) fatores.push(`Limitado ao máximo ${r3(maximo)}`);
  if (fator !== 1 && embalagens > 0) fatores.push(`Arredondado para ${embalagens} embalagem(ns) de ${fator}`);

  return {
    mediaDia: r3(mediaDia),
    disponivel: r3(disponivel),
    projetado: r3(projetado),
    consumoNoPrazo: r3(consumoNoPrazo),
    alvo: r3(alvo),
    quantidade,
    embalagens,
    fatores,
  };
}
