// Empresa de alimentação (restaurante, lanchonete, bar): o menu mostra só o que faz sentido para o ramo.
import { cnaesDaEmpresa } from "./cnae-regras.ts";

/** A empresa é de alimentação quando o ramo é restaurante ou o CNAE principal é do grupo 56. */
export function ehEmpresaAlimentacao(
  empresa?: { ramo_atividade?: string | null; cnae?: string | null } | null,
) {
  if (empresa?.ramo_atividade === "restaurante") return true;
  const principal = cnaesDaEmpresa({ cnae: empresa?.cnae ?? null })[0];
  return Boolean(principal?.startsWith("56"));
}

/** Telas que não fazem sentido para quem só vende comida e bebida. */
export const TELAS_FORA_DA_ALIMENTACAO = [
  // obras e construção
  "/clientes-obras",
  "/obras",
  "/obra-historico",
  "/profissionais",
  "/orcamentos",
  // fábrica sob medida
  "/personalizacao",
  "/producao",
  "/custo-par",
  "/movimento-grade",
  // lotes e tonalidades (piso, tinta)
  "/estoque-lotes",
  "/ajuste-lotes",
  "/lotes-offline",
  // frota própria (o delivery do restaurante tem tela própria)
  "/entregas",
  "/rota",
  "/entregas-motorista",
  "/frota-mapa",
  "/motorista",
  "/veiculos",
  "/motoristas",
  "/importar-cte",
  // venda com vendedor comissionado
  "/vendedores",
  "/comissoes",
  "/relatorio-comissoes",
] as const;

/** Grupos inteiros que somem do menu da empresa de alimentação. */
export const GRUPOS_FORA_DA_ALIMENTACAO = ["Logística"] as const;
