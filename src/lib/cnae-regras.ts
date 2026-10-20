// Regras de CNAE sem dependência de tela: ficam à parte para os testes rodarem no Node.
/** Módulos que só ficam disponíveis quando a atividade da empresa permite. */
export type ModuloCnae = "assistencia" | "locacao" | "restaurante" | "petshop" | "clinica";

/** Grupos de CNAE que liberam cada módulo (comparação pelo início do código). */
const REGRAS: Record<ModuloCnae, { prefixos: string[]; exemplos: string[] }> = {
  restaurante: {
    prefixos: ["56"],
    exemplos: [
      "56.11-2 — Restaurantes e similares",
      "56.11-2/03 — Lanchonetes, casas de chá, de sucos e similares",
      "56.12-1 — Serviços ambulantes de alimentação",
      "56.20-1 — Serviços de alimentação para eventos e catering",
    ],
  },
  petshop: {
    // prefixos longos de propósito: 4789 e 9609 sozinhos pegariam outras atividades
    prefixos: ["7500", "4789004", "9609208"],
    exemplos: [
      "75.00-1 — Atividades veterinárias",
      "47.89-0/04 — Comércio varejista de animais vivos e de artigos e alimentos para animais de estimação",
      "96.09-2/08 — Higiene e embelezamento de animais domésticos",
    ],
  },
  clinica: {
    // só atividades veterinárias: o pet shop sozinho não libera prontuário nem vacina
    prefixos: ["7500"],
    exemplos: ["75.00-1 — Atividades veterinárias"],
  },
  assistencia: {
    prefixos: ["95", "3314", "3319", "4321", "4322", "4520", "4543"],
    exemplos: [
      "95.11-8 — Reparação e manutenção de computadores",
      "95.21-5 — Reparação de equipamentos de áudio e vídeo",
      "95.29-1 — Reparação de objetos e equipamentos pessoais e domésticos",
      "33.14-7 — Manutenção e reparação de máquinas e equipamentos",
      "43.21-5 — Instalação e manutenção elétrica (inclui CFTV)",
      "43.22-3 — Instalação de ar-condicionado e ventilação",
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
  restaurante: "Restaurante e lanchonete",
  petshop: "Pet shop e veterinária",
  clinica: "Clínica veterinária",
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

export type EmpresaModulos = {
  cnpj?: string | null;
  cnae?: string | null;
  cnae_secundarios?: string | null;
  ramo_atividade?: string | null;
  modulos_sem_cnpj?: string[] | null;
};

export const semCnpj = (empresa?: EmpresaModulos | null) =>
  somenteDigitos(empresa?.cnpj ?? "").length < 14;

export function moduloLiberadoEmpresa(empresa: EmpresaModulos | null | undefined, modulo: ModuloCnae): boolean {
  if (semCnpj(empresa) && empresa?.modulos_sem_cnpj?.includes(modulo)) return true;
  if (modulo === "petshop" && moduloLiberadoEmpresa(empresa, "clinica")) return true;
  if (modulo === "restaurante" && empresa?.ramo_atividade === "restaurante") return true;
  if (modulo === "clinica" && empresa?.ramo_atividade === "clinica") return true;
  if (modulo === "petshop" && empresa?.ramo_atividade === "petshop") return true;
  return moduloLiberadoPorCnae(cnaesDaEmpresa(empresa), modulo);
}
