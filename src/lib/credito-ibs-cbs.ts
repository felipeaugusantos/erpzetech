// Crédito POTENCIAL de IBS/CBS das compras (Reforma Tributária). Só registra o que a NF-e de entrada destacou e que
// pode virar crédito para quem está no regime regular; NÃO muda o custo do produto (o IBS/CBS vem por fora do preço)
// e NÃO é a apuração: a compensação com o débito das vendas e com o PIS/COFINS de 2026 é decisão do contador.
// Sem tela nem rede, para os testes rodarem no Node.

const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const valor = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Quem pode ter crédito: só o regime regular do IBS/CBS (Lucro Presumido e Lucro Real, CRT 3). Simples Nacional,
 * excesso de sublimite e MEI não creditam por este caminho (a opção pelo regime regular do IBS/CBS não é modelada
 * ainda). Regime desconhecido não credita.
 */
export function direitoCreditoIbsCbs(regime: string | null | undefined): boolean {
  const r = (regime ?? "").toLowerCase();
  return r === "presumido" || r === "real";
}

export type CreditoCompra = {
  /** O regime da empresa dá direito ao crédito. */
  disponivel: boolean;
  ibs: number;
  cbs: number;
  total: number;
};

/**
 * Crédito potencial de uma compra a partir do total IBS/CBS guardado da NF-e de entrada (`nfe_impostos.ibs_cbs`).
 * Só entram IBS e CBS destacados; o crédito presumido que a nota informa à parte não é somado.
 */
export function creditoPotencialDaCompra(
  ibsCbs: unknown,
  regime: string | null | undefined,
): CreditoCompra {
  const disponivel = direitoCreditoIbsCbs(regime);
  const o = ibsCbs && typeof ibsCbs === "object" ? (ibsCbs as Record<string, unknown>) : null;
  if (!disponivel || !o) return { disponivel, ibs: 0, cbs: 0, total: 0 };
  const ibs = centavos(valor(o["ibs"]));
  const cbs = centavos(valor(o["cbs"]));
  return { disponivel, ibs, cbs, total: centavos(ibs + cbs) };
}

/** Soma o crédito potencial de várias compras. Compra cancelada ou rascunho não entra. */
export function somarCreditoCompras(
  compras: readonly { situacao: string; nfe_impostos: unknown }[],
  regime: string | null | undefined,
): CreditoCompra & { compras: number } {
  let ibs = 0;
  let cbs = 0;
  let n = 0;
  for (const c of compras) {
    if (c.situacao === "cancelado" || c.situacao === "rascunho") continue;
    const imp =
      c.nfe_impostos && typeof c.nfe_impostos === "object"
        ? (c.nfe_impostos as Record<string, unknown>)
        : null;
    const cr = creditoPotencialDaCompra(imp?.["ibs_cbs"], regime);
    if (cr.total > 0) n += 1;
    ibs += cr.ibs;
    cbs += cr.cbs;
  }
  return {
    disponivel: direitoCreditoIbsCbs(regime),
    ibs: centavos(ibs),
    cbs: centavos(cbs),
    total: centavos(ibs + cbs),
    compras: n,
  };
}

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Texto para a tela: o que o IBS/CBS destacado na compra significa para o regime da empresa. */
export function textoCreditoIbsCbs(c: CreditoCompra): string {
  if (!c.disponivel) {
    return "O regime da empresa não credita IBS/CBS por este caminho: o valor é só informativo e não muda o custo.";
  }
  if (c.total <= 0) return "Sem IBS/CBS a creditar nesta compra.";
  return `Crédito potencial de IBS/CBS (regime regular): IBS ${reais(c.ibs)} · CBS ${reais(c.cbs)}. Não muda o custo do produto; a compensação com o débito das vendas é decisão do contador.`;
}
