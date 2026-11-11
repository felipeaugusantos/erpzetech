import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { lerConfigMenu, type ConfigMenu } from "./menu-personalizado";

export const CHAVE_MENU_PERSONALIZADO = ["menu-personalizado"] as const;

/**
 * Configuração do menu da empresa. Qualquer falha (migração ainda não aplicada, sem rede) vira "sem personalização",
 * para o menu padrão nunca deixar de aparecer.
 */
export function useMenuPersonalizado() {
  return useQuery({
    queryKey: CHAVE_MENU_PERSONALIZADO,
    queryFn: async (): Promise<ConfigMenu | null> => {
      const { data, error } = await supabase.rpc("menu_personalizado_obter");
      if (error) return null;
      return lerConfigMenu(data);
    },
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** Mensagem para a pessoa quando a gravação falha (a função só existe depois da migração 0082). */
export function mensagemErroMenu(error: { code?: string; message?: string }): string {
  if (error.code === "PGRST202" || /menu_personalizado_/.test(error.message ?? ""))
    return "O banco ainda não tem o recurso de menu personalizado. Peça à equipe para aplicar a migração 0082.";
  return error.message || "Não foi possível salvar o menu.";
}

export function useSalvarMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: ConfigMenu) => {
      const { error } = await supabase.rpc("menu_personalizado_salvar", {
        p_config: config as unknown as Json,
      });
      if (error) throw new Error(mensagemErroMenu(error));
      return config;
    },
    onSuccess: (config) => qc.setQueryData(CHAVE_MENU_PERSONALIZADO, config),
  });
}

export function useRestaurarMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("menu_personalizado_restaurar");
      if (error) throw new Error(mensagemErroMenu(error));
    },
    onSuccess: () => qc.setQueryData(CHAVE_MENU_PERSONALIZADO, null),
  });
}
