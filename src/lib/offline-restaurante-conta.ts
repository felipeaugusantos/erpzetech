import { calcularConta } from "./restaurante.ts";

/** Comanda (salão ou delivery) feita sem internet e guardada no próprio computador. */
export type ItemOffline = {
  cardapio_item_id: string;
  nome: string;
  preco: number;
  quantidade: number;
  observacao?: string;
};

export type ComandaOffline = {
  offline_id: string;
  criada_em: string;
  tipo: "salao" | "delivery";
  mesa_id: string | null;
  mesa_rotulo: string | null;
  cliente_nome: string | null;
  pessoas: number | null;
  taxa_servico: number;
  delivery: {
    cliente: string;
    telefone: string;
    endereco: string;
    bairro: string;
    taxa: number;
    pagamento: string;
  } | null;
  itens: ItemOffline[];
  fechar: null | {
    pagamentos: { forma: string; valor: number }[];
    caixa_id: string | null;
    cobrar_servico: boolean;
  };
  /** recusa do banco ao enviar (fica guardada para a gestão resolver) */
  erro?: string;
};

/** Reenvia a mesma operação, sem alterar itens nem o pagamento já recebido. */
export function prepararReenvio(c: ComandaOffline, caixaId?: string): ComandaOffline {
  const { erro: _erro, ...resto } = c;
  return {
    ...resto,
    fechar: c.fechar ? { ...c.fechar, caixa_id: caixaId ?? c.fechar.caixa_id } : null,
  };
}

/** Não apaga comandas criadas ou corrigidas enquanto uma chamada estava em andamento. */
export function conciliarSincronizacao(
  atuais: ComandaOffline[],
  enviadas: ComandaOffline[],
  restantes: ComandaOffline[],
) {
  return atuais.flatMap((c) => {
    const original = enviadas.find((x) => x.offline_id === c.offline_id);
    if (!original || JSON.stringify(original) !== JSON.stringify(c)) return [c];
    const restante = restantes.find((x) => x.offline_id === c.offline_id);
    return restante ? [restante] : [];
  });
}

export function subtotalOffline(c: Pick<ComandaOffline, "itens">) {
  return c.itens.reduce((s, i) => s + Math.round(i.preco * i.quantidade * 100), 0) / 100;
}

/** Mesma conta do banco: itens + serviço (salão) ou itens + taxa de entrega (delivery). */
export function totalOffline(c: ComandaOffline, cobrarServico = true) {
  const sub = subtotalOffline(c) + (c.tipo === "delivery" ? (c.delivery?.taxa ?? 0) : 0);
  return calcularConta({
    subtotal: sub,
    pessoas: c.pessoas,
    couvertPorPessoa: 0,
    taxaServicoPercentual: c.tipo === "delivery" ? 0 : c.taxa_servico,
    cobrarServico,
    desconto: 0,
  }).total;
}
