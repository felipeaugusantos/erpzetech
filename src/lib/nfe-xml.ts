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
  const emissao = emissaoBruta ? (emissaoBruta.slice(0, 10) || null) : null;

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
