import { useSessionData } from "@/hooks/useSessionData";
import { cnaesDaEmpresa, moduloLiberadoEmpresa } from "./cnae-regras.ts";

export * from "./cnae-regras.ts";

/** Situação dos módulos opcionais para o usuário logado. */
export function useModulosCnae() {
  const { data, isLoading } = useSessionData();
  const empresa = data?.empresa ?? null;
  const cnaes = cnaesDaEmpresa(empresa);
  return {
    carregando: isLoading,
    cnaes,
    assistencia: moduloLiberadoEmpresa(empresa, "assistencia"),
    locacao: moduloLiberadoEmpresa(empresa, "locacao"),
    restaurante: moduloLiberadoEmpresa(empresa, "restaurante"),
    petshop: moduloLiberadoEmpresa(empresa, "petshop"),
    clinica: moduloLiberadoEmpresa(empresa, "clinica"),
  };
}
