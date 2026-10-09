import { supabase } from "@/integrations/supabase/client";

// As tabelas do restaurante ainda não estão nos tipos gerados do Supabase (o Lovable os atualiza depois da
// migration); por isso o acesso passa por estes ajudantes, com os tipos escritos aqui.

export type Mesa = {
  id: string;
  numero: string;
  capacidade: number | null;
  ativa: boolean;
  filial_id: string | null;
};

export type Comanda = {
  id: string;
  numero: number;
  mesa_id: string | null;
  filial_id: string | null;
  situacao: "aberta" | "fechada" | "cancelada";
  cliente_nome: string | null;
  pessoas: number | null;
  taxa_servico_percentual: number;
  couvert_por_pessoa: number;
  subtotal: number;
  couvert: number;
  taxa_servico: number;
  desconto: number;
  total: number;
  aberta_em: string;
  fechada_em: string | null;
  observacao: string | null;
  pessoas_pagas: number;
  tipo: "salao" | "delivery";
  canal: "proprio" | "ifood";
  codigo_externo: string | null;
  entrega_telefone: string | null;
  entrega_endereco: string | null;
  entrega_bairro: string | null;
  entrega_referencia: string | null;
  entrega_pagamento: string | null;
  entrega_troco_para: number | null;
  entrega_situacao: "aguardando" | "saiu" | "entregue" | null;
  entregador: string | null;
  saiu_em: string | null;
  entregue_cliente_em: string | null;
};

export type ZonaEntrega = { id: string; nome: string; taxa: number; ativo: boolean };

export type ComandaItem = {
  id: string;
  comanda_id: string;
  cardapio_item_id: string;
  nome: string;
  estacao: "cozinha" | "bar" | "nenhuma";
  opcoes: { nome: string; preco_adicional: number }[];
  quantidade: number;
  preco_unitario: number;
  total: number;
  observacao: string | null;
  situacao: "pendente" | "enviado" | "preparando" | "pronto" | "entregue" | "cancelado";
  pago_em: string | null;
  pagante: string | null;
  enviado_em: string | null;
  pronto_em: string | null;
  created_at: string;
};

export type PagamentoComanda = {
  id: string;
  comanda_id: string;
  forma: string;
  valor: number;
  pagante: string | null;
  parcial: boolean;
  created_at: string;
};

export type FichaTecnica = {
  id: string;
  item_id: string | null;
  opcao_id: string | null;
  produto_id: string;
  quantidade: number;
  perda_percentual: number;
};

export type RestauranteConfig = {
  tenant_id: string;
  baixa_estoque: boolean;
  deposito_id: string | null;
};

export type CardapioCategoria = { id: string; nome: string; ordem: number; ativo: boolean };

export type CardapioItem = {
  id: string;
  categoria_id: string | null;
  produto_id: string | null;
  interno: boolean;
  nome: string;
  descricao: string | null;
  preco: number;
  estacao: "cozinha" | "bar" | "nenhuma";
  tempo_preparo_min: number | null;
  ordem: number;
  ativo: boolean;
};

export type CardapioGrupo = {
  id: string;
  item_id: string;
  nome: string;
  obrigatorio: boolean;
  max_escolhas: number;
};

export type CardapioOpcao = {
  id: string;
  grupo_id: string;
  nome: string;
  preco_adicional: number;
  ativo: boolean;
};

/** Acesso às tabelas do restaurante (sem tipos gerados). */
export const tabela = (nome: string) => supabase.from(nome as never);

/** Chama uma função do restaurante e lança o erro do banco, com a mensagem em português. */
export async function rpcRestaurante<T = unknown>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.rpc(nome as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Chave comum das consultas do restaurante: uma invalidação atualiza todas. */
export const CHAVE_REST = "restaurante";
