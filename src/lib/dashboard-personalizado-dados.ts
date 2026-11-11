import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  catalogoDoPainel,
  lerConfigDashboard,
  type ConfigDashboard,
} from "./dashboard-personalizado";

export const chaveDashboardPersonalizado = (painel: string) =>
  ["dashboard-personalizado", painel] as const;

/**
 * Configuração do dashboard da empresa. Qualquer falha (migração ainda não aplicada, sem rede) vira "sem personalização",
 * para o dashboard padrão nunca deixar de aparecer.
 */
export function useDashboardPersonalizado(painel: string) {
  return useQuery({
    queryKey: chaveDashboardPersonalizado(painel),
    queryFn: async (): Promise<ConfigDashboard | null> => {
      const { data, error } = await supabase.rpc("dashboard_personalizado_obter", {
        p_painel: painel,
      });
      if (error) return null;
      return lerConfigDashboard(data, catalogoDoPainel(painel));
    },
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** Mensagem para a pessoa quando a gravação falha (as funções só existem depois da migração 0083). */
export function mensagemErroDashboard(error: { code?: string; message?: string }): string {
  if (error.code === "PGRST202" || /dashboard_personalizado_/.test(error.message ?? ""))
    return "O banco ainda não tem o recurso de dashboard personalizado. Peça à equipe para aplicar a migração 0083.";
  return error.message || "Não foi possível salvar o dashboard.";
}

export function useSalvarDashboard(painel: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: ConfigDashboard) => {
      const { error } = await supabase.rpc("dashboard_personalizado_salvar", {
        p_painel: painel,
        p_config: config as unknown as Json,
      });
      if (error) throw new Error(mensagemErroDashboard(error));
      return config;
    },
    onSuccess: (config) => qc.setQueryData(chaveDashboardPersonalizado(painel), config),
  });
}

export function useRestaurarDashboard(painel: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("dashboard_personalizado_restaurar", {
        p_painel: painel,
      });
      if (error) throw new Error(mensagemErroDashboard(error));
    },
    onSuccess: () => qc.setQueryData(chaveDashboardPersonalizado(painel), null),
  });
}
