import { useQuery } from "@tanstack/react-query";

import { CHAVE_REST, tabela, type ZonaEntrega } from "@/lib/restaurante-dados";

/** Zonas de entrega (bairro → taxa). Quem atende o delivery lê; a gestão cadastra. */
export function useZonasEntrega() {
  return useQuery({
    queryKey: [CHAVE_REST, "zonas-entrega"],
    queryFn: async () => {
      const { data, error } = await tabela("restaurante_zonas_entrega").select("*").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ZonaEntrega[];
    },
  });
}
