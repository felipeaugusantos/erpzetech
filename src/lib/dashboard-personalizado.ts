// Dashboard personalizado por empresa: a administração liga, desliga e reordena as peças que já existem no dashboard.
// Lógica pura, sem tela nem banco. Não cria cartões novos nem consultas: só escolhe o que mostrar e em que ordem, entre peças
// que o sistema já calcula e que a pessoa já pode ver (as indisponíveis nem entram na lista recebida).
import { z } from "zod";

export type SecaoDashboard = "resumo" | "indicadores" | "paineis";
export type PecaDashboard = { id: string; rotulo: string; secao: SecaoDashboard };

/** Painéis do dashboard que a empresa personaliza: o da clínica e do pet shop e o de vendas (demais empresas). */
export const PAINEL_PET = "pet";
export const PAINEL_VENDAS = "vendas";

/** Catálogo do dashboard da clínica e do pet shop, na ordem padrão do sistema. */
export const PECAS_DASHBOARD_PET: readonly PecaDashboard[] = [
  { id: "atendimentos-hoje", rotulo: "Atendimentos hoje", secao: "indicadores" },
  { id: "faturamento", rotulo: "Faturamento no período", secao: "indicadores" },
  { id: "faltas", rotulo: "Faltas e cancelamentos", secao: "indicadores" },
  { id: "marcados-a-frente", rotulo: "Marcados à frente", secao: "indicadores" },
  { id: "sem-retorno", rotulo: "Clientes sem retorno há 90 dias", secao: "indicadores" },
  { id: "reforcos-vacina", rotulo: "Reforços de vacina", secao: "indicadores" },
  { id: "a-receber", rotulo: "A receber em aberto", secao: "indicadores" },
  { id: "a-pagar", rotulo: "A pagar em aberto", secao: "indicadores" },
  { id: "grafico-atendimentos", rotulo: "Atendimentos concluídos por dia", secao: "paineis" },
  { id: "servicos-top", rotulo: "Serviços que mais faturaram", secao: "paineis" },
  { id: "agenda-hoje", rotulo: "Agenda de hoje", secao: "paineis" },
];

/** Catálogo do dashboard de vendas (empresas que não são clínica nem pet shop), na ordem padrão do sistema. */
export const PECAS_DASHBOARD_VENDAS: readonly PecaDashboard[] = [
  { id: "painel-do-dia", rotulo: "Painel do dia (atalhos e resumo)", secao: "resumo" },
  { id: "pedidos-andamento", rotulo: "Pedidos em andamento", secao: "indicadores" },
  { id: "orcamentos-expirados", rotulo: "Orçamentos expirados", secao: "indicadores" },
  { id: "a-receber", rotulo: "A receber em aberto", secao: "indicadores" },
  { id: "a-pagar", rotulo: "A pagar em aberto", secao: "indicadores" },
  { id: "vence-hoje", rotulo: "Vence hoje", secao: "indicadores" },
  { id: "vence-7-dias", rotulo: "Vence em 7 dias", secao: "indicadores" },
  { id: "entregas-em-rota", rotulo: "Entregas em rota", secao: "indicadores" },
  { id: "valor-estoque", rotulo: "Valor do estoque (custo)", secao: "indicadores" },
  {
    id: "fechamento-clientes",
    rotulo: "Fechamento de clientes (compras marcadas)",
    secao: "paineis",
  },
  { id: "caixa-projetado", rotulo: "Caixa projetado", secao: "paineis" },
  { id: "orcamentos-situacao", rotulo: "Orçamentos por situação", secao: "paineis" },
  { id: "pedidos-etapa", rotulo: "Pedidos por etapa", secao: "paineis" },
  { id: "alertas-vencimento", rotulo: "Alertas de vencimento", secao: "paineis" },
  { id: "pendencias-fiscais", rotulo: "Pendências fiscais", secao: "paineis" },
  { id: "orcamentos-vencidos", rotulo: "Orçamentos vencidos sem resposta", secao: "paineis" },
  { id: "atencao-estoque", rotulo: "Atenção no estoque", secao: "paineis" },
];

/** Catálogo de cada painel (a leitura da configuração descarta ids que o catálogo do painel não conhece). */
export const catalogoDoPainel = (painel: string): readonly PecaDashboard[] =>
  painel === PAINEL_VENDAS ? PECAS_DASHBOARD_VENDAS : PECAS_DASHBOARD_PET;

export const configDashboardSchema = z.object({
  versao: z.literal(1),
  /** ordem das peças (id); as que não estão na lista ficam depois, na ordem do sistema */
  ordem: z.array(z.string().max(40)).max(40).default([]),
  /** peças desligadas */
  ocultos: z.array(z.string().max(40)).max(40).default([]),
});

export type ConfigDashboard = z.infer<typeof configDashboardSchema>;

/**
 * Lê a configuração guardada. Formato inválido vira "sem personalização". Ids que o catálogo não conhece (peça que saiu do
 * sistema) são descartados em vez de invalidar tudo, e repetições são removidas.
 */
export function lerConfigDashboard(
  bruto: unknown,
  catalogo: readonly PecaDashboard[] = PECAS_DASHBOARD_PET,
): ConfigDashboard | null {
  const r = configDashboardSchema.safeParse(bruto);
  if (!r.success) return null;
  const conhecidos = new Set(catalogo.map((p) => p.id));
  const limpa = (lista: string[]) => [...new Set(lista.filter((id) => conhecidos.has(id)))];
  return { versao: 1, ordem: limpa(r.data.ordem), ocultos: limpa(r.data.ocultos) };
}

export type LinhaDashboard = PecaDashboard & { ligado: boolean };

/** Todas as peças disponíveis, na ordem da configuração (as não citadas ficam no fim, na ordem do sistema), com o estado ligado. */
export function montarLinhasDashboard(
  disponiveis: readonly PecaDashboard[],
  config: ConfigDashboard | null | undefined,
): LinhaDashboard[] {
  const ordem = config?.ordem ?? [];
  const ocultos = new Set(config?.ocultos ?? []);
  const porId = new Map(disponiveis.map((p) => [p.id, p]));
  const citadas = ordem.filter((id, i) => porId.has(id) && ordem.indexOf(id) === i);
  const resto = disponiveis.filter((p) => !citadas.includes(p.id));
  return [...citadas.map((id) => porId.get(id) as PecaDashboard), ...resto].map((p) => ({
    ...p,
    ligado: !ocultos.has(p.id),
  }));
}

/** Peças a mostrar, já ligadas e ordenadas. Sem configuração, o dashboard é o padrão do sistema. */
export function aplicarDashboard(
  disponiveis: readonly PecaDashboard[],
  config: ConfigDashboard | null | undefined,
): PecaDashboard[] {
  return montarLinhasDashboard(disponiveis, config)
    .filter((l) => l.ligado)
    .map(({ ligado: _ligado, ...peca }) => peca);
}

export function alternarPecaDashboard(
  linhas: readonly LinhaDashboard[],
  id: string,
): LinhaDashboard[] {
  return linhas.map((l) => (l.id === id ? { ...l, ligado: !l.ligado } : l));
}

/** Sobe ou desce a peça entre as da mesma seção (cartões não trocam de lugar com painéis). */
export function moverPecaDashboard(
  linhas: readonly LinhaDashboard[],
  id: string,
  delta: -1 | 1,
): LinhaDashboard[] {
  const lista = [...linhas];
  const pos = lista.findIndex((l) => l.id === id);
  if (pos < 0) return lista;
  const secao = lista[pos]?.secao;
  let alvo = pos + delta;
  while (alvo >= 0 && alvo < lista.length && lista[alvo]?.secao !== secao) alvo += delta;
  if (alvo < 0 || alvo >= lista.length) return lista;
  const [peca] = lista.splice(pos, 1);
  lista.splice(alvo, 0, peca as LinhaDashboard);
  return lista;
}

/** Configuração mínima do desenho: só o que difere do padrão do sistema entra. */
export function configDasLinhas(
  linhas: readonly LinhaDashboard[],
  disponiveis: readonly PecaDashboard[],
): ConfigDashboard {
  const ordem = linhas.map((l) => l.id);
  const padrao = disponiveis.map((p) => p.id);
  return {
    versao: 1,
    ordem: JSON.stringify(ordem) === JSON.stringify(padrao) ? [] : ordem,
    ocultos: linhas.filter((l) => !l.ligado).map((l) => l.id),
  };
}

/** Assinatura estável, para saber se há alteração a salvar. */
export const assinaturaDashboard = (
  linhas: readonly LinhaDashboard[],
  disponiveis: readonly PecaDashboard[],
) => JSON.stringify(configDasLinhas(linhas, disponiveis));
