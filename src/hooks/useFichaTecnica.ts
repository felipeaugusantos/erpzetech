import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { custoDoInsumo } from "@/lib/ficha-tecnica";
import {
  CHAVE_REST,
  tabela,
  type FichaTecnica,
  type RestauranteConfig,
} from "@/lib/restaurante-dados";

export type Insumo = {
  id: string;
  descricao: string;
  codigo_interno: string | null;
  unidade: string | null;
  custo: number | null;
};

/** Fichas técnicas, insumos (produtos do cadastro), configuração de estoque e custo de cada insumo. */
export function useFichaTecnica() {
  const q = useQuery({
    queryKey: [CHAVE_REST, "ficha"],
    queryFn: async () => {
      const [ficha, produtos, config, estoques] = await Promise.all([
        tabela("cardapio_ficha").select("*"),
        supabase
          .from("produtos")
          .select("id, descricao, codigo_interno, unidade, custo")
          .order("descricao"),
        tabela("restaurante_config").select("*").maybeSingle(),
        supabase.from("estoques").select("produto_id, deposito_id, custo_medio"),
      ]);
      if (ficha.error) throw new Error(ficha.error.message);
      if (produtos.error) throw new Error(produtos.error.message);
      if (config.error) throw new Error(config.error.message);
      if (estoques.error) throw new Error(estoques.error.message);
      return {
        ficha: (ficha.data ?? []) as unknown as FichaTecnica[],
        produtos: (produtos.data ?? []) as unknown as Insumo[],
        config: (config.data ?? null) as unknown as RestauranteConfig | null,
        estoques: estoques.data ?? [],
      };
    },
  });

  // custo por unidade de estoque de cada insumo: médio do depósito do restaurante, senão o do cadastro
  const custos = useMemo(() => {
    const mapa = new Map<string, number>();
    const deposito = q.data?.config?.deposito_id;
    const medios = new Map<string, number>();
    for (const e of q.data?.estoques ?? [])
      if (deposito && e.deposito_id === deposito)
        medios.set(e.produto_id, Number(e.custo_medio ?? 0));
    for (const p of q.data?.produtos ?? [])
      mapa.set(p.id, custoDoInsumo(medios.get(p.id), p.custo));
    return mapa;
  }, [q.data]);

  const produtosPorId = useMemo(
    () => new Map((q.data?.produtos ?? []).map((p) => [p.id, p])),
    [q.data],
  );

  return { ...q, custos, produtosPorId };
}
