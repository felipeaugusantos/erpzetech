// Parametrização fiscal por NCM (plano em docs/parametrizacao-fiscal.md, PR 3): leitura e validação da planilha de carga da base
// global. Lógica pura, sem tela nem banco. Roda no navegador para a pessoa corrigir a planilha antes de enviar; o banco confere tudo
// de novo (fiscal_base_publicar), então esta leitura nunca é a única proteção.
import { lerCsvNumerado, normalizar, type ErroImportacao } from "./importacao.ts";
import { mensagemNcmInexistente, ncmNaTabela } from "./ncm.ts";

export const LIMITE_LINHAS_FISCAL = 2000;

/** Ordem das colunas da planilha-modelo. */
export const COLUNAS_FISCAIS = [
  "ncm",
  "cest",
  "operacao",
  "regime",
  "uf_destino",
  "vigencia_inicio",
  "vigencia_fim",
  "perfil",
  "cst_icms",
  "csosn",
  "cfop",
  "aliq_icms",
  "reducao_base_icms",
  "mva_st",
  "cst_pis",
  "aliq_pis",
  "cst_cofins",
  "aliq_cofins",
  "cst_ibs_cbs",
  "cclasstrib",
  "origem",
  "observacao",
] as const;
export type ColunaFiscal = (typeof COLUNAS_FISCAIS)[number];

const OBRIGATORIAS: ColunaFiscal[] = ["ncm", "perfil", "vigencia_inicio"];

/** Nomes aceitos no cabeçalho (depois de normalizar: minúsculas, sem acento, "_" entre palavras). */
const ALIAS: Record<ColunaFiscal, string[]> = {
  ncm: ["ncm", "ncm_prefixo", "prefixo_ncm"],
  cest: ["cest"],
  operacao: ["operacao", "tipo_de_operacao"],
  regime: ["regime", "regime_tributario"],
  uf_destino: ["uf_destino", "uf_de_destino", "uf"],
  vigencia_inicio: ["vigencia_inicio", "inicio_vigencia", "inicio", "vigencia_de", "data_inicio"],
  vigencia_fim: ["vigencia_fim", "fim_vigencia", "fim", "vigencia_ate", "data_fim"],
  perfil: ["perfil", "nome_do_perfil", "perfil_tributario"],
  cst_icms: ["cst_icms"],
  csosn: ["csosn"],
  cfop: ["cfop"],
  aliq_icms: ["aliq_icms", "aliquota_icms", "icms"],
  reducao_base_icms: ["reducao_base_icms", "reducao_base", "reducao_bc"],
  mva_st: ["mva_st", "mva"],
  cst_pis: ["cst_pis"],
  aliq_pis: ["aliq_pis", "aliquota_pis", "pis"],
  cst_cofins: ["cst_cofins"],
  aliq_cofins: ["aliq_cofins", "aliquota_cofins", "cofins"],
  cst_ibs_cbs: ["cst_ibs_cbs", "cst_ibs", "cst_cbs"],
  cclasstrib: ["cclasstrib", "c_class_trib", "classificacao_tributaria"],
  origem: ["origem", "origem_mercadoria"],
  observacao: ["observacao", "obs", "observacoes"],
};

export const UFS_BRASIL = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR",
  "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
]; // prettier-ignore
const UFS = new Set<string>(UFS_BRASIL);

/** Linha pronta para o banco (chaves em snake_case, como fiscal_base_publicar lê). */
export type EnvioFiscal = {
  linha: number;
  ncm: string;
  cest: string | null;
  operacao: string | null;
  regime: string | null;
  uf_destino: string | null;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  perfil: string;
  cst_icms: string | null;
  csosn: string | null;
  cfop: string | null;
  aliq_icms: number | null;
  reducao_base_icms: number | null;
  mva_st: number | null;
  cst_pis: string | null;
  aliq_pis: number | null;
  cst_cofins: string | null;
  aliq_cofins: number | null;
  cst_ibs_cbs: string | null;
  cclasstrib: string | null;
  origem: string | null;
  observacao: string | null;
};

export type LinhaFiscal = {
  /** Número da linha na planilha (a do cabeçalho é a 1). */
  linha: number;
  envio: EnvioFiscal | null;
  erros: string[];
};

export type LeituraFiscal = {
  /** Problema que impede ler a planilha inteira (colunas que faltam, limite de linhas). */
  erroGeral: string | null;
  colunasIgnoradas: string[];
  linhas: LinhaFiscal[];
};

/** Cabeçalho para baixar: só os nomes das colunas (a planilha-modelo nasce vazia). */
export function modeloFiscalCsv(): string {
  return `\uFEFF${COLUNAS_FISCAIS.join(";")}\r\n`;
}

const soDigitos = (t: string) => t.replace(/\D/g, "");

/** Data AAAA-MM-DD ou DD/MM/AAAA (dia e mês com 1 ou 2 dígitos), só se existir no calendário. */
export function lerData(texto: string): string | null {
  const t = texto.trim();
  let a: number, m: number, d: number;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (r) [a, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)))
    [d, m, a] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  const data = new Date(Date.UTC(a, m - 1, d));
  if (data.getUTCFullYear() !== a || data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d)
    return null;
  return `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Número com vírgula ou ponto decimal ("1,65", "1.65", "1,65%"); até 4 casas; fora disso, nulo. */
export function lerDecimal(texto: string): number | null {
  let t = texto.replace(/[%\s]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return null;
  return Number(t);
}

type Parte<T> = { valor: T; erro?: string };

/** Código numérico de tamanho fixo; completa com zeros à esquerda (a planilha costuma comer o "0" de "00" e "01"). */
function codigo(texto: string, tamanho: number, rotulo: string): Parte<string | null> {
  if (texto === "") return { valor: null };
  if (!/^\d+$/.test(texto) || texto.length > tamanho) {
    return { valor: null, erro: `${rotulo} deve ter ${tamanho} dígitos` };
  }
  return { valor: texto.padStart(tamanho, "0") };
}

function aliquota(texto: string, maximo: number, rotulo: string): Parte<number | null> {
  if (texto === "") return { valor: null };
  const n = lerDecimal(texto);
  if (n === null)
    return { valor: null, erro: `${rotulo} inválida (use número com até 4 casas, ex.: 1,65)` };
  if (n > maximo) return { valor: null, erro: `${rotulo} deve estar entre 0 e ${maximo}` };
  return { valor: n };
}

const REGIMES: Record<string, string> = {
  normal: "normal",
  regime_normal: "normal",
  simples: "simples",
  simples_nacional: "simples",
  mei: "mei",
};

/** Critérios de uma regra (a que NCM, CEST, operação, regime e UF ela vale e quando). Vazio nos opcionais = vale para todos. */
export type CriteriosFiscais = {
  ncm: string;
  cest: string | null;
  operacao: string | null;
  regime: string | null;
  uf_destino: string | null;
  vigencia_inicio: string;
  vigencia_fim: string | null;
};

/** Valida só os critérios da regra (usado pela planilha e pelo formulário da empresa). `criterios` é nulo se houver erro. */
export function validarCriteriosFiscais(celulas: Partial<Record<ColunaFiscal, string>>): {
  erros: string[];
  criterios: CriteriosFiscais | null;
} {
  const erros: string[] = [];
  const c = (k: ColunaFiscal) => (celulas[k] ?? "").trim();
  let ncm = soDigitos(c("ncm"));
  if (!/^(\d{2}|\d{4}|\d{6}|\d{8})$/.test(ncm)) {
    erros.push(
      ncm.length % 2 === 1 && ncm.length > 0
        ? "NCM com quantidade ímpar de dígitos: a planilha provavelmente tirou o zero à esquerda (ex.: 01012100). Formate a coluna como texto"
        : "NCM deve ter 2, 4, 6 ou 8 dígitos",
    );
    ncm = "";
  } else if (!ncmNaTabela(ncm)) {
    // existe no formato, mas não na Tabela NCM vigente: dígito trocado ou código inventado
    erros.push(mensagemNcmInexistente(ncm));
    ncm = "";
  }

  let cest: string | null = null;
  if (c("cest") !== "") {
    const d = soDigitos(c("cest"));
    if (d.length >= 6 && d.length <= 7) cest = d.padStart(7, "0");
    else erros.push("CEST deve ter 7 dígitos");
  }

  let operacao: string | null = null;
  if (c("operacao") !== "") {
    const o = normalizar(c("operacao"));
    if (/^[a-z_]{1,30}$/.test(o)) operacao = o;
    else erros.push("Operação inválida (use só letras, ex.: venda, devolucao)");
  }

  let regime: string | null = null;
  if (c("regime") !== "") {
    regime = REGIMES[normalizar(c("regime"))] ?? null;
    if (regime === null) erros.push("Regime deve ser normal, simples ou mei");
  }

  let uf: string | null = null;
  if (c("uf_destino") !== "") {
    const u = c("uf_destino").toUpperCase();
    if (UFS.has(u)) uf = u;
    else erros.push("UF de destino inválida");
  }

  const inicio = c("vigencia_inicio") === "" ? null : lerData(c("vigencia_inicio"));
  if (inicio === null) {
    erros.push(
      c("vigencia_inicio") === ""
        ? "Informe o início da vigência"
        : "Início da vigência inválido (use AAAA-MM-DD ou DD/MM/AAAA)",
    );
  }
  let fim: string | null = null;
  if (c("vigencia_fim") !== "") {
    fim = lerData(c("vigencia_fim"));
    if (fim === null) erros.push("Fim da vigência inválido (use AAAA-MM-DD ou DD/MM/AAAA)");
    else if (inicio !== null && fim < inicio)
      erros.push("O fim da vigência não pode ser anterior ao início");
  }
  if (erros.length > 0 || inicio === null) return { erros, criterios: null };
  return {
    erros,
    criterios: {
      ncm,
      cest,
      operacao,
      regime,
      uf_destino: uf,
      vigencia_inicio: inicio,
      vigencia_fim: fim,
    },
  };
}

/** Valida uma linha (já separada por coluna) e devolve o envio ou os erros. */
export function validarLinhaFiscal(
  celulas: Partial<Record<ColunaFiscal, string>>,
  linha: number,
): LinhaFiscal {
  const erros: string[] = [];
  const c = (k: ColunaFiscal) => (celulas[k] ?? "").trim();
  const exige = <T>(p: Parte<T>): T => {
    if (p.erro) erros.push(p.erro);
    return p.valor;
  };

  const crit = validarCriteriosFiscais(celulas);
  erros.push(...crit.erros);

  const perfil = c("perfil").replace(/\s+/g, " ");
  if (perfil.length < 1 || perfil.length > 120)
    erros.push("Informe o nome do perfil (até 120 caracteres)");

  const cstIcms = exige(codigo(c("cst_icms"), 2, "CST do ICMS"));
  const csosn = exige(codigo(c("csosn"), 3, "CSOSN"));
  let cfop: string | null = null;
  if (c("cfop") !== "") {
    if (/^\d{4}$/.test(c("cfop"))) cfop = c("cfop");
    else erros.push("CFOP deve ter 4 dígitos");
  }
  const aliqIcms = exige(aliquota(c("aliq_icms"), 100, "Alíquota de ICMS"));
  const reducao = exige(aliquota(c("reducao_base_icms"), 100, "Redução da base do ICMS"));
  const mva = exige(aliquota(c("mva_st"), 1000, "MVA"));
  const cstPis = exige(codigo(c("cst_pis"), 2, "CST do PIS"));
  const aliqPis = exige(aliquota(c("aliq_pis"), 100, "Alíquota de PIS"));
  const cstCofins = exige(codigo(c("cst_cofins"), 2, "CST do COFINS"));
  const aliqCofins = exige(aliquota(c("aliq_cofins"), 100, "Alíquota de COFINS"));
  const cstIbs = exige(codigo(c("cst_ibs_cbs"), 3, "CST do IBS/CBS"));
  const cclasstrib = exige(codigo(c("cclasstrib"), 6, "cClassTrib"));
  let origem: string | null = null;
  if (c("origem") !== "") {
    if (/^[0-8]$/.test(c("origem"))) origem = c("origem");
    else erros.push("Origem deve ser um dígito de 0 a 8");
  }
  const observacao = c("observacao") === "" ? null : c("observacao");
  if (observacao !== null && observacao.length > 500)
    erros.push("Observação com mais de 500 caracteres");

  const campos = [
    cstIcms,
    csosn,
    cfop,
    aliqIcms,
    reducao,
    mva,
    cstPis,
    aliqPis,
    cstCofins,
    aliqCofins,
    cstIbs,
    cclasstrib,
    origem,
  ];
  const temTributo = campos.some((v) => v !== null);
  const algumTextoTributo = (
    [
      "cst_icms",
      "csosn",
      "cfop",
      "aliq_icms",
      "reducao_base_icms",
      "mva_st",
      "cst_pis",
      "aliq_pis",
      "cst_cofins",
      "aliq_cofins",
      "cst_ibs_cbs",
      "cclasstrib",
      "origem",
    ] as const
  ).some((k) => c(k) !== "");
  if (!temTributo && !algumTextoTributo) erros.push("Informe ao menos um campo de tributação");

  if (erros.length > 0 || crit.criterios === null) return { linha, envio: null, erros };
  return {
    linha,
    erros,
    envio: {
      linha,
      ...crit.criterios,
      perfil,
      cst_icms: cstIcms,
      csosn,
      cfop,
      aliq_icms: aliqIcms,
      reducao_base_icms: reducao,
      mva_st: mva,
      cst_pis: cstPis,
      aliq_pis: aliqPis,
      cst_cofins: cstCofins,
      aliq_cofins: aliqCofins,
      cst_ibs_cbs: cstIbs,
      cclasstrib,
      origem,
      observacao,
    },
  };
}

const CAMPOS_PERFIL = [
  "cst_icms", "csosn", "cfop", "aliq_icms", "reducao_base_icms", "mva_st", "cst_pis", "aliq_pis", "cst_cofins",
  "aliq_cofins", "cst_ibs_cbs", "cclasstrib", "origem",
] as const; // prettier-ignore

const chaveRegra = (e: EnvioFiscal) =>
  [e.ncm, e.cest ?? "", e.operacao ?? "", e.regime ?? "", e.uf_destino ?? ""].join("|");
const assinaturaPerfil = (e: EnvioFiscal) => CAMPOS_PERFIL.map((k) => String(e[k] ?? "")).join("|");

/** Lê o texto da planilha (CSV) e valida cada linha e as repetições entre linhas. */
export function lerPlanilhaFiscal(texto: string): LeituraFiscal {
  const [primeiro, ...dados] = lerCsvNumerado(texto);
  const vazio = (erroGeral: string): LeituraFiscal => ({
    erroGeral,
    colunasIgnoradas: [],
    linhas: [],
  });
  if (!primeiro) return vazio("A planilha está vazia.");

  const cabecalho = primeiro.celulas.map(normalizar);
  const indice = new Map<ColunaFiscal, number>();
  const ignoradas: string[] = [];
  cabecalho.forEach((nome, i) => {
    const coluna = COLUNAS_FISCAIS.find((k) => ALIAS[k].includes(nome));
    if (coluna && !indice.has(coluna)) indice.set(coluna, i);
    else if (nome !== "") ignoradas.push(primeiro.celulas[i] ?? nome);
  });
  const faltam = OBRIGATORIAS.filter((k) => !indice.has(k));
  if (faltam.length > 0) {
    return vazio(
      `Faltam as colunas obrigatórias: ${faltam.join(", ")}. Colunas encontradas: ${primeiro.celulas.filter(Boolean).join(", ") || "nenhuma"}.`,
    );
  }
  if (dados.length === 0)
    return vazio("A planilha tem só o cabeçalho: preencha ao menos uma linha.");
  if (dados.length > LIMITE_LINHAS_FISCAL) {
    return vazio(
      `A planilha tem ${dados.length} linhas; o limite é ${LIMITE_LINHAS_FISCAL} por carga.`,
    );
  }

  const linhas = dados.map((r) => {
    const celulas: Partial<Record<ColunaFiscal, string>> = {};
    for (const [coluna, i] of indice) celulas[coluna] = r.celulas[i] ?? "";
    return validarLinhaFiscal(celulas, r.numero);
  });

  // repetições entre linhas: a mesma regra duas vezes, ou o mesmo nome de perfil com valores diferentes
  const regras = new Map<string, number>();
  const perfis = new Map<string, { linha: number; assinatura: string }>();
  for (const l of linhas) {
    if (!l.envio) continue;
    const chave = chaveRegra(l.envio);
    const anterior = regras.get(chave);
    if (anterior !== undefined) {
      l.erros.push(`A mesma regra já aparece na linha ${anterior}; envie uma versão por carga`);
    } else regras.set(chave, l.linha);
    const nome = l.envio.perfil.toLowerCase();
    const assinatura = assinaturaPerfil(l.envio);
    const visto = perfis.get(nome);
    if (visto && visto.assinatura !== assinatura) {
      l.erros.push(
        `O perfil "${l.envio.perfil}" tem outros valores na linha ${visto.linha}; use outro nome`,
      );
    } else if (!visto) perfis.set(nome, { linha: l.linha, assinatura });
    if (l.erros.length > 0) l.envio = null;
  }
  return { erroGeral: null, colunasIgnoradas: ignoradas, linhas };
}

/** Todos os erros da leitura como lista linha + motivo (para mostrar e baixar em CSV). */
export function errosFiscais(l: LeituraFiscal): ErroImportacao[] {
  return l.linhas.flatMap((x) => x.erros.map((mensagem) => ({ linha: x.linha, mensagem })));
}

/** Linhas válidas, prontas para enviar. Só use quando não houver erro nenhum (a carga é tudo ou nada). */
export function paraEnvioFiscal(l: LeituraFiscal): EnvioFiscal[] {
  return l.linhas.flatMap((x) => (x.envio ? [x.envio] : []));
}

export type AcaoCarga = "nova" | "nova_versao" | "igual" | "erro";

/** Retorno de fiscal_base_publicar. */
export type ResultadoCargaFiscal = {
  publicado: boolean;
  resumo: { total: number; novas: number; novasVersoes: number; iguais: number; erros: number };
  linhas: {
    linha: number;
    acao: AcaoCarga;
    versao?: number;
    regraId?: string | null;
    perfil?: string;
    motivo?: string;
  }[];
};

export const ROTULO_ACAO: Record<AcaoCarga, string> = {
  nova: "Nova regra",
  nova_versao: "Nova versão",
  igual: "Sem mudança",
  erro: "Erro",
};
