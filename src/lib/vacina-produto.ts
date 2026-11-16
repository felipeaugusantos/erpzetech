export type ProdutoVacina = {
  id: string;
  descricao: string;
  codigo_interno: string;
  controla_estoque: boolean;
  controla_lote: boolean;
};

export function precisaControleDose(produto: ProdutoVacina | undefined): boolean {
  return Boolean(produto && (!produto.controla_estoque || !produto.controla_lote));
}

export function podeSalvarCatalogo(
  nome: string,
  produto: ProdutoVacina | undefined,
  confirmado: boolean,
  criarDose = false,
): boolean {
  return Boolean(
    nome.trim() && (criarDose || (produto && (!precisaControleDose(produto) || confirmado))),
  );
}
