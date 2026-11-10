// Parametrização fiscal por NCM (plano em docs/parametrizacao-fiscal.md, PR 4): a sugestão que o cadastro de produtos mostra a partir de
// fiscal_sugerir. Lógica pura, sem tela nem banco. É só sugestão: nada aqui grava; a pessoa confirma o que quiser aplicar.
import { z } from "zod";

import { TRIBUTACAO_INTEGRAL, motivoNaoSuportada } from "./ibs-cbs.ts";
import { CAMPOS_FISCAIS, type CampoFiscal } from "./fiscal-regras.ts";

export type PerfilSugerido = Partial<Record<CampoFiscal, string | number>>;
export type OrigemRegraSugerida = "empresa" | "global";

export type RegraSugerida = {
  id: string;
  versao: number;
  origem: OrigemRegraSugerida;
  ncmPrefixo: string;
  perfilNome: string;
};
export type CandidataSugerida = RegraSugerida & { perfil: PerfilSugerido };

export type SugestaoFiscal =
  | { status: "regra"; regra: RegraSugerida; perfil: PerfilSugerido }
  | { status: "empate"; candidatas: CandidataSugerida[] }
  | { status: "sem_regra" }
  | { status: "ncm_invalido" };

const perfilSchema = z.record(z.string(), z.union([z.string(), z.number()])).transform((p) => {
  const limpo: PerfilSugerido = {};
  for (const campo of CAMPOS_FISCAIS) {
    const v = p[campo];
    if (v !== undefined) limpo[campo] = v;
  }
  return limpo;
});

const regraSchema = z.object({
  id: z.string(),
  versao: z.number(),
  origem: z.enum(["empresa", "global"]),
  // respostas de antes da migração que acrescentou estes dois campos continuam legíveis
  ncmPrefixo: z.string().default(""),
  perfilNome: z.string().default(""),
});

const respostaSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("regra"), regra: regraSchema, perfil: perfilSchema }),
  z.object({
    status: z.literal("empate"),
    candidatas: z.array(regraSchema.extend({ perfil: perfilSchema })).min(2),
  }),
  z.object({ status: z.literal("sem_regra") }),
  z.object({ status: z.literal("ncm_invalido") }),
]);

/** Lê a resposta de fiscal_sugerir; formato inesperado vira nulo (a tela diz "indisponível" e o cadastro segue normal). */
export function lerSugestaoFiscal(resposta: unknown): SugestaoFiscal | null {
  const r = respostaSchema.safeParse(resposta);
  return r.success ? (r.data as SugestaoFiscal) : null;
}

/** Só os dígitos do NCM digitado ("2309.10.00" → "23091000"). */
export const ncmDigitos = (ncm: string): string => ncm.replace(/\D/g, "");

/** A sugestão só é consultada com o NCM completo (8 dígitos). */
export const ncmConsultavel = (ncm: string): boolean => ncmDigitos(ncm).length === 8;

export const ROTULO_ORIGEM_REGRA: Record<OrigemRegraSugerida, string> = {
  global: "Regra global",
  empresa: "Sobrescrita da empresa",
};

const ROTULO_CAMPO: Record<CampoFiscal, string> = {
  cstIcms: "CST do ICMS",
  csosn: "CSOSN",
  cfop: "CFOP",
  aliqIcms: "ICMS",
  reducaoBaseIcms: "Redução da base do ICMS",
  mvaSt: "MVA-ST",
  cstPis: "CST do PIS",
  aliqPis: "PIS",
  cstCofins: "CST do COFINS",
  aliqCofins: "COFINS",
  cstIbsCbs: "CST do IBS/CBS",
  cclasstrib: "cClassTrib",
  origem: "Origem",
};
const CAMPOS_PERCENTUAL: readonly CampoFiscal[] = [
  "aliqIcms",
  "reducaoBaseIcms",
  "mvaSt",
  "aliqPis",
  "aliqCofins",
];
const numeroBr = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

/** Valores do perfil para exibir, na ordem dos campos fiscais, com rótulo e unidade. */
export function linhasDoPerfil(perfil: PerfilSugerido): { rotulo: string; valor: string }[] {
  return CAMPOS_FISCAIS.flatMap((campo) => {
    const v = perfil[campo];
    if (v === undefined) return [];
    const texto = typeof v === "number" ? numeroBr.format(v) : v;
    return [
      {
        rotulo: ROTULO_CAMPO[campo],
        valor: CAMPOS_PERCENTUAL.includes(campo) ? `${texto}%` : texto,
      },
    ];
  });
}

export type AplicacaoIbsCbs =
  | { tipo: "aplicar"; cst: string; cclasstrib: string }
  | { tipo: "sem_ibs_cbs" }
  | { tipo: "nao_suportada"; cst: string; cclasstrib: string; motivo: string };

/**
 * O que a sugestão permite aplicar na tributação IBS/CBS do produto. O cadastro só aceita as combinações que o sistema calcula
 * (as demais a emissão recusa), então uma combinação não suportada nunca é aplicada. A tributação integral (000 / 000001) é o
 * padrão do cadastro e vira "em branco".
 */
export function aplicacaoIbsCbs(perfil: PerfilSugerido): AplicacaoIbsCbs {
  const cst = perfil.cstIbsCbs;
  const cclasstrib = perfil.cclasstrib;
  if (typeof cst !== "string" || typeof cclasstrib !== "string") return { tipo: "sem_ibs_cbs" };
  const motivo = motivoNaoSuportada(cst, cclasstrib);
  if (motivo !== null) return { tipo: "nao_suportada", cst, cclasstrib, motivo };
  if (cst === TRIBUTACAO_INTEGRAL.cst && cclasstrib === TRIBUTACAO_INTEGRAL.cClassTrib) {
    return { tipo: "aplicar", cst: "", cclasstrib: "" };
  }
  return { tipo: "aplicar", cst, cclasstrib };
}

/** O produto já está com a tributação IBS/CBS da sugestão? (Em branco e integral são a mesma coisa.) */
export function ibsCbsJaIgual(
  atual: { cst: string; cclasstrib: string },
  aplicar: { cst: string; cclasstrib: string },
): boolean {
  const norm = (x: { cst: string; cclasstrib: string }) =>
    x.cst === TRIBUTACAO_INTEGRAL.cst && x.cclasstrib === TRIBUTACAO_INTEGRAL.cClassTrib
      ? { cst: "", cclasstrib: "" }
      : x;
  const a = norm(atual);
  const b = norm(aplicar);
  return a.cst === b.cst && a.cclasstrib === b.cclasstrib;
}
