/** Leitura do CT-e (conhecimento de transporte) para somar o frete da transportadora ao custo da compra. */
export type CteLido = {
  chave: string | null;
  numero: string | null;
  serie: string | null;
  emissao: string | null; // AAAA-MM-DD
  cnpj: string | null;
  razao_social: string | null;
  cidade: string | null;
  estado: string | null;
  valor: number;
  icms: number;
  nfe_chaves: string[];
};

const valorBR = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

function daChave(chave: string) {
  return {
    cnpj: chave.slice(6, 20),
    serie: String(Number(chave.slice(22, 25))),
    numero: String(Number(chave.slice(25, 34))),
  };
}

/** Lê o XML do CT-e (modelo 57). */
export function lerXmlCte(xml: string): CteLido {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Arquivo XML inválido.");
  const tag = (nome: string, raiz: Document | Element = doc) => raiz.getElementsByTagName(nome)[0] ?? null;
  const txt = (nome: string, raiz: Document | Element = doc) => tag(nome, raiz)?.textContent?.trim() || null;
  const inf = tag("infCte");
  if (!inf) throw new Error("Este XML não é um CT-e.");
  const chave = (inf.getAttribute("Id") ?? "").replace(/\D/g, "") || null;
  const emit = tag("emit");
  const ender = emit ? tag("enderEmit", emit) : null;
  const vPrest = tag("vPrest");
  const icms = tag("vICMS");
  return {
    chave,
    numero: txt("nCT"),
    serie: txt("serie"),
    emissao: (txt("dhEmi") ?? "").slice(0, 10) || null,
    cnpj: emit ? txt("CNPJ", emit) : null,
    razao_social: emit ? txt("xNome", emit) : null,
    cidade: ender ? txt("xMun", ender) : null,
    estado: ender ? txt("UF", ender) : null,
    valor: Number((vPrest ? txt("vTPrest", vPrest) : null) ?? 0),
    icms: Number(icms?.textContent ?? 0),
    nfe_chaves: [...doc.getElementsByTagName("infNFe")]
      .map((n) => txt("chave", n) ?? "")
      .filter((k) => k.length === 44),
  };
}

/** Lê o texto de um DACTE em PDF digital. Confira o resultado: cada transportadora tem um layout. */
export function lerTextoDacte(texto: string): CteLido {
  let chave: string | null = null;
  const nfes = new Set<string>();
  for (const linha of texto.split("\n")) {
    const blocos = linha.match(/[\d][\d.\-/\s]{40,}\d/g) ?? [];
    for (const b of blocos) {
      const d = b.replace(/\D/g, "");
      if (d.length !== 44) continue;
      const modelo = d.slice(20, 22);
      if (modelo === "57" && !chave) chave = d;
      else if (modelo === "55") nfes.add(d);
    }
  }
  const m = (re: RegExp) => texto.match(re)?.[1] ?? null;
  const valor =
    m(/VALOR\s+A\s+RECEBER[^\d]*([\d.]+,\d{2})/i) ??
    m(/VALOR\s+TOTAL\s+DA\s+PRESTA[ÇC][ÃA]O[^\d]*([\d.]+,\d{2})/i) ??
    m(/FRETE\s+TOTAL[^\d]*([\d.]+,\d{2})/i);
  if (!valor) throw new Error("Não achei o valor do frete neste PDF. Use o XML do CT-e.");
  const icms = m(/VALOR\s+ICMS\s*\(R\$\)[^\d]*([\d.]+,\d{2})/i);
  const data = texto.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  const emissao = data
    ? `${data[3]!.length === 2 ? `20${data[3]}` : data[3]}-${data[2]}-${data[1]}`
    : null;
  const razao = texto.match(/([A-Z0-9][A-Z0-9 &.\-]*\b(?:LTDA|S\.?A\.?|EIRELI|EPP))\b/)?.[1]?.trim() ?? null;
  const k = chave ? daChave(chave) : null;
  return {
    chave,
    numero: k?.numero ?? null,
    serie: k?.serie ?? null,
    emissao,
    cnpj: k?.cnpj ?? null,
    razao_social: razao,
    cidade: null,
    estado: null,
    valor: valorBR(valor),
    icms: icms ? valorBR(icms) : 0,
    nfe_chaves: [...nfes],
  };
}

/** Parte do frete de cada item, proporcional ao valor do item. */
export function rateioFrete(totais: number[], frete: number): number[] {
  const soma = totais.reduce((s, t) => s + t, 0);
  if (soma <= 0) return totais.map(() => 0);
  return totais.map((t) => Math.round(((frete * t) / soma) * 100) / 100);
}
