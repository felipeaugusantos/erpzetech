import { calcularAbsoluto } from "./exames.ts";

export type ItemLaudo = {
  nome: string;
  valor: number;
  unidade: string | null;
  minimo: number | null;
  maximo: number | null;
};
export type LaudoPdf = {
  paciente: string;
  especie: string;
  coleta: string;
  emissao?: string | undefined;
  itens: ItemLaudo[];
  avisos: string[];
};
export type CampoLaudo = {
  id: string;
  nome: string;
  unidade: string | null;
  forma: string;
  casas: number | null;
  total_id: string | null;
  pct_id: string | null;
};
export type CorrespondenciaLaudo = { campo: CampoLaudo; item: ItemLaudo };
export const chaveLaudo = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const n = (s: string) => Number(s.trim().replace(/\./g, "").replace(",", "."));
const numero = "[0-9]+(?:[.,][0-9]+)*";
function faixaExplicita(texto: string): { minimo: number | null; maximo: number | null } {
  const faixa = texto.replace(/\|/g, " ").trim().match(new RegExp(`^(${numero})\\s*(?:a|[-–])\\s*(${numero})(?:\\s|$)`, "i"));
  if (!faixa) return { minimo: null, maximo: null };
  const minimo = n(faixa[1] ?? "");
  const maximo = n(faixa[2] ?? "");
  return Number.isFinite(minimo) && Number.isFinite(maximo) && minimo <= maximo
    ? { minimo, maximo } : { minimo: null, maximo: null };
}
const celulas = [
  "METAMIELÓCITOS",
  "BASTONETES",
  "SEGMENTADOS",
  "EOSINÓFILOS",
  "LINFÓCITOS",
  "MONÓCITOS",
  "BASÓFILOS",
];
const nomes: Record<string, string> = {
  hemacias: "Hemácias",
  hemoglobina: "Hemoglobina",
  hematocrito: "Hematócrito",
  vcm: "VCM",
  hcm: "HCM",
  chcm: "CHCM",
  rdw: "RDW",
  "alt (tgp)": "ALT (TGP)",
  creatinina: "Creatinina",
  ureia: "Ureia",
  "fa - fosfatase alcalina": "Fosfatase alcalina",
  albumina: "Albumina",
};

/** LACVET prints labels and units in separate PDF text fragments. */
function lerLacvet(linhas: string[]): LaudoPdf {
  const pacientes = new Set<string>();
  const especies = new Set<string>();
  const itens: ItemLaudo[] = [];
  const avisos = [
    "O cabeçalho informa a data de atendimento, não a data de coleta. Confira e informe a coleta antes de salvar.",
  ];
  let secao = "";
  let analito = "";
  const limpar = (s: string) => s.replace(/[.:]+$/g, "").trim();
  const rotulos: Record<string, string> = {
    ...nomes,
    "v.c.m": "VCM",
    "h.c.m": "HCM",
    "c.h.c.m": "CHCM",
    "proteinas totais": "Proteínas totais",
    "fosfatase alcalina": "Fosfatase alcalina",
  };
  const diferencial = /^(segmentados|bastonetes|eosinofilos|basofilos|linfocitos tipicos|linfocitos atipicos|monocitos|mielocitos|metamielocitos)$/;
  for (const linha of linhas) {
    const p = linha.split("|").map((s) => s.trim());
    for (let i = 0; i < p.length; i++) {
      const rotulo = chaveLaudo(limpar(p[i] ?? ""));
      if (rotulo === "animal") {
        const paciente = p[i + 1];
        if (paciente) pacientes.add(chaveLaudo(paciente));
      }
      if (rotulo === "especie") {
        const especie = chaveLaudo(p[i + 1] ?? "");
        especies.add(/^canin[ao]$/.test(especie) ? "cao" : /^felin[ao]$/.test(especie) ? "gato" : especie);
      }
    }
    const titulo = chaveLaudo(limpar(p.join(" ")));
    if (titulo.startsWith("eritrograma")) { secao = "eritrograma"; continue; }
    if (titulo === "leucograma") { secao = "leucograma"; continue; }
    if (rotulos[titulo]) { analito = rotulos[titulo] ?? ""; secao = "bioquimica"; continue; }
    // Join fragmented names only up to the first numeric column, never values or units.
    const indice = p.findIndex((s) => new RegExp(`^${numero}$`).test(s));
    if (indice < 1) continue;
    const nomeOriginal = limpar(p.slice(0, indice).join(" "));
    const nome = chaveLaudo(nomeOriginal);
    const valor = n(p[indice] ?? "");
    const restante = p.slice(indice + 1);
    if (secao === "leucograma" && (nome === "leucocitos totais" || diferencial.test(nome))) {
      const absoluto = nome === "leucocitos totais" ? valor : n(restante[0] ?? "");
      const referencia = restante.slice(nome === "leucocitos totais" ? 0 : 1).join(" ");
      const faixa = referencia.match(new RegExp(`^(${numero})(?:\\s*a\\s*(${numero}))?\\s*/mm$`));
      if (!faixa || !Number.isFinite(absoluto))
        throw new Error(`Resultado ou referência ilegível de ${nomeOriginal}. Confira o laudo manualmente.`);
      if (nome !== "leucocitos totais")
        itens.push({ nome: `${nomeOriginal} (%)`, valor, unidade: "%", minimo: null, maximo: null });
      itens.push({
        nome: nome === "leucocitos totais" ? "Leucócitos totais" : `${nomeOriginal} (abs.)`,
        valor: absoluto, unidade: "células/mm³", minimo: n(faixa[1] ?? ""), maximo: n(faixa[2] ?? faixa[1] ?? ""),
      });
      continue;
    }
    if (nome === "plaquetas") {
      // This layout explicitly prints /mm³, unlike the older ambiguous report.
      if (restante[0] === "/mm")
        itens.push({ nome: "Plaquetas", valor, unidade: "células/mm³", ...faixaExplicita(restante.slice(1).join(" ")) });
      continue;
    }
    const identificado = secao === "eritrograma" ? rotulos[nome] : /^resultados?$/.test(nome) ? analito : "";
    if (!identificado) continue;
    const unidade = restante[0];
    if (!unidade) throw new Error(`Unidade não identificada de ${identificado}.`);
    itens.push({
      nome: identificado, valor,
      unidade: unidade === "milh/mm" ? "milhões/mm³" : unidade === "U.I./L" ? "U/L" : unidade,
      ...faixaExplicita(restante.slice(1).join(" ")),
    });
  }
  if (pacientes.size !== 1 || especies.size !== 1 || !["cao", "gato"].includes([...especies][0] ?? ""))
    throw new Error("Não foi possível identificar um único paciente e espécie no PDF. Confira o laudo manualmente.");
  const vistos = new Set<string>();
  for (const item of itens) {
    const chave = chaveLaudo(item.nome);
    if (vistos.has(chave)) throw new Error("O PDF contém resultados repetidos. Separe os laudos antes de importar.");
    vistos.add(chave);
    if (!Number.isFinite(item.valor)) throw new Error("Valor ilegível no PDF.");
  }
  if (!itens.length) throw new Error("Não foram reconhecidas tabelas de resultados neste PDF digital.");
  const cabecalho = linhas.find((l) => /^animal[.:]*\s*\|/i.test(l));
  return { paciente: cabecalho?.split("|")[1]?.trim() ?? "", especie: [...especies][0] ?? "", coleta: "", itens, avisos };
}

/** Conservative parser for digital reports with labelled pipe-separated table columns. No inference or diagnosis. */
export function lerLaudoTexto(texto: string): LaudoPdf {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const emissoes = new Set(linhas.flatMap((l) => {
    const m = chaveLaudo(l).match(/(?:data de emissao|emissao do laudo|emitido em|data de liberacao)[.:\s|]*(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? [`${m[3]}-${m[2]}-${m[1]}`] : [];
  }));
  const emissao = emissoes.size === 1 ? [...emissoes][0] : undefined;
  if (linhas.some((l) => /^animal[.:]*\s*\|/i.test(l))) return { ...lerLacvet(linhas), emissao };
  const pacientes = new Set<string>();
  const especies = new Set<string>();
  let coleta = "";
  for (let i = 0; i < linhas.length; i++) {
    const linha = chaveLaudo(linhas[i] ?? "");
    if (linha.startsWith("paciente |")) {
      const nome = (linhas[i + 1] ?? "").split("|")[0]?.trim();
      if (nome) pacientes.add(nome);
    }
    if (linha.includes("raca | data coleta")) {
      const partes = (linhas[i + 1] ?? "").split("|").map((s) => s.trim());
      const raca = chaveLaudo(partes[1] ?? "");
      if (raca.startsWith("felino")) especies.add("gato");
      if (raca.startsWith("canino")) especies.add("cao");
      const d = partes[2]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (d) coleta = `${d[3]}-${d[2]}-${d[1]}`;
    }
  }
  if (pacientes.size !== 1 || especies.size !== 1)
    throw new Error(
      "Não foi possível identificar um único paciente e espécie no PDF. Confira o laudo manualmente.",
    );
  const itens: ItemLaudo[] = [];
  const avisos: string[] = [];
  let leucograma = false;
  let pendente = "";
  for (const linha of linhas) {
    const p = linha.split("|").map((s) => s.trim());
    const nome = chaveLaudo(p[0] ?? "");
    if (nome === "leucograma") {
      leucograma = linha.includes("Valor Abs. Ref.");
      continue;
    }
    if (nome === "plaquetograma") leucograma = false;
    if (leucograma && nome === "leucocitos totais" && p.length === 3) {
      const faixa = p[2]?.match(new RegExp(`^(${numero})\\s*a\\s*(${numero})$`));
      if (faixa && p[1] && new RegExp(`^${numero}$`).test(p[1]))
        itens.push({
          nome: "Leucócitos totais",
          valor: n(p[1]),
          unidade: null,
          minimo: n(faixa[1] ?? ""),
          maximo: n(faixa[2] ?? ""),
        });
      continue;
    }
    if (leucograma && celulas.some((c) => chaveLaudo(c) === nome) && p.length === 5) {
      const faixa = p[4]?.match(new RegExp(`^(${numero})\\s*a\\s*(${numero})$`));
      if (
        faixa &&
        p[1] &&
        p[2] &&
        new RegExp(`^${numero}$`).test(p[1]) &&
        new RegExp(`^${numero}$`).test(p[2])
      ) {
        itens.push({
          nome: `${p[0]} (%)`,
          valor: n(p[1]),
          unidade: "%",
          minimo: null,
          maximo: null,
        });
        itens.push({
          nome: `${p[0]} (abs.)`,
          valor: n(p[2]),
          unidade: null,
          minimo: n(faixa[1] ?? ""),
          maximo: n(faixa[2] ?? ""),
        });
      }
      continue;
    }
    if (nome === "plaquetas") {
      avisos.push(
        "Plaquetas não importadas: resultado e referência estão em escalas diferentes e o laudo não informa a unidade.",
      );
      continue;
    }
    if (
      nomes[nome] ||
      (p.length >= 3 && chaveLaudo(p[1] ?? "") === "resultado") ||
      (p.length >= 3 &&
        /^[A-Za-zÀ-ÿ]/.test(p[0] ?? "") &&
        new RegExp(`^${numero}\\s+`).test(p[1] ?? ""))
    ) {
      pendente = nomes[nome] ?? p[0] ?? "";
      // Headings contain labels, not values: keep the analyte for the next row.
      if (p.length < 3 || chaveLaudo(p[1] ?? "") === "resultado") continue;
    } else if (!pendente || p.length !== 2 || !/^\d/.test(p[0] ?? "")) {
      pendente = "";
      continue;
    }
    const resultado = p.length >= 3 ? p[1] : p[0];
    const match = resultado?.match(new RegExp(`^(${numero})\\s+(.+)$`));
    if (match && pendente)
      itens.push({
        nome: pendente,
        valor: n(match[1] ?? ""),
        unidade: match[2] ?? null,
        ...faixaExplicita(p[p.length - 1] ?? ""),
      });
    pendente = "";
  }
  const vistos = new Set<string>();
  for (const item of itens) {
    const k = chaveLaudo(item.nome);
    if (vistos.has(k))
      throw new Error("O PDF contém resultados repetidos. Separe os laudos antes de importar.");
    vistos.add(k);
    if (!Number.isFinite(item.valor)) throw new Error("Valor ilegível no PDF.");
  }
  if (!itens.length)
    throw new Error("Não foram reconhecidas tabelas de resultados neste PDF digital.");
  return {
    paciente: [...pacientes][0] ?? "",
    especie: [...especies][0] ?? "",
    coleta,
    emissao,
    itens,
    avisos,
  };
}

export function conferirPacienteLaudo(
  laudo: LaudoPdf,
  paciente: { nome: string; especie: string },
): boolean {
  return (
    chaveLaudo(laudo.paciente) === chaveLaudo(paciente.nome) && laudo.especie === paciente.especie
  );
}

export function corresponderLaudo(laudo: LaudoPdf, campos: CampoLaudo[]): CorrespondenciaLaudo[] {
  const saida: CorrespondenciaLaudo[] = [];
  for (const item of laudo.itens) {
    const candidatos = campos.filter((c) => chaveLaudo(c.nome) === chaveLaudo(item.nome));
    const campo = candidatos.length === 1 ? candidatos[0] : undefined;
    if (!campo || !["numero", "calculado"].includes(campo.forma)) continue;
    const unidade = chaveLaudo(campo.unidade ?? "");
    const absoluta = item.minimo !== null && (item.unidade === null || item.nome.endsWith("(abs.)") || item.nome === "Leucócitos totais");
    const compat = absoluta
      ? ["celulas/mm³", "celulas/mm3", "celulas/µl", "celulas/μl"].map(chaveLaudo).includes(unidade)
      : item.unidade === "milhões"
        ? unidade === chaveLaudo("milhões/mm³")
        : chaveLaudo(item.unidade ?? "") === unidade;
    if (!compat) continue;
    saida.push({ campo, item });
  }
  // Calculated counts must agree with the exact formula; never round the PDF to match.
  return saida.filter(({ campo, item }) => {
    if (campo.forma !== "calculado") return true;
    const total = saida.find((s) => s.campo.id === campo.total_id);
    const pct = saida.find((s) => s.campo.id === campo.pct_id);
    if (!total || !pct) return false;
    return calcularAbsoluto(total.item.valor, pct.item.valor, campo.casas) === item.valor;
  });
}
