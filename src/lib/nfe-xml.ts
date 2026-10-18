// Leitura do XML da NF-e de entrada (NF-e/NFC-e v4.00), sem serviço externo.

export type NfeXmlItem = {
  seq: number;
  codigo: string;
  codigo_barras: string | null;
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  unidade: string;
  quantidade: number;
  custo_unitario: number;
  total: number;
  /** Lote do fabricante (<rastro><nLote>) e tonalidade/calibre lidos de <infAdProd>. */
  lote: string | null;
  tonalidade: string | null;
  calibre: string | null;
  impostos: NfeXmlImpostosItem;
};

export type NfeXmlImpostosItem = {
  cst: string | null;
  base_icms: number;
  aliquota_icms: number;
  icms: number;
  base_st: number;
  icms_st: number;
  aliquota_ipi: number;
  ipi: number;
  pis: number;
  cofins: number;
};

export type NfeXmlImpostosNota = {
  base_icms: number;
  icms: number;
  base_st: number;
  icms_st: number;
  fcp_st: number;
  ipi: number;
  pis: number;
  cofins: number;
  seguro: number;
  outras: number;
  tributos_aprox: number;
};

export type NfeXmlFornecedor = {
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string | null;
  telefone: string | null;
  email: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
};

export type NfeXmlNota = {
  chave: string | null;
  numero: string | null;
  serie: string | null;
  emissao: string | null;
  natureza: string | null;
  frete: number;
  desconto: number;
  total: number;
  condicao_pagamento: string | null;
  primeiro_vencimento: string | null;
  parcelas: number;
  impostos: NfeXmlImpostosNota;
};

export type NfeXmlLida = {
  nota: NfeXmlNota;
  fornecedor: NfeXmlFornecedor;
  itens: NfeXmlItem[];
  destinatario: { cnpj: string | null; nome: string | null };
};

function texto(el: Element | null | undefined, tag: string): string | null {
  if (!el) return null;
  const found = el.getElementsByTagName(tag);
  for (let i = 0; i < found.length; i += 1) {
    const v = found[i]?.textContent?.trim();
    if (v) return v;
  }
  return null;
}

function numero(el: Element | null | undefined, tag: string): number {
  const v = texto(el, tag);
  if (!v) return 0;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function somenteDigitos(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return d === "" ? null : d;
}

export function lerXmlNfe(conteudo: string): NfeXmlLida {
  const doc = new DOMParser().parseFromString(conteudo, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Arquivo XML inválido.");
  }
  const infNFe = doc.getElementsByTagName("infNFe")[0];
  if (!infNFe) throw new Error("Este arquivo não parece ser um XML de NF-e.");

  const chave = (infNFe.getAttribute("Id") ?? "").replace(/^NFe/, "") || null;
  const ide = infNFe.getElementsByTagName("ide")[0] ?? null;
  const emit = infNFe.getElementsByTagName("emit")[0] ?? null;
  const dest = infNFe.getElementsByTagName("dest")[0] ?? null;
  const total = infNFe.getElementsByTagName("ICMSTot")[0] ?? null;

  const emissaoBruta = texto(ide, "dhEmi") ?? texto(ide, "dEmi");
  const emissao = emissaoBruta ? emissaoBruta.slice(0, 10) || null : null;

  const endEmit = emit?.getElementsByTagName("enderEmit")[0] ?? null;

  const itens: NfeXmlItem[] = [];
  const dets = infNFe.getElementsByTagName("det");
  for (let i = 0; i < dets.length; i += 1) {
    const det = dets[i];
    const prod = det?.getElementsByTagName("prod")[0] ?? null;
    if (!prod) continue;
    const qtd = numero(prod, "qCom");
    const unit = numero(prod, "vUnCom");
    const barras = texto(prod, "cEAN") ?? texto(prod, "cEANTrib");
    itens.push({
      seq: Number(det?.getAttribute("nItem") ?? i + 1),
      codigo: texto(prod, "cProd") ?? "",
      codigo_barras: barras && barras !== "SEM GTIN" ? barras : null,
      descricao: texto(prod, "xProd") ?? "",
      ncm: texto(prod, "NCM"),
      cfop: texto(prod, "CFOP"),
      unidade: (texto(prod, "uCom") ?? "UN").toUpperCase(),
      quantidade: qtd,
      custo_unitario: unit,
      total: numero(prod, "vProd") || Number((qtd * unit).toFixed(2)),
      ...loteDoItem(det ?? null),
      impostos: impostosDoItem(det ?? null),
    });
  }

  // Duplicatas (parcelas da nota)
  const dups = infNFe.getElementsByTagName("dup");
  const vencimentos: string[] = [];
  for (let i = 0; i < dups.length; i += 1) {
    const v = texto(dups[i], "dVenc");
    if (v) vencimentos.push(v.slice(0, 10));
  }
  vencimentos.sort();

  return {
    nota: {
      chave,
      numero: texto(ide, "nNF"),
      serie: texto(ide, "serie"),
      emissao,
      natureza: texto(ide, "natOp"),
      frete: numero(total, "vFrete"),
      desconto: numero(total, "vDesc"),
      total: numero(total, "vNF"),
      condicao_pagamento:
        vencimentos.length > 1 ? `${vencimentos.length}x conforme duplicatas` : null,
      primeiro_vencimento: vencimentos[0] ?? null,
      parcelas: Math.max(1, vencimentos.length),
      impostos: {
        base_icms: numero(total, "vBC"),
        icms: numero(total, "vICMS"),
        base_st: numero(total, "vBCST"),
        icms_st: numero(total, "vST"),
        fcp_st: numero(total, "vFCPST"),
        ipi: numero(total, "vIPI"),
        pis: numero(total, "vPIS"),
        cofins: numero(total, "vCOFINS"),
        seguro: numero(total, "vSeg"),
        outras: numero(total, "vOutro"),
        tributos_aprox: numero(total, "vTotTrib"),
      },
    },
    fornecedor: {
      razao_social: texto(emit, "xNome") ?? "Fornecedor da NF-e",
      nome_fantasia: texto(emit, "xFant"),
      cnpj: texto(emit, "CNPJ") ?? texto(emit, "CPF"),
      telefone: texto(endEmit, "fone"),
      email: texto(emit, "email"),
      cep: texto(endEmit, "CEP"),
      endereco: texto(endEmit, "xLgr"),
      numero: texto(endEmit, "nro"),
      bairro: texto(endEmit, "xBairro"),
      cidade: texto(endEmit, "xMun"),
      estado: texto(endEmit, "UF"),
    },
    destinatario: {
      cnpj: somenteDigitos(texto(dest, "CNPJ") ?? texto(dest, "CPF")),
      nome: texto(dest, "xNome"),
    },
    itens,
  };
}

/** Impostos destacados no item (<imposto>): ICMS, ICMS-ST, IPI, PIS e COFINS. */
export function impostosDoItem(det: Element | null): NfeXmlImpostosItem {
  const imp = det?.getElementsByTagName("imposto")[0] ?? null;
  const icms = imp?.getElementsByTagName("ICMS")[0] ?? null;
  const ipi = imp?.getElementsByTagName("IPI")[0] ?? null;
  const pis = imp?.getElementsByTagName("PIS")[0] ?? null;
  const cofins = imp?.getElementsByTagName("COFINS")[0] ?? null;
  return {
    cst: texto(icms, "CST") ?? texto(icms, "CSOSN"),
    base_icms: numero(icms, "vBC"),
    aliquota_icms: numero(icms, "pICMS"),
    icms: numero(icms, "vICMS"),
    base_st: numero(icms, "vBCST"),
    icms_st: numero(icms, "vICMSST"),
    aliquota_ipi: numero(ipi, "pIPI"),
    ipi: numero(ipi, "vIPI"),
    pis: numero(pis, "vPIS"),
    cofins: numero(cofins, "vCOFINS"),
  };
}

/** Lê lote de <rastro><nLote> (ou "LOTE: X" em infAdProd) e "TONALIDADE/TOM: X", "CALIBRE: X". */
export function loteDoItem(det: Element | null) {
  const rastro = det?.getElementsByTagName("rastro")[0] ?? null;
  const ad = det?.getElementsByTagName("infAdProd")[0]?.textContent ?? "";
  const pega = (re: RegExp) => ad.match(re)?.[1]?.trim() || null;
  return {
    lote:
      rastro?.getElementsByTagName("nLote")[0]?.textContent?.trim() ||
      pega(/lote[:\s]+([\w\-./]+)/i),
    tonalidade: pega(/(?:tonalidade|tom|ton)[:\s.]+([\w-]+)/i),
    calibre: pega(/(?:calibre|cal)[:\s.]+([\w-]+)/i),
  };
}

/**
 * Custo de aquisição por item: o valor dos produtos mais a parte de cada um em ST, IPI, seguro e outras
 * despesas da nota (o que a nota cobra além dos produtos, do frete e do desconto), dividida pelo valor do item.
 * Assim a compra e a conta a pagar fecham com o total da nota.
 */
export function custosComImpostos(
  itens: { quantidade: number; total: number }[],
  nota: { total: number; frete: number; desconto: number },
): number[] {
  const produtos = itens.reduce((s, i) => s + i.total, 0);
  const extra = Math.round((nota.total - produtos - nota.frete + nota.desconto) * 100) / 100;
  if (produtos <= 0 || !(extra > 0) || !nota.total) {
    return itens.map((i) => (i.quantidade > 0 ? i.total / i.quantidade : 0));
  }
  let restante = extra;
  return itens.map((i, idx) => {
    const parte =
      idx === itens.length - 1 ? restante : Math.round((extra * i.total * 100) / produtos) / 100;
    restante = Math.round((restante - parte) * 100) / 100;
    return i.quantidade > 0 ? Number(((i.total + parte) / i.quantidade).toFixed(6)) : 0;
  });
}

export type ComposicaoCusto = {
  produto: number;
  st: number;
  ipi: number;
  frete: number;
  seguro: number;
  outras: number;
  desconto: number;
  creditos: number;
  total: number;
};

/** Impostos que voltam como crédito, conforme o regime da empresa que compra. */
export function impostosRecuperaveis(regime: string | null | undefined) {
  const r = (regime ?? "").toLowerCase();
  if (r.includes("real")) return { icms: true, pis: true, cofins: true };
  if (r.includes("presumido")) return { icms: true, pis: false, cofins: false };
  return { icms: false, pis: false, cofins: false };
}

const c2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Custo de entrada de cada item: produto + ST + IPI + frete + seguro + outras despesas − desconto, com a
 * parte de cada despesa da nota dividida pelo valor do item, menos os créditos recuperáveis do regime.
 * Antes dos créditos, a soma dos itens fecha com o total da nota.
 */
export function custosEntrada(
  itens: { quantidade: number; total: number; impostos?: Partial<NfeXmlImpostosItem> | null }[],
  nota: {
    total: number;
    frete: number;
    desconto: number;
    impostos?: Partial<NfeXmlImpostosNota> | null;
  },
  regime?: string | null,
): { custo_unitario: number; composicao: ComposicaoCusto }[] {
  const produtos = itens.reduce((s, i) => s + i.total, 0);
  const cred = impostosRecuperaveis(regime);
  const seguro = nota.impostos?.seguro ?? 0;
  const outrasNota = nota.impostos?.outras ?? 0;
  const parte = (valor: number, idx: number, acumulado: number[]) => {
    if (produtos <= 0 || !valor) return 0;
    if (idx === itens.length - 1) return c2(valor - acumulado.reduce((s, v) => s + v, 0));
    return c2((valor * (itens[idx]?.total ?? 0)) / produtos);
  };
  const ac = {
    frete: [] as number[],
    seguro: [] as number[],
    outras: [] as number[],
    desconto: [] as number[],
    resto: [] as number[],
  };
  const st = itens.map((i) => c2(i.impostos?.icms_st ?? 0));
  const ipi = itens.map((i) => c2(i.impostos?.ipi ?? 0));
  const conhecidos = st.reduce((s, v) => s + v, 0) + ipi.reduce((s, v) => s + v, 0);
  // o que a nota cobra além do que foi identificado (FCP-ST, ST/IPI sem detalhe no item etc.)
  const resto = nota.total
    ? c2(nota.total - produtos - conhecidos - nota.frete - seguro - outrasNota + nota.desconto)
    : 0;
  return itens.map((i, idx) => {
    const frete = parte(nota.frete, idx, ac.frete);
    ac.frete.push(frete);
    const seg = parte(seguro, idx, ac.seguro);
    ac.seguro.push(seg);
    const out = parte(outrasNota, idx, ac.outras);
    ac.outras.push(out);
    const desc = parte(nota.desconto, idx, ac.desconto);
    ac.desconto.push(desc);
    const r = parte(resto, idx, ac.resto);
    ac.resto.push(r);
    const imp = i.impostos ?? {};
    const creditos = c2(
      (cred.icms ? (imp.icms ?? 0) : 0) +
        (cred.pis ? (imp.pis ?? 0) : 0) +
        (cred.cofins ? (imp.cofins ?? 0) : 0),
    );
    const total = c2(
      i.total + (st[idx] ?? 0) + (ipi[idx] ?? 0) + frete + seg + out + r - desc - creditos,
    );
    return {
      custo_unitario: i.quantidade > 0 ? Number((total / i.quantidade).toFixed(6)) : 0,
      composicao: {
        produto: c2(i.total),
        st: c2((st[idx] ?? 0) + r),
        ipi: ipi[idx] ?? 0,
        frete,
        seguro: seg,
        outras: out,
        desconto: desc,
        creditos,
        total,
      },
    };
  });
}
