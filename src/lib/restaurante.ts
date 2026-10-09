// Regras do restaurante usadas pelas telas. As regras de verdade ficam no banco (RPCs restaurante_*);
// aqui ficam só as contas de pré-visualização e os rótulos, para a tela não divergir do que o banco aceita.

const PERFIS_SALAO = ["garcom", "cozinha"];

/** Perfil do salão puro: só garçom e/ou cozinha. Quem acumula outro papel usa o sistema inteiro. */
export function ehSalaoRestrito(roles: readonly string[]): boolean {
  return (
    roles.some((r) => PERFIS_SALAO.includes(r)) && roles.every((r) => PERFIS_SALAO.includes(r))
  );
}

/** Quem pode cadastrar cardápio e mesas, dar desconto e cancelar item já enviado. */
export const ehGestaoSalao = (roles: readonly string[]) =>
  roles.some((r) => r === "administrador" || r === "gestor");

/** Quem recebe a conta (precisa ler os caixas abertos). */
export const recebeConta = (roles: readonly string[]) =>
  roles.some((r) => ["administrador", "gestor", "caixa"].includes(r));

export type SituacaoItem =
  "pendente" | "enviado" | "preparando" | "pronto" | "entregue" | "cancelado";

export const ROTULO_SITUACAO_ITEM: Record<SituacaoItem, string> = {
  pendente: "Não enviado",
  enviado: "Na fila da cozinha",
  preparando: "Preparando",
  pronto: "Pronto para servir",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export const ROTULO_ESTACAO: Record<string, string> = {
  cozinha: "Cozinha",
  bar: "Bar",
  nenhuma: "Pronto para servir",
};

/** Próximo passo do preparo, para o botão da cozinha. */
export function proximoPreparo(situacao: string): { para: SituacaoItem; rotulo: string } | null {
  if (situacao === "enviado") return { para: "preparando", rotulo: "Iniciar preparo" };
  if (situacao === "preparando") return { para: "pronto", rotulo: "Marcar pronto" };
  return null;
}

export type ContaEntrada = {
  subtotal: number;
  pessoas: number | null;
  couvertPorPessoa: number;
  taxaServicoPercentual: number;
  cobrarServico: boolean;
  desconto: number;
};

const arredonda = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Mesma conta do banco (restaurante_fechar_comanda). */
export function calcularConta(e: ContaEntrada) {
  const couvert = arredonda((e.pessoas ?? 0) * e.couvertPorPessoa);
  const servico = e.cobrarServico ? arredonda((e.subtotal * e.taxaServicoPercentual) / 100) : 0;
  const bruto = arredonda(e.subtotal + couvert + servico);
  const desconto = Math.max(e.desconto || 0, 0);
  // o banco recusa desconto acima do total da conta: a tela avisa em vez de fechar em silêncio
  const descontoExcede = desconto > bruto;
  const total = arredonda(bruto - Math.min(desconto, bruto));
  return {
    subtotal: arredonda(e.subtotal),
    couvert,
    servico,
    bruto,
    desconto,
    descontoExcede,
    total,
  };
}

/** Divide o total igualmente entre as pessoas; a última recebe a diferença dos centavos. */
export function dividirConta(total: number, partes: number): number[] {
  const n = Math.max(Math.floor(partes), 1);
  const base = Math.floor((total * 100) / n) / 100;
  const lista = Array.from({ length: n }, () => base);
  lista[n - 1] = arredonda(total - base * (n - 1));
  return lista;
}

export type OpcaoGrupo = { id: string; grupo_id: string };
export type Grupo = { id: string; nome: string; obrigatorio: boolean; max_escolhas: number };

/** Confere as escolhas de opções antes de lançar o item (o banco confere de novo). */
export function validarOpcoes(
  grupos: Grupo[],
  opcoes: OpcaoGrupo[],
  escolhidas: string[],
): string | null {
  for (const g of grupos) {
    const n = opcoes.filter((o) => o.grupo_id === g.id && escolhidas.includes(o.id)).length;
    if (g.obrigatorio && n === 0) return `Escolha uma opção em "${g.nome}"`;
    if (n > g.max_escolhas)
      return g.max_escolhas === 1
        ? `Escolha só uma opção em "${g.nome}"`
        : `Escolha no máximo ${g.max_escolhas} opções em "${g.nome}"`;
  }
  return null;
}

/** Minutos desde um instante, para o tempo de espera na cozinha. */
export function minutosDesde(iso: string | null | undefined, agora: Date = new Date()): number {
  if (!iso) return 0;
  return Math.max(Math.floor((agora.getTime() - new Date(iso).getTime()) / 60000), 0);
}
