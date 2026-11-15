import { entradaCaixa } from "./financeiro.ts";
import { isoBrasilia } from "./fuso.ts";

export type MovimentoRelatorio = {
  tipo: string;
  valor: number | string;
  forma_pagamento: string | null;
  created_at: string;
  pedido_id?: string | null;
};

export function resumirDiaCaixa(movimentos: readonly MovimentoRelatorio[], dia: string) {
  const lista = movimentos.filter((m) => isoBrasilia(new Date(m.created_at)) === dia);
  const formas = new Map<string, { forma: string; entradas: number; saidas: number }>();
  let entradas = 0,
    saidas = 0,
    abertura = 0,
    vendas = 0;
  const pedidos = new Set<string>();
  for (const m of lista) {
    const valor = Math.round(Number(m.valor) * 100);
    if (m.tipo === "abertura") {
      abertura += valor;
      continue;
    }
    const forma = m.forma_pagamento ?? "dinheiro";
    const linha = formas.get(forma) ?? { forma, entradas: 0, saidas: 0 };
    if (entradaCaixa(m.tipo)) {
      entradas += valor;
      linha.entradas += valor;
    } else {
      saidas += valor;
      linha.saidas += valor;
    }
    if (m.tipo === "venda") {
      vendas += valor;
      if (m.pedido_id) pedidos.add(m.pedido_id);
    }
    formas.set(forma, linha);
  }
  return {
    lista,
    entradas: entradas / 100,
    saidas: saidas / 100,
    abertura: abertura / 100,
    vendas: vendas / 100,
    pedidos: pedidos.size,
    formas: [...formas.values()].map((f) => ({
      ...f,
      entradas: f.entradas / 100,
      saidas: f.saidas / 100,
    })),
  };
}
