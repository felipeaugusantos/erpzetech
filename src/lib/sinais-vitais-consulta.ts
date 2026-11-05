import { supabase } from "@/integrations/supabase/client";
import type { HistoricoSinais } from "./sinais-vitais";

/** Histórico de sinais vitais da internação (mesma consulta e mesma chave de cache em todas as telas que o mostram). */
export async function historicoSinais(internacaoId: string): Promise<HistoricoSinais> {
  const { data, error } = await supabase.rpc("clinica_sinais_internacao", {
    p_internacao_id: internacaoId,
  });
  if (error) throw error;
  return data as unknown as HistoricoSinais;
}

export const chaveSinais = (internacaoId: string) => ["clinica-sinais", internacaoId] as const;
