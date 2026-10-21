// Reforma Tributária do consumo (NT 2025.002-RTC): IBS, CBS e Imposto Seletivo na NF-e/NFC-e.
// Sem dependência de tela, para os testes rodarem no Node. As tabelas vêm do Informe Técnico (ibs-cbs-tabelas.ts).
import {
  CCLASSTRIB_LINHAS,
  CCREDPRES_LINHAS,
  CST_LINHAS,
  VERSAO_TABELAS_IBS_CBS,
} from "./ibs-cbs-tabelas.ts";

export { VERSAO_TABELAS_IBS_CBS };

export type Classificacao = {
  cst: string;
  cClassTrib: string;
  nome: string;
  tipoAliquota: string;
  pRedIBS: number;
  pRedCBS: number;
  exigeTribRegular: boolean;
  exigeCredPresOper: boolean;
  monofasia: boolean;
  estornoCredito: boolean;
  nfe: boolean;
  nfce: boolean;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
};

export type SituacaoTributaria = {
  cst: string;
  descricao: string;
  grupoIbsCbs: boolean;
  grupoMonofasia: boolean;
  grupoReducao: boolean;
  grupoDiferimento: boolean;
  grupoTransfCredito: boolean;
  grupoCredPresZfm: boolean;
  grupoAjusteCompet: boolean;
  redutorBase: boolean;
};

export const CLASSIFICACOES: readonly Classificacao[] = CCLASSTRIB_LINHAS.map((l) => ({
  cst: l[0],
  cClassTrib: l[1],
  nome: l[2],
  tipoAliquota: l[3],
  pRedIBS: l[4],
  pRedCBS: l[5],
  exigeTribRegular: l[6] === 1,
  exigeCredPresOper: l[7] === 1,
  monofasia: l[8] === 1,
  estornoCredito: l[9] === 1,
  nfe: l[10] === 1,
  nfce: l[11] === 1,
  vigenciaInicio: l[12],
  vigenciaFim: l[13],
}));

export const SITUACOES: readonly SituacaoTributaria[] = CST_LINHAS.map((l) => ({
  cst: l[0],
  descricao: l[1],
  grupoIbsCbs: l[2] === 1,
  grupoMonofasia: l[3] === 1,
  grupoReducao: l[4] === 1,
  grupoDiferimento: l[5] === 1,
  grupoTransfCredito: l[6] === 1,
  grupoCredPresZfm: l[7] === 1,
  grupoAjusteCompet: l[8] === 1,
  redutorBase: l[9] === 1,
}));

export const CREDITOS_PRESUMIDOS = CCREDPRES_LINHAS.map((l) => ({
  cCredPres: l[0],
  descricao: l[1],
  apropriaPorNota: l[2] === 1,
  apropriaPorEvento: l[3] === 1,
  deduzDoIbs: l[4] === 1,
  cClassTribNotaReferenciada: l[5],
}));

/** Tributação integral: o caso comum de venda de mercadoria por contribuinte do regime normal. */
export const TRIBUTACAO_INTEGRAL = { cst: "000", cClassTrib: "000001" } as const;

export const situacaoDoCst = (cst: string) => SITUACOES.find((s) => s.cst === cst) ?? null;
export const classificacaoDe = (cClassTrib: string) =>
  CLASSIFICACOES.find((c) => c.cClassTrib === cClassTrib) ?? null;
export const classificacoesDoCst = (cst: string) => CLASSIFICACOES.filter((c) => c.cst === cst);

// ---------------------------------------------------------------------------------------------
// Alíquotas e prazos

export type AliquotasIbsCbs = { ibsUF: number; ibsMun: number; cbs: number | null };

/**
 * Alíquotas fixadas em lei para o período de transição (LC 214/25, arts. 343, 344 e 346).
 * 2026: CBS 0,9% e IBS 0,1% (estadual). 2027-2028: IBS 0,05% estadual + 0,05% municipal; a CBS passa a ser a
 * alíquota de referência, ainda não publicada (null). Depois de 2028 as alíquotas serão publicadas.
 */
export function aliquotasDoAno(ano: number): AliquotasIbsCbs | null {
  if (ano <= 2026) return { ibsUF: 0.1, ibsMun: 0, cbs: 0.9 };
  if (ano <= 2028) return { ibsUF: 0.05, ibsMun: 0.05, cbs: null };
  return null;
}

export type CrtEmitente = 1 | 2 | 3 | 4;

/** CRT do emitente a partir do regime da configuração fiscal (mesma regra do restante da emissão). */
export function crtDoRegime(regime: string | null | undefined): CrtEmitente {
  if (regime === "simples") return 1;
  if (regime === "mei") return 4;
  return 3;
}

export type ExigenciaIbsCbs = "obrigatorio" | "opcional" | "aguardando_nt";

/**
 * Regime normal (CRT 3): grupo IBS/CBS obrigatório na NF-e em produção desde 03/08/2026.
 * Simples Nacional e MEI: a NT diz que o grupo só passa a valer em 04/01/2027, com orientação em NT futura;
 * até lá o sistema não envia o grupo para eles.
 */
export function exigenciaIbsCbs(crt: CrtEmitente, dataEmissao: string): ExigenciaIbsCbs {
  if (crt === 3) return dataEmissao >= "2026-08-03" ? "obrigatorio" : "opcional";
  return "aguardando_nt";
}

// ---------------------------------------------------------------------------------------------
// Cálculo

const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const aliq = (v: number) => Math.round(v * 10000) / 10000;

export type EntradaItemIbsCbs = {
  cst: string;
  cClassTrib: string;
  /** Soma dos valores que compõem a base (vProd + frete + seguro + outros − desconto − PIS − COFINS − ICMS …). */
  baseCalculo: number;
  ano: number;
};

export type ReducaoAliquota = { pRedAliq: number; pAliqEfet: number };

export type ResultadoItemIbsCbs =
  | { grupo: false; cst: string; cClassTrib: string }
  | {
      grupo: true;
      cst: string;
      cClassTrib: string;
      vBC: number;
      pIBSUF: number;
      redIBSUF: ReducaoAliquota | null;
      vIBSUF: number;
      pIBSMun: number;
      redIBSMun: ReducaoAliquota | null;
      vIBSMun: number;
      vIBS: number;
      pCBS: number;
      redCBS: ReducaoAliquota | null;
      vCBS: number;
    };

/**
 * Por que a combinação CST + cClassTrib ainda não é emitida pelo sistema. Cobre o que o cálculo faz hoje:
 * tributação integral, alíquota reduzida (com percentual de redução da tabela), isenção e imunidade/não incidência.
 * Diferimento, suspensão, monofasia, alíquota fixa, crédito presumido e demais casos entram nas próximas etapas.
 */
export function motivoNaoSuportada(cst: string, cClassTrib: string): string | null {
  const s = situacaoDoCst(cst);
  const c = classificacaoDe(cClassTrib);
  if (!s) return `CST ${cst} não existe na tabela do IBS/CBS.`;
  if (!c) return `Classificação ${cClassTrib} não existe na tabela do IBS/CBS.`;
  if (c.cst !== cst)
    return `A classificação ${cClassTrib} pertence ao CST ${c.cst}, não ao ${cst}.`;
  if (!c.nfe) return `A classificação ${cClassTrib} não pode ser usada em NF-e.`;
  if (!["000", "011", "200", "400", "410"].includes(cst))
    return `CST ${cst} (${s.descricao}) ainda não é calculado pelo sistema.`;
  if (c.exigeTribRegular || c.exigeCredPresOper || c.monofasia || c.estornoCredito)
    return `A classificação ${cClassTrib} exige grupos (tributação regular, crédito presumido ou monofasia) que o sistema ainda não preenche.`;
  if (s.grupoIbsCbs && !["Padrão"].includes(c.tipoAliquota))
    return `A classificação ${cClassTrib} usa alíquota ${c.tipoAliquota.toLowerCase()}, ainda não calculada pelo sistema.`;
  return null;
}

/** Calcula o grupo IBS/CBS de um item (UB12 a UB67). Devolve só CST e cClassTrib quando o CST não leva grupo. */
export function calcularItemIbsCbs(e: EntradaItemIbsCbs): ResultadoItemIbsCbs {
  const motivo = motivoNaoSuportada(e.cst, e.cClassTrib);
  if (motivo) throw new Error(motivo);
  const s = situacaoDoCst(e.cst)!;
  if (!s.grupoIbsCbs) return { grupo: false, cst: e.cst, cClassTrib: e.cClassTrib };
  const base = aliquotasDoAno(e.ano);
  if (!base || base.cbs === null)
    throw new Error(`As alíquotas de IBS e CBS de ${e.ano} ainda não foram publicadas.`);
  const c = classificacaoDe(e.cClassTrib)!;
  const vBC = centavos(e.baseCalculo);

  const parte = (nominal: number, pRed: number) => {
    if (!s.grupoReducao) return { pEfet: nominal, red: null as ReducaoAliquota | null };
    const pEfet = aliq(nominal * (1 - pRed / 100));
    return { pEfet, red: { pRedAliq: aliq(pRed), pAliqEfet: pEfet } };
  };
  const uf = parte(base.ibsUF, c.pRedIBS);
  const mun = parte(base.ibsMun, c.pRedIBS);
  const cbs = parte(base.cbs, c.pRedCBS);
  const vIBSUF = centavos((vBC * uf.pEfet) / 100);
  const vIBSMun = centavos((vBC * mun.pEfet) / 100);
  return {
    grupo: true,
    cst: e.cst,
    cClassTrib: e.cClassTrib,
    vBC,
    pIBSUF: base.ibsUF,
    redIBSUF: uf.red,
    vIBSUF,
    pIBSMun: base.ibsMun,
    redIBSMun: mun.red,
    vIBSMun,
    vIBS: centavos(vIBSUF + vIBSMun),
    pCBS: base.cbs,
    redCBS: cbs.red,
    vCBS: centavos((vBC * cbs.pEfet) / 100),
  };
}

export type TotaisIbsCbs = {
  vBC: number;
  vIBSUF: number;
  vIBSMun: number;
  vIBS: number;
  vCBS: number;
};

/** Totais da NF-e (W35 a W56): a soma, item a item, do que foi informado nos itens. */
export function totaisIbsCbs(itens: readonly ResultadoItemIbsCbs[]): TotaisIbsCbs {
  const t = { vBC: 0, vIBSUF: 0, vIBSMun: 0, vIBS: 0, vCBS: 0 };
  for (const i of itens) {
    if (!i.grupo) continue;
    t.vBC += i.vBC;
    t.vIBSUF += i.vIBSUF;
    t.vIBSMun += i.vIBSMun;
    t.vIBS += i.vIBS;
    t.vCBS += i.vCBS;
  }
  return {
    vBC: centavos(t.vBC),
    vIBSUF: centavos(t.vIBSUF),
    vIBSMun: centavos(t.vIBSMun),
    vIBS: centavos(t.vIBS),
    vCBS: centavos(t.vCBS),
  };
}

// ---------------------------------------------------------------------------------------------
// Montagem do XML/JSON da NF-e

const red = (r: ReducaoAliquota | null) =>
  r ? { gRed: { pRedAliq: r.pRedAliq, pAliqEfet: r.pAliqEfet } } : {};

/** det/imposto/IBSCBS do item, na ordem do leiaute da NT (UB13 a UB67). */
export function grupoIbsCbsDoItem(r: ResultadoItemIbsCbs) {
  if (!r.grupo) return { CST: r.cst, cClassTrib: r.cClassTrib };
  return {
    CST: r.cst,
    cClassTrib: r.cClassTrib,
    gIBSCBS: {
      vBC: r.vBC,
      gIBSUF: { pIBSUF: r.pIBSUF, ...red(r.redIBSUF), vIBSUF: r.vIBSUF },
      gIBSMun: { pIBSMun: r.pIBSMun, ...red(r.redIBSMun), vIBSMun: r.vIBSMun },
      vIBS: r.vIBS,
      gCBS: { pCBS: r.pCBS, ...red(r.redCBS), vCBS: r.vCBS },
    },
  };
}

/** total/IBSCBSTot da NF-e (W34 a W56b). */
export function grupoTotalIbsCbs(t: TotaisIbsCbs) {
  return {
    vBCIBSCBS: t.vBC,
    gIBS: {
      gIBSUF: { vDif: 0, vDevTrib: 0, vIBSUF: t.vIBSUF },
      gIBSMun: { vDif: 0, vDevTrib: 0, vIBSMun: t.vIBSMun },
      vIBS: t.vIBS,
      vCredPres: 0,
      vCredPresCondSus: 0,
    },
    gCBS: { vDif: 0, vDevTrib: 0, vCBS: t.vCBS, vCredPres: 0, vCredPresCondSus: 0 },
  };
}
