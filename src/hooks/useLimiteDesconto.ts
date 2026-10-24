import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type ItemDoLimite = { produto_id: string; quantidade: number; preco_unitario: number };

/**
 * Quanto de desconto (R$) quem está logado pode dar nestes itens sem a senha do gestor, pelas faixas de
 * desconto (grupo, marca e perfil). `undefined` enquanto carrega, sem itens ou se o servidor não responder:
 * quem usa deve cair no limite único da empresa. O servidor confere de novo ao gravar.
 */
export function useLimiteDesconto(itens: ItemDoLimite[]) {
  const { data } = useQuery({
    queryKey: ["desconto-limite", JSON.stringify(itens)],
    enabled: itens.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("desconto_limite_itens", { p_itens: itens });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
  return data;
}
