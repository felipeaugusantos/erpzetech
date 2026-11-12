import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useSessionData } from "@/hooks/useSessionData";
import type { ModeloEtiqueta } from "./etiqueta";
import { modeloDaLinha, type ConfigModeloEtiqueta } from "./etiqueta-modelo";

/** Chave com o usuário (como as demais consultas da empresa): o cache do navegador não mistura sessões. */
export const chaveModelosEtiqueta = (userId: string | undefined) =>
  ["etiqueta-modelos", userId ?? "-"] as const;

export type ModeloEtiquetaSalvo = {
  id: string;
  nome: string;
  config: ConfigModeloEtiqueta;
  modelo: ModeloEtiqueta;
};

/**
 * Modelos de etiqueta da empresa. Qualquer falha (migração ainda não aplicada, sem rede) vira lista vazia,
 * para os modelos prontos nunca deixarem de aparecer; linha inválida é ignorada.
 */
export function useModelosEtiqueta() {
  const { data: sessao } = useSessionData();
  const userId = sessao?.user?.id;
  return useQuery({
    queryKey: chaveModelosEtiqueta(userId),
    enabled: !!userId,
    queryFn: async (): Promise<ModeloEtiquetaSalvo[]> => {
      const { data, error } = await supabase.rpc("etiqueta_modelos_listar");
      if (error) return [];
      const lista: ModeloEtiquetaSalvo[] = [];
      for (const l of data ?? []) {
        const modelo = modeloDaLinha(l);
        if (modelo)
          lista.push({
            id: l.id,
            nome: l.nome,
            config: l.config as unknown as ConfigModeloEtiqueta,
            modelo,
          });
      }
      return lista;
    },
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function mensagemErroModelo(error: { code?: string; message?: string }): string {
  if (error.code === "PGRST202" || /etiqueta_modelo/.test(error.message ?? ""))
    return "O banco ainda não tem o recurso de modelos de etiqueta. Peça à equipe para aplicar a migração 0088.";
  return error.message || "Não foi possível salvar o modelo.";
}

export function useSalvarModeloEtiqueta() {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  return useMutation({
    mutationFn: async (v: { id: string | null; nome: string; config: ConfigModeloEtiqueta }) => {
      const { data, error } = await supabase.rpc("etiqueta_modelo_salvar", {
        p_id: v.id as string,
        p_nome: v.nome,
        p_config: v.config as unknown as Json,
      });
      if (error) throw new Error(mensagemErroModelo(error));
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveModelosEtiqueta(sessao?.user?.id) }),
  });
}

export function useExcluirModeloEtiqueta() {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("etiqueta_modelo_excluir", { p_id: id });
      if (error) throw new Error(mensagemErroModelo(error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveModelosEtiqueta(sessao?.user?.id) }),
  });
}
