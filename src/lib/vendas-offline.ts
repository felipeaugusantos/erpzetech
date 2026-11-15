export type VendaPendente = {
  id: string;
  em: string;
  total: number;
  recebido?: number;
  troco?: number;
  params: Record<string, unknown>;
  erro?: string | undefined;
};

/** Remove somente envios confirmados, preservando vendas feitas durante a sincronização. */
export function conciliarVendas<T extends VendaPendente>(atual: T[], enviadas: T[], restantes: T[]): T[] {
  const lote = new Map(enviadas.map((v) => [v.id, v]));
  const retidas = new Map(restantes.map((v) => [v.id, v]));
  return atual.flatMap((v) => {
    const original = lote.get(v.id);
    if (!original || JSON.stringify(original) !== JSON.stringify(v)) return [v];
    const restante = retidas.get(v.id);
    return restante ? [restante] : [];
  });
}

export function saldoAposFila(saldo: number, produto: string, deposito: string, fila: VendaPendente[]) {
  return Math.max(0, saldo - fila.reduce((s, v) => {
    if (v.params['p_deposito_id'] !== deposito) return s;
    const itens = v.params['p_itens'] as { produto_id: string; quantidade: number }[];
    return s + itens.filter((i) => i.produto_id === produto).reduce((q, i) => q + Number(i.quantidade), 0);
  }, 0));
}

export function chaveFilaPdv(usuario: string, empresa: string) {
  return `zt-pdv-fila-${usuario}-${empresa}`;
}