// Empresa que é só clínica veterinária: o menu esconde o que é de outros ramos (obras, frota própria, vendedor comissionado).
// Estoque e compras ficam: vacinas e medicamentos entram por lote no estoque, e a clínica compra os insumos.
import { cnaesDaEmpresa, semCnpj, type EmpresaModulos } from "./cnae-regras.ts";

/**
 * Liberação explícita de outro módulo desfaz o "só clínica". A empresa é só clínica quando o ramo é clínica, o CNAE principal é de atividades veterinárias (7500) ou, sem CNPJ, a clínica foi
 * escolhida em "Módulos sem CNPJ" sem assistência técnica, locação ou restaurante.
 */
export function ehEmpresaSoClinica(empresa?: EmpresaModulos | null): boolean {
  if (!empresa) return false;
  // liberação explícita da Ze Tech de outro módulo (obras, assistência, locação…) vale mais que o ramo: a empresa não é só clínica
  if ((empresa.modulos_liberados ?? []).some((m) => m !== "clinica" && m !== "petshop"))
    return false;
  if (empresa.ramo_atividade === "clinica") return true;
  if (cnaesDaEmpresa({ cnae: empresa.cnae ?? null })[0]?.startsWith("7500")) return true;
  const escolhidos = empresa.modulos_sem_cnpj ?? [];
  return (
    semCnpj(empresa) &&
    escolhidos.includes("clinica") &&
    !["assistencia", "locacao", "restaurante"].some((m) => escolhidos.includes(m))
  );
}

/** Telas que não fazem sentido para quem só tem clínica. */
export const TELAS_FORA_DA_CLINICA = [
  // obras e construção
  "/clientes-obras",
  "/obras",
  "/obra-historico",
  "/profissionais",
  // fábrica sob medida
  "/personalizacao",
  "/producao",
  "/custo-par",
  "/movimento-grade",
  // frota própria
  "/entregas",
  "/rota",
  "/entregas-motorista",
  "/frota-mapa",
  "/motorista",
  "/veiculos",
  "/motoristas",
  "/importar-cte",
  // estoque sem internet (a clínica tem o próprio trabalho sem internet)
  "/lotes-offline",
  "/conferencia-offline",
  // venda com vendedor comissionado
  "/vendedores",
  "/comissoes",
  "/relatorio-comissoes",
] as const;

/** Grupos inteiros que somem do menu de quem só tem clínica. */
export const GRUPOS_FORA_DA_CLINICA = ["Logística"] as const;

/** Nome da tela de lotes para a clínica: ali ficam os lotes de vacina e medicamento (validade e saldo). */
export const ROTULO_LOTES_CLINICA = "Lotes (vacinas e medicamentos)";
