import { useSessionData } from "@/hooks/useSessionData";

/** Módulos que só ficam disponíveis quando a atividade da empresa permite. */
export type ModuloCnae = "assistencia" | "locacao";

/** Grupos de CNAE que liberam cada módulo (comparação pelo início do código). */
const REGRAS: Record<ModuloCnae, { prefixos: string[]; exemplos: string[] }> = {
  assistencia: {
    prefixos: ["95", "3314", "3319", "4520", "4543"],
    exemplos: [
      "95.11-8 — Reparação e manutenção de computadores",
      "95.21-5 — Reparação de equipamentos de áudio e vídeo",
      "95.29-1 — Reparação de objetos e equipamentos pessoais e domésticos",
      "33.14-7 — Manutenção e reparação de máquinas e equipamentos",
      "45.20-0 — Manutenção e reparação de veículos automotores",
    ],
  },
  locacao: {
    prefixos: ["77", "4399"],
    exemplos: [
      "77.32-2 — Aluguel de máquinas e equipamentos para construção",
      "77.31-4 — Aluguel de máquinas e equipamentos agrícolas",
      "77.39-0 — Aluguel de outras máquinas e equipamentos comerciais",
      "43.99-1 — Serviços especializados para construção (com equipamentos)",
    ],
  },
};

export const ROTULO_MODULO: Record<ModuloCnae, string> = {
  assistencia: "Assistência técnica",
  locacao: "Locação de equipamentos",
};

export function exemplosCnae(modulo: ModuloCnae) {
  return REGRAS[modulo].exemplos;
}

/** Deixa só os números do código (9511-8/00 → 9511800). */
export function somenteDigitos(valor: string) {
  return valor.replace(/\D/g, "");
}

/** Lê o CNAE principal e os secundários informados no cadastro da empresa. */
export function cnaesDaEmpresa(
  empresa?: {
    cnae?: string | null;
    cnae_secundarios?: string | null;
  } | null,
) {
  const bruto = [empresa?.cnae ?? "", empresa?.cnae_secundarios ?? ""].join(",");
  return bruto
    .split(/[,;\n|]+/)
    .map((c) => somenteDigitos(c))
    .filter((c) => c.length >= 4);
}

export function moduloLiberadoPorCnae(cnaes: string[], modulo: ModuloCnae) {
  return cnaes.some((c) => REGRAS[modulo].prefixos.some((p) => c.startsWith(p)));
}

/** Situação dos módulos opcionais para o usuário logado. */
export function useModulosCnae() {
  const { data, isLoading } = useSessionData();
  const empresa = (data?.empresa ?? null) as {
    cnae?: string | null;
    cnae_secundarios?: string | null;
  } | null;
  const cnaes = cnaesDaEmpresa(empresa);
  return {
    carregando: isLoading,
    cnaes,
    assistencia: moduloLiberadoPorCnae(cnaes, "assistencia"),
    locacao: moduloLiberadoPorCnae(cnaes, "locacao"),
  };
}
