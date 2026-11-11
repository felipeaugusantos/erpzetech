import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { TipoCategoria } from "@/lib/categorias-financeiras";

/** Categorias ativas de um tipo (receita ou despesa), da empresa. */
export function useCategoriasFinanceiras(tipo: TipoCategoria) {
  return useQuery({
    queryKey: ["financeiro-categorias", tipo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financeiro_categorias")
        .select("id, nome, grupo")
        .eq("tipo", tipo)
        .eq("ativa", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });
}
