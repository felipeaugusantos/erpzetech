/** Categorias financeiras (receita ou despesa) e o grupo do DRE a que cada uma pertence. */
export type TipoCategoria = "receita" | "despesa";

export const GRUPOS_RECEITA = [
  { value: "operacional", label: "Receita operacional" },
  { value: "financeira", label: "Receita financeira" },
  { value: "fora_dre", label: "Fora do DRE" },
] as const;

export const GRUPOS_DESPESA = [
  { value: "deducao", label: "Dedução da receita (impostos sobre vendas)" },
  { value: "custo", label: "Custo direto" },
  { value: "operacional", label: "Despesa operacional" },
  { value: "financeira", label: "Despesa financeira" },
  { value: "impostos_lucro", label: "Imposto sobre o lucro" },
  { value: "fora_dre", label: "Fora do DRE (estoque, investimento, retirada)" },
] as const;

export const gruposDoTipo = (tipo: TipoCategoria) =>
  tipo === "receita" ? GRUPOS_RECEITA : GRUPOS_DESPESA;

export const labelGrupo = (tipo: TipoCategoria, grupo: string) =>
  gruposDoTipo(tipo).find((g) => g.value === grupo)?.label ?? grupo;

/** O grupo escolhido tem de valer para o tipo (espelha a regra do banco). */
export const grupoValeParaTipo = (tipo: TipoCategoria, grupo: string) =>
  gruposDoTipo(tipo).some((g) => g.value === grupo);

/** Quem cadastra categorias e lê o DRE (espelha as funções do banco). */
export const podeGerirCategorias = (papeis: readonly string[]) =>
  papeis.some((p) => p === "administrador" || p === "gestor" || p === "financeiro");
