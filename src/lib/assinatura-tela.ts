// Tela "Plano e assinatura": leitura do retorno de assinatura_resumo() e contas das faturas. Lógica pura, sem rede nem banco.
export type FaturaDaAssinatura = {
  id: string;
  tipo: string;
  descricao: string;
  valor: number;
  valorPago: number;
  vencimento: string;
  pagoEm: string | null;
  formaPagamento: string | null;
  /** Página de pagamento do gateway (Pix, boleto e cartão). Só https. */
  url: string | null;
  boletoUrl: string | null;
  pixCopiaCola: string | null;
  linhaDigitavel: string | null;
};

export type PlanoDaAssinatura = {
  codigo: string;
  nome: string;
  resumo: string | null;
  valorMensal: number;
  valorFilialExtra: number;
  valorImplantacao: number;
  recursos: string[];
};

export type ResumoAssinatura = {
  cliente: {
    nome: string;
    situacao: string;
    diaVencimento: number;
    filiaisExtras: number;
    testeAte: string | null;
    implantacaoPaga: boolean;
    cobrancaAutomatica: boolean;
  };
  plano: PlanoDaAssinatura | null;
  taxaInicial: { valor: number; rotulo: string };
  faturas: FaturaDaAssinatura[];
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const https = (v: unknown): string | null => {
  const s = txt(v);
  return s && /^https:\/\//i.test(s) ? s : null;
};

/** Lê o retorno de assinatura_resumo(). null = empresa sem assinatura cadastrada ou formato inesperado. */
export function lerResumoAssinatura(dados: unknown): ResumoAssinatura | null {
  const d = obj(dados);
  const c = obj(d?.["cliente"]);
  if (!d || !c || !txt(c["situacao"])) return null;
  const p = obj(d["plano"]);
  const taxa = obj(d["taxa_inicial"]);
  const faturas = Array.isArray(d["faturas"])
    ? d["faturas"].flatMap((x): FaturaDaAssinatura[] => {
        const f = obj(x);
        if (!f || !txt(f["id"]) || !txt(f["vencimento"])) return [];
        return [
          {
            id: String(f["id"]),
            tipo: txt(f["tipo"]) ?? "avulso",
            descricao: txt(f["descricao"]) ?? "Cobrança",
            valor: num(f["valor"]),
            valorPago: num(f["valor_pago"]),
            vencimento: String(f["vencimento"]).slice(0, 10),
            pagoEm: txt(f["pago_em"]),
            formaPagamento: txt(f["forma_pagamento"]),
            url: https(f["url"]),
            boletoUrl: https(f["boleto_url"]),
            pixCopiaCola: txt(f["pix_copia_cola"]),
            linhaDigitavel: txt(f["boleto_linha_digitavel"]),
          },
        ];
      })
    : [];
  return {
    cliente: {
      nome: txt(c["nome"]) ?? "",
      situacao: String(c["situacao"]),
      diaVencimento: num(c["dia_vencimento"]) || 10,
      filiaisExtras: num(c["filiais_extras"]),
      testeAte: txt(c["teste_ate"]),
      implantacaoPaga: c["implantacao_paga"] === true,
      cobrancaAutomatica: c["cobranca_automatica"] === true,
    },
    plano: p
      ? {
          codigo: txt(p["codigo"]) ?? "",
          nome: txt(p["nome"]) ?? "",
          resumo: txt(p["resumo"]),
          valorMensal: num(p["valor_mensal"]),
          valorFilialExtra: num(p["valor_filial_extra"]),
          valorImplantacao: num(p["valor_implantacao"]),
          recursos: Array.isArray(p["recursos"])
            ? p["recursos"].filter((r): r is string => typeof r === "string")
            : [],
        }
      : null,
    taxaInicial: { valor: num(taxa?.["valor"]), rotulo: txt(taxa?.["rotulo"]) ?? "Implantação" },
    faturas,
  };
}

/** Saldo de uma fatura (nunca negativo). */
export function saldoDaFatura(f: Pick<FaturaDaAssinatura, "valor" | "valorPago">): number {
  return Math.max(Math.round((f.valor - f.valorPago) * 100) / 100, 0);
}

export type SituacaoDaFatura = "paga" | "atrasada" | "aberta";

export function situacaoDaFatura(f: FaturaDaAssinatura, hoje: string): SituacaoDaFatura {
  if (saldoDaFatura(f) <= 0) return "paga";
  return f.vencimento < hoje ? "atrasada" : "aberta";
}

/** Totais para os cartões da tela. */
export function totaisDasFaturas(faturas: FaturaDaAssinatura[], hoje: string) {
  let pago = 0;
  let aberto = 0;
  let vencido = 0;
  for (const f of faturas) {
    pago += f.valorPago;
    const falta = saldoDaFatura(f);
    aberto += falta;
    if (falta > 0 && f.vencimento < hoje) vencido += falta;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { pago: r(pago), aberto: r(aberto), vencido: r(vencido) };
}

/** Mensalidade do plano mais as filiais extras. */
export function totalMensal(r: ResumoAssinatura): number {
  return r.plano ? r.plano.valorMensal + r.cliente.filiaisExtras * r.plano.valorFilialExtra : 0;
}
