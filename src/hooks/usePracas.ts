import { useQuery } from "@tanstack/react-query";

import { CHAVE_REST, tabela, type Praca } from "@/lib/restaurante-dados";

/** Praças de produção cadastradas (churrascaria, lanches, pizzaria…). Cozinha e bar são fixas e não ficam na lista. */
export function usePracas() {
  return useQuery({
    queryKey: [CHAVE_REST, "pracas"],
    queryFn: async () => {
      const { data, error } = await tabela("restaurante_pracas").select("*").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Praca[];
    },
  });
}
