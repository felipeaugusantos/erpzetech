import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { MENSAGEM_PADRAO, type TipoMensagem } from "@/lib/contato-pet";

/** Texto do modelo da empresa (ou o padrão do sistema) para um tipo de mensagem. */
export function useModeloMensagem(tipo: TipoMensagem) {
  const q = useQuery({
    queryKey: ["pet-mensagem-modelos"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("pet_mensagem_modelos").select("tipo, texto");
      if (error) throw error;
      return (data ?? []) as { tipo: string; texto: string }[];
    },
  });
  const salvo = q.data?.find((m) => m.tipo === tipo)?.texto ?? null;
  return { salvo, padrao: MENSAGEM_PADRAO[tipo], carregando: q.isLoading };
}
