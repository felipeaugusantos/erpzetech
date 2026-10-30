// Manufatura (fase 1): contas e regras sem dependência de tela, com a mesma fórmula do banco
// (supabase/migrations/20261203000001_manufatura_fase1.sql e 20261203000002_manufatura_custo_refugo.sql).

import { consumoReal } from "./ficha-tecnica.ts";

const arredonda = (n: number, casas: number) => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Piloto fechado: o módulo só abre por liberação explícita da equipe (nada de CNAE, ramo ou escolha sem CNPJ). */
export function manufaturaLiberadaEmpresa(
  empresa?: { modulos_liberados?: string[] | null } | null,
) {
  return empresa?.modulos_liberados?.includes("manufatura") === true;
}

/** Perfis que mantêm lista de materiais e ordens, e perfis que apontam produção. */
export const PERFIS_GESTAO_MANUFATURA = ["administrador", "gestor"] as const;
export const PERFIS_APONTAMENTO = ["administrador", "gestor", "producao"] as const;

export const temPerfil = (roles: readonly string[], perfis: readonly string[]) =>
  roles.some((r) => perfis.includes(r));

export type SituacaoOrdem = "planejada" | "liberada" | "em_producao" | "concluida" | "cancelada";

export const SITUACAO_ORDEM: Record<SituacaoOrdem, string> = {
  planejada: "Planejada",
  liberada: "Liberada",
  em_producao: "Em produção",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export const SITUACAO_BOM: Record<string, string> = {
  rascunho: "Rascunho",
  ativa: "Ativa",
  obsoleta: "Obsoleta",
};

/** Quantidade por unidade produzida de um item da lista: o item é por receita e a receita rende `rendimento` unidades. */
export function baseDoItem(quantidadePorReceita: number, rendimento: number): number {
  return arredonda(quantidadePorReceita / (rendimento > 0 ? rendimento : 1), 6);
}

/** Necessidade de um insumo para a ordem, com a perda (mesma conta do banco, 3 casas). */
export function necessidadeDoItem(
  base: number,
  quantidadePlanejada: number,
  perdaPercentual: number,
): number {
  return arredonda(consumoReal(base * quantidadePlanejada, perdaPercentual), 3);
}

/** Consumo acumulado esperado depois de produzir `boa` peças boas e `refugo` de refugo. O banco consome a diferença para o já consumido. */
export function consumoAcumulado(
  base: number,
  perdaPercentual: number,
  boa: number,
  refugo: number,
): number {
  const perda = Math.min(Math.max(perdaPercentual, 0), 89.99);
  return arredonda(((base * 100) / (100 - perda)) * (boa + refugo), 3);
}

export type ItemCusto = { quantidadePlanejada: number; custoUnitario: number };

/** Custo padrão da ordem: insumos planejados pelo custo de referência, mais a mão de obra informada. */
export function custoPadraoDaOrdem(itens: ItemCusto[], maoDeObra = 0): number {
  const insumos = itens.reduce((s, i) => s + i.quantidadePlanejada * i.custoUnitario, 0);
  return arredonda(insumos + Math.max(maoDeObra, 0), 2);
}

/** Texto curto de quantidade para as telas (até 3 casas, sem zeros sobrando). */
export function formatarQuantidadeMf(n: number): string {
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/** Chave que repete igual se o envio for repetido; uma nova a cada apontamento digitado. */
export function novaChaveApontamento(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `ap-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export type LinhaItemForm = { insumo_id: string; quantidade: string; perda_percentual: string };

/** Erro de um item do formulário (ou texto vazio se estiver certo), antes de ir ao banco. */
export function erroDoItem(l: LinhaItemForm): string {
  if (!l.insumo_id) return "Escolha o insumo.";
  const q = Number(l.quantidade.replace(",", "."));
  if (!Number.isFinite(q) || q <= 0) return "A quantidade precisa ser maior que zero.";
  const p = Number((l.perda_percentual || "0").replace(",", "."));
  if (!Number.isFinite(p) || p < 0 || p >= 90) return "A perda precisa ficar entre 0 e 90%.";
  return "";
}

/** Itens do formulário no formato que as funções do banco recebem. */
export function itensParaBanco(linhas: LinhaItemForm[]) {
  return linhas.map((l) => ({
    insumo_id: l.insumo_id,
    quantidade: Number(l.quantidade.replace(",", ".")),
    perda_percentual: Number((l.perda_percentual || "0").replace(",", ".")),
  }));
}
