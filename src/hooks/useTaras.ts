import { useQuery } from "@tanstack/react-query";

import { CHAVE_REST, tabela, type Tara } from "@/lib/restaurante-dados";

/** Taras cadastradas (prato, vasilhame). Quem opera a balança lê; a gestão cadastra. */
export function useTaras() {
  return useQuery({
    queryKey: [CHAVE_REST, "taras"],
    queryFn: async () => {
      const { data, error } = await tabela("restaurante_taras").select("*").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Tara[];
    },
  });
}
