import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { CHAVE_REST } from "@/lib/restaurante-dados";

/** Caixas abertos; o banco só aceita o da mesma filial da comanda (comanda sem filial aceita qualquer um). */
export function useCaixasAbertos(filialId: string | null) {
  return useQuery({
    queryKey: [CHAVE_REST, "caixas-abertos", filialId],
    queryFn: async () => {
      let consulta = supabase
        .from("caixas")
        .select("id, numero, filial_id")
        .eq("situacao", "aberto")
        .order("aberto_em", { ascending: false });
      if (filialId) consulta = consulta.eq("filial_id", filialId);
      const { data, error } = await consulta;
      if (error) throw error;
      return data ?? [];
    },
  });
}
