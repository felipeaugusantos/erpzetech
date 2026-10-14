import { useSessionData } from "@/hooks/useSessionData";
import { cnaesDaEmpresa, moduloLiberadoPorCnae } from "./cnae-regras.ts";

export * from "./cnae-regras.ts";

/** Situação dos módulos opcionais para o usuário logado. */
export function useModulosCnae() {
  const { data, isLoading } = useSessionData();
  const empresa = (data?.empresa ?? null) as {
    cnae?: string | null;
    cnae_secundarios?: string | null;
    ramo_atividade?: string | null;
  } | null;
  const cnaes = cnaesDaEmpresa(empresa);
  return {
    carregando: isLoading,
    cnaes,
    assistencia: moduloLiberadoPorCnae(cnaes, "assistencia"),
    locacao: moduloLiberadoPorCnae(cnaes, "locacao"),
    // o ramo escolhido no cadastro da empresa também libera o salão, sem depender do CNAE
    restaurante:
      empresa?.ramo_atividade === "restaurante" || moduloLiberadoPorCnae(cnaes, "restaurante"),
  };
}
