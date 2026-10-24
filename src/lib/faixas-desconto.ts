// Faixas de desconto: rótulos e a ordem de precedência explicada na tela. A regra de verdade vive no banco
// (desconto_limite_itens); aqui fica só o texto para a tela não divergir do que o servidor aplica.

export const PERFIS_FAIXA = [
  { valor: "administrador", rotulo: "Administrador" },
  { valor: "gestor", rotulo: "Gestor" },
  { valor: "vendedor", rotulo: "Vendedor" },
  { valor: "caixa", rotulo: "Caixa" },
] as const;

export type PerfilFaixa = (typeof PERFIS_FAIXA)[number]["valor"];

export const rotuloPerfil = (perfil: string | null | undefined): string =>
  perfil ? (PERFIS_FAIXA.find((p) => p.valor === perfil)?.rotulo ?? perfil) : "Todos os perfis";

/** "Cimento · Votoran", "Todos os grupos · Votoran", "Todos os produtos". */
export function rotuloAlvo(
  grupo: string | null | undefined,
  marca: string | null | undefined,
): string {
  if (!grupo && !marca) return "Todos os produtos";
  return [grupo ?? "Todos os grupos", marca ? `marca ${marca}` : null].filter(Boolean).join(" · ");
}

/** Pontos de especificidade da faixa, na mesma conta do banco: grupo vale 2, marca 1; perfil desempata. */
export function especificidade(f: {
  perfil: string | null;
  categoria_id: string | null;
  marca: string | null;
}): number {
  return ((f.categoria_id ? 2 : 0) + (f.marca ? 1 : 0)) * 2 + (f.perfil ? 1 : 0);
}
