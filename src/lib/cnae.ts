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
    // idem para o pet shop: ramo escolhido no cadastro ou CNAE de veterinária/pet shop
    // a clínica também usa o cadastro, a agenda e a cobrança do pet shop
    petshop:
      empresa?.ramo_atividade === "petshop" ||
      empresa?.ramo_atividade === "clinica" ||
      moduloLiberadoPorCnae(cnaes, "petshop"),
    // prontuário e vacina: ramo "Clínica veterinária" ou CNAE de atividades veterinárias
    clinica: empresa?.ramo_atividade === "clinica" || moduloLiberadoPorCnae(cnaes, "clinica"),
  };
}
