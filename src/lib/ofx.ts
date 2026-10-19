// Leitura de extrato bancário em OFX (versão 1 em SGML e versão 2 em XML), sem dependência de tela.

export type TransacaoOfx = {
  /** Identificador da transação no banco; é a chave para não importar a mesma linha duas vezes. */
  fitid: string;
  /** AAAA-MM-DD */
  data: string;
  /** Com sinal: positivo entra na conta, negativo sai. */
  valor: number;
  descricao: string;
  documento: string | null;
};

export type ContaOfx = { banco: string | null; agencia: string | null; conta: string | null };

export type LeituraOfx = {
  conta: ContaOfx;
  transacoes: TransacaoOfx[];
  erros: string[];
};

/** Arquivos de banco costumam vir em Windows-1252; UTF-8 inválido cai nele. */
export function decodificarOfx(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

function campo(bloco: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, "i").exec(bloco);
  const v = m?.[1]?.trim();
  return v ? v : null;
}

function textoLimpo(valor: string | null) {
  return (valor ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** DTPOSTED: AAAAMMDD[HHMMSS[.mmm][fuso]] → AAAA-MM-DD, ou null se não for uma data real. */
export function dataOfx(bruto: string | null): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(bruto ?? "");
  if (!m) return null;
  const [, a, mes, d] = m;
  const dt = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  if (dt.getUTCFullYear() !== Number(a) || dt.getUTCMonth() !== Number(mes) - 1) return null;
  if (dt.getUTCDate() !== Number(d)) return null;
  return `${a}-${mes}-${d}`;
}

/** TRNAMT: aceita 1234.56, -1234,56 e 1.234,56 (alguns bancos brasileiros usam vírgula). */
export function valorOfx(bruto: string | null): number | null {
  if (!bruto) return null;
  let t = bruto.replace(/\s/g, "");
  if (!/^[+-]?[\d.,]+$/.test(t)) return null;
  const ultimaVirgula = t.lastIndexOf(",");
  const ultimoPonto = t.lastIndexOf(".");
  if (ultimaVirgula > ultimoPonto) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function lerOfx(texto: string): LeituraOfx {
  const erros: string[] = [];
  const transacoes: TransacaoOfx[] = [];
  if (!/<OFX>/i.test(texto) || !/<STMTTRN>/i.test(texto)) {
    return {
      conta: { banco: null, agencia: null, conta: null },
      transacoes,
      erros: ["Este arquivo não parece um extrato OFX (não há lançamentos)."],
    };
  }
  const conta: ContaOfx = {
    banco: campo(texto, "BANKID"),
    agencia: campo(texto, "BRANCHID"),
    conta: campo(texto, "ACCTID"),
  };
  const vistos = new Set<string>();
  const blocos = [...texto.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
  blocos.forEach((b, i) => {
    const bloco = b[1] ?? "";
    const rotulo = `Lançamento ${i + 1}`;
    const data = dataOfx(campo(bloco, "DTPOSTED"));
    const valor = valorOfx(campo(bloco, "TRNAMT"));
    if (!data) return void erros.push(`${rotulo}: data inválida.`);
    if (valor === null) return void erros.push(`${rotulo}: valor inválido.`);
    if (valor === 0) return void erros.push(`${rotulo}: valor zerado.`);
    const fitid = campo(bloco, "FITID");
    if (!fitid) return void erros.push(`${rotulo}: sem identificador (FITID).`);
    if (vistos.has(fitid))
      return void erros.push(`${rotulo}: identificador ${fitid} repetido no arquivo.`);
    vistos.add(fitid);
    const memo = textoLimpo(campo(bloco, "MEMO"));
    const nome = textoLimpo(campo(bloco, "NAME"));
    transacoes.push({
      fitid,
      data,
      valor,
      descricao: (memo || nome || "Lançamento do extrato").slice(0, 200),
      documento: campo(bloco, "CHECKNUM") ?? campo(bloco, "REFNUM"),
    });
  });
  if (blocos.length === 0) erros.push("Nenhum lançamento encontrado no arquivo.");
  return { conta, transacoes, erros };
}

const soDigitos = (v: string | null) => (v ?? "").replace(/\D/g, "").replace(/^0+/, "");

/** Avisa quando o número da conta do arquivo não bate com o da conta escolhida (sem bloquear). */
export function contaPareceOutra(
  arquivo: ContaOfx,
  cadastro: { conta: string | null; conta_digito: string | null },
): boolean {
  const a = soDigitos(arquivo.conta);
  const c = soDigitos(cadastro.conta);
  if (!a || !c) return false;
  const comDigito = soDigitos(`${cadastro.conta ?? ""}${cadastro.conta_digito ?? ""}`);
  return !(a === c || a === comDigito || a.endsWith(c) || c.endsWith(a));
}
