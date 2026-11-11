import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import {
  lerMinhasRegras,
  lerPerfisDisponiveis,
  lerRegrasGlobais,
  type DadosRegraEmpresa,
} from "./fiscal-empresa";

// Regras fiscais da empresa (plano em docs/parametrizacao-fiscal.md, PR 5). Administrador e gestor; o banco confere o papel.
// As chaves levam a empresa: o cache do navegador é persistido e as sobrescritas são dela.

export const LIMITE_PAGINA_FISCAL = 100;
const RAIZ = "fiscal-empresa";

type Chamada = (
  nome: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

// os tipos gerados só conhecem as funções depois da migração aplicada
const chamar = async (nome: string, args: Record<string, unknown> = {}): Promise<unknown> => {
  const { data, error } = await (supabase as unknown as { rpc: Chamada }).rpc(nome, args);
  if (error) throw new Error(error.message);
  return data;
};

export type FiltroRegras = { busca: string; apenasVigentes: boolean; pagina: number };

export function usePerfisFiscais(tenantId: string | undefined) {
  return useQuery({
    queryKey: [RAIZ, tenantId ?? "", "perfis"],
    enabled: Boolean(tenantId),
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const r = lerPerfisDisponiveis(await chamar("fiscal_empresa_perfis"));
      if (!r) throw new Error("Resposta inesperada da base fiscal");
      return r;
    },
  });
}

export function useMinhasRegrasFiscais(tenantId: string | undefined, f: FiltroRegras) {
  return useQuery({
    queryKey: [RAIZ, tenantId ?? "", "minhas", f.busca, f.apenasVigentes, f.pagina],
    enabled: Boolean(tenantId),
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const r = lerMinhasRegras(
        await chamar("fiscal_empresa_minhas", {
          p_busca: f.busca || null,
          p_apenas_vigentes: f.apenasVigentes,
          p_limite: LIMITE_PAGINA_FISCAL,
          p_pagina: f.pagina,
        }),
      );
      if (!r) throw new Error("Resposta inesperada da base fiscal");
      return r;
    },
  });
}

export function useRegrasGlobaisFiscais(tenantId: string | undefined, f: FiltroRegras) {
  return useQuery({
    queryKey: [RAIZ, tenantId ?? "", "globais", f.busca, f.apenasVigentes, f.pagina],
    enabled: Boolean(tenantId),
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const r = lerRegrasGlobais(
        await chamar("fiscal_empresa_globais", {
          p_busca: f.busca || null,
          p_apenas_vigentes: f.apenasVigentes,
          p_limite: LIMITE_PAGINA_FISCAL,
          p_pagina: f.pagina,
        }),
      );
      if (!r) throw new Error("Resposta inesperada da base fiscal");
      return r;
    },
  });
}

/** Depois de qualquer mudança: recarrega as listas e a sugestão do cadastro de produtos (que muda com as regras da empresa). */
function useAposMudanca(tenantId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: [RAIZ, tenantId ?? ""] });
    void qc.invalidateQueries({ queryKey: ["fiscal-sugestao", tenantId ?? ""] });
  };
}

const resultadoSalvar = z.object({
  acao: z.enum(["nova", "nova_versao", "igual"]),
  id: z.string(),
  versao: z.number(),
});
export type ResultadoSalvarRegra = z.infer<typeof resultadoSalvar>;

export function useSalvarRegraFiscal(tenantId: string | undefined) {
  const aposMudanca = useAposMudanca(tenantId);
  return useMutation({
    mutationFn: async (dados: DadosRegraEmpresa): Promise<ResultadoSalvarRegra> => {
      const r = resultadoSalvar.safeParse(
        await chamar("fiscal_empresa_regra_salvar", { p_dados: dados }),
      );
      if (!r.success) throw new Error("Resposta inesperada da base fiscal");
      return r.data;
    },
    onSuccess: aposMudanca,
  });
}

export function useEncerrarRegraFiscal(tenantId: string | undefined) {
  const aposMudanca = useAposMudanca(tenantId);
  return useMutation({
    mutationFn: (p: { regraId: string; fim: string }) =>
      chamar("fiscal_empresa_regra_encerrar", { p_regra_id: p.regraId, p_fim: p.fim }),
    onSuccess: aposMudanca,
  });
}

export function useOcultarRegraFiscal(tenantId: string | undefined) {
  const aposMudanca = useAposMudanca(tenantId);
  return useMutation({
    mutationFn: (p: { regraId: string; motivo: string }) =>
      chamar("fiscal_empresa_ocultar", { p_regra_id: p.regraId, p_motivo: p.motivo }),
    onSuccess: aposMudanca,
  });
}

export function useReexibirRegraFiscal(tenantId: string | undefined) {
  const aposMudanca = useAposMudanca(tenantId);
  return useMutation({
    mutationFn: (regraId: string) => chamar("fiscal_empresa_reexibir", { p_regra_id: regraId }),
    onSuccess: aposMudanca,
  });
}
