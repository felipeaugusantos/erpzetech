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
    // A chave pode vir acompanhada do número da nota na coluna seguinte.
    // Capture só os 44 dígitos, sem juntar os números das outras colunas.
    const blocos = linha.match(/(?<!\d)\d(?:[.\-/\s|]*\d){43}(?!\d)/g) ?? [];
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
    ? `${data[3]?.length === 2 ? `20${data[3]}` : data[3]}-${data[2]}-${data[1]}`
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

/** Um PDF pode trazer vários DACTEs (e cada um em duas vias). Devolve um CT-e por chave. */
export function lerDactes(texto: string): CteLido[] {
  const porChave = new Map<string, CteLido>();
  // O PDF.js extrai o título deste documento como "D A C T E".
  const linhas = texto.split("\n");
  const inicios = linhas.flatMap((linha, i) => {
    if (!/\bD\s*A\s*C\s*T\s*E\b/.test(linha)) return [];
    // Preserve o nome da transportadora quando ele vem antes do título.
    const anterior = linhas[i - 1] ?? "";
    return [i > 0 && /\b(?:LTDA|S\.?A\.?|EIRELI|EPP)\b/.test(anterior) ? i - 1 : i];
  });
  const partes = inicios.map((inicio, i) => linhas.slice(inicio, inicios[i + 1]).join("\n"));
  for (const parte of partes) {
    let c: CteLido;
    try { c = lerTextoDacte(parte); } catch { continue; }
    if (!c.chave) continue;
    const ja = porChave.get(c.chave);
    if (ja) ja.nfe_chaves = [...new Set([...ja.nfe_chaves, ...c.nfe_chaves])];
    else porChave.set(c.chave, c);
  }
  return porChave.size ? [...porChave.values()] : [lerTextoDacte(texto)];
}

/** Escolhe o CT-e que transporta a NF-e informada. */
export function cteDaNota(ctes: CteLido[], chaveNfe: string | null | undefined): CteLido {
  const unico = ctes.length === 1 ? ctes[0] : undefined;
  if (unico) return unico;
  const achado = chaveNfe ? ctes.find((c) => c.nfe_chaves.includes(chaveNfe)) : undefined;
  if (achado) return achado;
  throw new Error(`Este arquivo tem ${ctes.length} CT-e (${ctes.map((c) => `nº ${c.numero ?? "—"}`).join(", ")}) e nenhum deles é desta nota.`);
}
