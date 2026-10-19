import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** A empresa tem show ao vivo (cobra couvert artístico). Sem a coluna ou sem resposta, vale "não". */
export function useShowAoVivo(): boolean {
  const { data } = useQuery({
    queryKey: ["empresa-show-ao-vivo"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("show_ao_vivo")
        .limit(1)
        .maybeSingle();
      if (error) return false;
      return Boolean(data?.show_ao_vivo);
    },
  });
  return data ?? false;
}
