import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { PlanoSituacao } from "@/lib/manutencao-locacao";

/** Situação dos planos de manutenção ativos (dias locados acumulados, quanto falta e se venceu). */
export function usePlanosManutencao(equipamentoId?: string) {
  return useQuery({
    queryKey: ["locacao-manutencao-situacao", equipamentoId ?? "todos"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("locacao_manutencao_situacao", {
        ...(equipamentoId ? { p_equipamento_id: equipamentoId } : {}),
      });
      if (error) throw error;
      return (data ?? []) as unknown as PlanoSituacao[];
    },
  });
}
