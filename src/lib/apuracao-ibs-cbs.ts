// Apuração mensal do IBS e da CBS (informativa): débito das vendas, crédito das compras e saldo, por tributo.
// IBS e CBS são tributos distintos, com apuração separada: um nunca compensa o outro aqui. NÃO inclui a compensação
// com o PIS/COFINS prevista para 2026 nem o crédito do Simples que opta pelo regime regular (decisão do contador), e
// não substitui a apuração oficial. Sem tela nem rede, para os testes rodarem no Node.

const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const valor = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export type NotaApuracao = {
  situacao: string;
  valor_ibs: unknown;
  valor_cbs: unknown;
  ibs_cbs_efeito: string | null | undefined;
};

export type ParIbsCbs = { ibs: number; cbs: number };

export type ApuracaoIbsCbs = {
  /** IBS/CBS destacado nas notas de venda (e complementares/ajustes) autorizadas. */
  debito: ParIbsCbs;
  /** Devoluções de venda autorizadas: reduzem o débito. */
  estornoDebito: ParIbsCbs;
  /** Crédito potencial das compras (só regime regular). */
  credito: ParIbsCbs;
  /** Devoluções de compra autorizadas: reduzem o crédito. */
  estornoCredito: ParIbsCbs;
  debitoLiquido: ParIbsCbs;
  creditoLiquido: ParIbsCbs;
  /** Débito líquido menos crédito líquido: positivo a recolher; negativo, crédito a compensar (decisão do contador). */
  saldo: ParIbsCbs;
  /** Notas autorizadas que entraram na conta (as que levaram o grupo IBS/CBS). */
  notas: number;
};

const par = (): ParIbsCbs => ({ ibs: 0, cbs: 0 });
const arred = (p: ParIbsCbs): ParIbsCbs => ({ ibs: centavos(p.ibs), cbs: centavos(p.cbs) });

/**
 * Apuração do período. Só notas AUTORIZADAS entram (rascunho, rejeitada, em processamento e cancelada ficam fora).
 * `credito` é o crédito potencial das compras já calculado (`somarCreditoCompras`).
 */
export function apurarIbsCbs(e: {
  notas: readonly NotaApuracao[];
  credito: ParIbsCbs;
}): ApuracaoIbsCbs {
  const debito = par();
  const estornoDebito = par();
  const estornoCredito = par();
  let notas = 0;
  for (const n of e.notas) {
    if (n.situacao !== "autorizada") continue;
    const alvo =
      n.ibs_cbs_efeito === "debito"
        ? debito
        : n.ibs_cbs_efeito === "estorno_debito"
          ? estornoDebito
          : n.ibs_cbs_efeito === "estorno_credito"
            ? estornoCredito
            : null;
    if (!alvo) continue;
    alvo.ibs += valor(n.valor_ibs);
    alvo.cbs += valor(n.valor_cbs);
    notas += 1;
  }
  const credito = arred({ ibs: valor(e.credito.ibs), cbs: valor(e.credito.cbs) });
  const d = arred(debito);
  const ed = arred(estornoDebito);
  const ec = arred(estornoCredito);
  const debitoLiquido = arred({ ibs: d.ibs - ed.ibs, cbs: d.cbs - ed.cbs });
  const creditoLiquido = arred({ ibs: credito.ibs - ec.ibs, cbs: credito.cbs - ec.cbs });
  return {
    debito: d,
    estornoDebito: ed,
    credito,
    estornoCredito: ec,
    debitoLiquido,
    creditoLiquido,
    saldo: arred({
      ibs: debitoLiquido.ibs - creditoLiquido.ibs,
      cbs: debitoLiquido.cbs - creditoLiquido.cbs,
    }),
    notas,
  };
}
