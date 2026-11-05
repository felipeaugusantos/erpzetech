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
    /** Pets e tutores e Contatos: do pet shop e também da clínica, mesmo sem o pet shop contratado. */
    petsETutores:
      moduloLiberadoEmpresa(empresa, "petshop") || moduloLiberadoEmpresa(empresa, "clinica"),
    clinica: moduloLiberadoEmpresa(empresa, "clinica"),
    lavarapido: moduloLiberadoEmpresa(empresa, "lavarapido"),
    hotelaria: moduloLiberadoEmpresa(empresa, "hotelaria"),
  };
}
