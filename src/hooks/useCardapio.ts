import { useQuery } from "@tanstack/react-query";
import {
  CHAVE_REST,
  tabela,
  type CardapioCategoria,
  type CardapioGrupo,
  type CardapioItem,
  type CardapioOpcao,
} from "@/lib/restaurante-dados";

/** Cardápio da empresa. Por padrão só o que está ativo (salão); a gestão pede tudo. */
export function useCardapio(incluirInativos = false) {
  return useQuery({
    queryKey: [CHAVE_REST, "cardapio", incluirInativos],
    queryFn: async () => {
      const [cat, itens, grupos, opcoes] = await Promise.all([
        tabela("cardapio_categorias").select("*").order("ordem").order("nome"),
        tabela("cardapio_itens").select("*").order("ordem").order("nome"),
        tabela("cardapio_grupos").select("*").order("nome"),
        tabela("cardapio_opcoes").select("*").order("nome"),
      ]);
      for (const r of [cat, itens, grupos, opcoes]) if (r.error) throw new Error(r.error.message);
      const ativos = <T extends { ativo: boolean }>(l: T[]) =>
        incluirInativos ? l : l.filter((x) => x.ativo);
      return {
        categorias: ativos((cat.data ?? []) as unknown as CardapioCategoria[]),
        itens: ativos((itens.data ?? []) as unknown as CardapioItem[]),
        grupos: (grupos.data ?? []) as unknown as CardapioGrupo[],
        opcoes: ativos((opcoes.data ?? []) as unknown as CardapioOpcao[]),
      };
    },
  });
}
