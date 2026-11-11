// Parametrização fiscal por NCM (plano em docs/parametrizacao-fiscal.md, PR 6): a sugestão da base na tela Fiscal dos produtos.
// Lógica pura, sem tela nem banco. A base NÃO muda a emissão da nota: a nota lê CFOP, CST/CSOSN, alíquota e origem do produto, e quem
// calcula os impostos são as funções do banco a partir do produto. Então a base chega à nota pelo produto: aqui se calcula o que a base
// sugere para cada produto e quais edições em rascunho isso gera; só o botão Salvar da tela grava, depois de a pessoa revisar.
import { z } from "zod";

import {
  lerSugestaoFiscal,
  ncmDigitos,
  type PerfilSugerido,
  type SugestaoFiscal,
} from "./fiscal-sugestao.ts";
import { crtDoRegime } from "./ibs-cbs.ts";

export const LIMITE_LOTE_FISCAL = 300;

export type RegimeLote = "simples" | "mei" | "normal";
export type ItemLote = { ncm: string; cest: string | null; resultado: SugestaoFiscal };
/** `uf`: a UF da empresa usada nas consultas (venda dentro do estado); nulo = a empresa não tem UF; indefinido = resposta de antes da migração da UF. */
export type LoteSugestoes = {
  regime: RegimeLote;
  uf: string | null | undefined;
  itens: ItemLote[];
};

const loteSchema = z.object({
  regime: z.enum(["simples", "mei", "normal"]),
  uf: z.string().nullable().optional(),
  itens: z.array(
    z.object({ ncm: z.string(), cest: z.string().nullable(), resultado: z.unknown() }),
  ),
});

/** Lê a resposta de fiscal_sugerir_lote; formato inesperado em qualquer item vira nulo. */
export function lerLoteSugestoes(resposta: unknown): LoteSugestoes | null {
  const r = loteSchema.safeParse(resposta);
  if (!r.success) return null;
  const itens: ItemLote[] = [];
  for (const i of r.data.itens) {
    const resultado = lerSugestaoFiscal(i.resultado);
    if (!resultado) return null;
    itens.push({ ncm: i.ncm, cest: i.cest, resultado });
  }
  return { regime: r.data.regime, uf: r.data.uf, itens };
}

const soDigitos = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "");

/** Chave de um produto na resposta: NCM e CEST só com dígitos. */
export const chaveSugestao = (ncm: string | null | undefined, cest: string | null | undefined) =>
  `${soDigitos(ncm)}|${soDigitos(cest)}`;

/** NCMs (com CEST) distintos dos produtos, só os de 8 dígitos, prontos para consultar. */
export function consultasDosProdutos(
  produtos: readonly { ncm: string | null; cest: string | null }[],
): { ncm: string; cest: string | null }[] {
  const vistos = new Map<string, { ncm: string; cest: string | null }>();
  for (const p of produtos) {
    const ncm = ncmDigitos(p.ncm ?? "");
    if (ncm.length !== 8) continue;
    const cest = soDigitos(p.cest) === "" ? null : soDigitos(p.cest);
    const chave = chaveSugestao(ncm, cest);
    if (!vistos.has(chave)) vistos.set(chave, { ncm, cest });
  }
  return [...vistos.values()];
}

/** Divide em lotes do tamanho aceito pelo banco. */
export function emLotesFiscais<T>(itens: readonly T[], tamanho = LIMITE_LOTE_FISCAL): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/** Junta as respostas de vários lotes numa só (o regime é o mesmo da empresa). */
export function juntarLotes(lotes: readonly LoteSugestoes[]): LoteSugestoes | null {
  const primeiro = lotes[0];
  if (!primeiro) return null;
  return { regime: primeiro.regime, uf: primeiro.uf, itens: lotes.flatMap((l) => l.itens) };
}

/**
 * Regime da configuração fiscal da empresa → como o ICMS é informado, pelo MESMO critério da emissão (`crtDoRegime`): Simples Nacional (CRT 1) e
 * MEI (CRT 4) usam CSOSN de 3 dígitos; regime normal (CRT 3) e Simples com excesso de sublimite (CRT 2) usam CST de 2 dígitos. A emissão recusa a mistura.
 */
export function regimeDaConfig(regime: string | null | undefined): RegimeLote {
  const crt = crtDoRegime(regime);
  return crt === 1 ? "simples" : crt === 4 ? "mei" : "normal";
}

/** O ICMS desta empresa é informado por CSOSN (Simples e MEI) em vez de CST? */
export const usaCsosn = (regime: string | null | undefined): boolean =>
  regimeDaConfig(regime) !== "normal";

/** Rótulo do regime para as telas, com o tipo de código de ICMS. */
export function rotuloRegimeIcms(regime: string | null | undefined): string {
  if (regime === "simples_excesso") return "Simples com excesso de sublimite (CST)";
  if (regime === "mei") return "MEI (CSOSN)";
  return usaCsosn(regime) ? "Simples Nacional (CSOSN)" : "Regime normal (CST)";
}

/** Códigos de ICMS que a emissão (icmsDoItem) sabe formatar. Os demais são recusados na sugestão para não gerar nota errada. */
export const ICMS_EMITIDO = {
  csosn: ["101", "102", "103", "300", "400", "500", "900"],
  cst: ["00", "40", "41", "50", "51", "60"],
} as const;

export type CamposProduto = {
  cfop?: string;
  cst_csosn?: string;
  aliquota_icms?: number;
  origem_mercadoria?: string;
};

export type AplicacaoProduto = {
  /** O que a sugestão permite gravar nas colunas do produto. */
  campos: CamposProduto;
  /** Valores sugeridos que NÃO foram aplicados, com o motivo. */
  avisos: string[];
  /** O que a base define mas o produto não guarda (vem da configuração de Impostos da empresa ou do cadastro do produto). */
  somenteConsulta: string[];
};

const SO_CONSULTA: [keyof PerfilSugerido, string][] = [
  ["reducaoBaseIcms", "redução da base do ICMS"],
  ["mvaSt", "MVA-ST"],
  ["cstPis", "CST do PIS"],
  ["aliqPis", "alíquota de PIS"],
  ["cstCofins", "CST do COFINS"],
  ["aliqCofins", "alíquota de COFINS"],
  ["cstIbsCbs", "CST do IBS/CBS"],
  ["cclasstrib", "cClassTrib"],
];

/**
 * Do perfil sugerido para as colunas do produto. Regime normal usa o CST do ICMS; Simples e MEI usam o CSOSN. Só entram valores no
 * formato certo e que a emissão sabe formatar; o resto vira aviso (ou fica só para consulta).
 */
export function camposDoProduto(perfil: PerfilSugerido, regime: RegimeLote): AplicacaoProduto {
  const campos: CamposProduto = {};
  const avisos: string[] = [];

  const cfop = perfil.cfop;
  if (cfop !== undefined) {
    if (typeof cfop === "string" && /^\d{4}$/.test(cfop)) campos.cfop = cfop;
    else avisos.push(`CFOP ${String(cfop)} inválido`);
  }

  const simples = regime !== "normal";
  const rotulo = simples ? "CSOSN" : "CST do ICMS";
  const codigo = simples ? perfil.csosn : perfil.cstIcms;
  const lista: readonly string[] = simples ? ICMS_EMITIDO.csosn : ICMS_EMITIDO.cst;
  if (codigo !== undefined) {
    if (typeof codigo === "string" && lista.includes(codigo)) campos.cst_csosn = codigo;
    else avisos.push(`${rotulo} ${String(codigo)} ainda não é emitido corretamente pelo sistema`);
  } else if ((simples ? perfil.cstIcms : perfil.csosn) !== undefined) {
    avisos.push(
      simples
        ? "A regra define CST do ICMS (regime normal) e não traz CSOSN para o Simples"
        : "A regra define CSOSN (Simples) e não traz CST do ICMS para o regime normal",
    );
  }

  const aliq = perfil.aliqIcms;
  if (typeof aliq === "number" && aliq >= 0 && aliq <= 100) campos.aliquota_icms = aliq;

  const origem = perfil.origem;
  if (typeof origem === "string" && /^[0-8]$/.test(origem)) campos.origem_mercadoria = origem;

  const somenteConsulta = SO_CONSULTA.filter(([k]) => perfil[k] !== undefined).map(([, r]) => r);
  return { campos, avisos, somenteConsulta };
}

export type ProdutoFiscalAtual = {
  cfop: string | null;
  cst_csosn: string | null;
  aliquota_icms: number | string | null;
  origem_mercadoria: string | null;
};
export type EdicaoProduto = CamposProduto;
/** "faltantes" só preenche o que está vazio; "substituir" também troca o que já está preenchido e é diferente. */
export type ModoAplicar = "faltantes" | "substituir";

/** Edições em rascunho que a sugestão gera para um produto. Vazio = nada a mudar. */
export function edicoesDaSugestao(
  atual: ProdutoFiscalAtual,
  campos: CamposProduto,
  modo: ModoAplicar,
): EdicaoProduto {
  const edicao: EdicaoProduto = {};
  const vazioTxt = (v: string | null) => (v ?? "").trim() === "";
  const aliqAtual = Number(atual.aliquota_icms ?? 0) || 0;
  if (
    campos.cfop !== undefined &&
    (modo === "faltantes" ? vazioTxt(atual.cfop) : atual.cfop !== campos.cfop)
  ) {
    edicao.cfop = campos.cfop;
  }
  if (
    campos.cst_csosn !== undefined &&
    (modo === "faltantes" ? vazioTxt(atual.cst_csosn) : atual.cst_csosn !== campos.cst_csosn)
  ) {
    edicao.cst_csosn = campos.cst_csosn;
  }
  if (
    campos.origem_mercadoria !== undefined &&
    (modo === "faltantes"
      ? vazioTxt(atual.origem_mercadoria)
      : atual.origem_mercadoria !== campos.origem_mercadoria)
  ) {
    edicao.origem_mercadoria = campos.origem_mercadoria;
  }
  if (
    campos.aliquota_icms !== undefined &&
    // como "Aplicar padrão": alíquota zero conta como não preenchida
    (modo === "faltantes" ? aliqAtual <= 0 : aliqAtual !== campos.aliquota_icms)
  ) {
    edicao.aliquota_icms = campos.aliquota_icms;
  }
  return edicao;
}

export type ProdutoParaSugestao = ProdutoFiscalAtual & {
  id: string;
  ncm: string | null;
  cest: string | null;
};

export type ResumoLote = {
  consultados: number;
  comRegra: number;
  semRegra: number;
  empate: number;
  ncmInvalido: number;
  /** produtos com regra e ao menos uma edição a fazer */
  comMudanca: number;
  /** produtos com regra mas nada a mudar (já iguais, ou valor que a emissão não sabe formatar) */
  semMudanca: number;
  campos: number;
};

/** A resposta do lote para um produto (pelo NCM e CEST dele), se houver. */
export function sugestaoDoProduto(
  p: { ncm: string | null; cest: string | null },
  lote: LoteSugestoes | null,
): SugestaoFiscal | undefined {
  if (!lote) return undefined;
  const chave = chaveSugestao(p.ncm, p.cest);
  return lote.itens.find((i) => chaveSugestao(i.ncm, i.cest) === chave)?.resultado;
}

/** Edições em rascunho para vários produtos de uma vez e o resumo para a pessoa conferir antes de aplicar. */
export function edicoesDoLote(
  produtos: readonly ProdutoParaSugestao[],
  lote: LoteSugestoes,
  modo: ModoAplicar,
): { edicoes: Record<string, EdicaoProduto>; resumo: ResumoLote } {
  const mapa = new Map(lote.itens.map((i) => [chaveSugestao(i.ncm, i.cest), i.resultado]));
  const edicoes: Record<string, EdicaoProduto> = {};
  const resumo: ResumoLote = {
    consultados: 0,
    comRegra: 0,
    semRegra: 0,
    empate: 0,
    ncmInvalido: 0,
    comMudanca: 0,
    semMudanca: 0,
    campos: 0,
  };
  for (const p of produtos) {
    const s = mapa.get(chaveSugestao(p.ncm, p.cest));
    if (!s) continue;
    resumo.consultados += 1;
    if (s.status === "sem_regra") resumo.semRegra += 1;
    else if (s.status === "empate") resumo.empate += 1;
    else if (s.status === "ncm_invalido") resumo.ncmInvalido += 1;
    else {
      resumo.comRegra += 1;
      const e = edicoesDaSugestao(p, camposDoProduto(s.perfil, lote.regime).campos, modo);
      const n = Object.keys(e).length;
      if (n > 0) {
        edicoes[p.id] = e;
        resumo.comMudanca += 1;
        resumo.campos += n;
      } else resumo.semMudanca += 1;
    }
  }
  return { edicoes, resumo };
}
