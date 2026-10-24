import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { precoNaTabela, type TabelaPreco } from "@/lib/tabela-preco";

/**
 * Preço de venda para o cliente escolhido. Sem cliente, ou com cliente sem tabela, o preço é o do cadastro do produto.
 * `tabelaPrecoId` vem do cadastro do cliente (clientes.tabela_preco_id).
 */
export function useTabelaPrecoCliente(tabelaPrecoId: string | null | undefined) {
  const { data } = useQuery({
    queryKey: ["tabela-preco-cliente", tabelaPrecoId],
    enabled: !!tabelaPrecoId,
    queryFn: async () => {
      const [tabela, itens] = await Promise.all([
        supabase
          .from("tabelas_preco")
          .select("id, nome, ajuste_percentual, ativa")
          .eq("id", tabelaPrecoId as string)
          .maybeSingle(),
        supabase
          .from("tabela_preco_itens")
          .select("produto_id, preco")
          .eq("tabela_id", tabelaPrecoId as string),
      ]);
      if (tabela.error) throw tabela.error;
      if (itens.error) throw itens.error;
      const fixos = new Map((itens.data ?? []).map((i) => [i.produto_id, Number(i.preco)]));
      const t: TabelaPreco | null = tabela.data
        ? { ...tabela.data, ajuste_percentual: Number(tabela.data.ajuste_percentual) }
        : null;
      return { tabela: t, fixos };
    },
  });

  /** Preço do produto para este cliente. */
  const preco = useCallback(
    (produtoId: string, precoVenda: number | string | null | undefined) =>
      precoNaTabela(Number(precoVenda ?? 0), data?.tabela, data?.fixos.get(produtoId)),
    [data],
  );

  return { tabela: data?.tabela && data.tabela.ativa ? data.tabela : null, preco };
}
