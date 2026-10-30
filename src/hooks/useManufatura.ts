import { useSessionData } from "@/hooks/useSessionData";
import { manufaturaLiberadaEmpresa, temPerfil } from "@/lib/manufatura";

/** Liberação da manufatura (piloto: só pela equipe) e os perfis do usuário para decidir o que mostrar. */
export function useManufatura() {
  const { data, isLoading } = useSessionData();
  const roles = data?.roles ?? [];
  return {
    carregando: isLoading,
    liberada: manufaturaLiberadaEmpresa(data?.empresa),
    roles,
    temPerfil: (perfis: readonly string[]) => temPerfil(roles, perfis),
  };
}
