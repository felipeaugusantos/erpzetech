// Parametrização fiscal por NCM (plano em docs/parametrizacao-fiscal.md, PR 5): a empresa sobrescreve ou oculta regras da base global.
// Lógica pura, sem tela nem banco: leitura segura das respostas, formulário da sobrescrita e texto das listas. O banco confere tudo de novo.
import { z } from "zod";

import { validarCriteriosFiscais, validarLinhaFiscal } from "./fiscal-importacao.ts";
import { CAMPOS_FISCAIS } from "./fiscal-regras.ts";
import { linhasDoPerfil, type PerfilSugerido } from "./fiscal-sugestao.ts";

export type StatusRegra = "vigente" | "futura" | "encerrada" | "inativa";
export const ROTULO_STATUS_REGRA: Record<StatusRegra, string> = {
  vigente: "Vigente",
  futura: "Futura",
  encerrada: "Encerrada",
  inativa: "Inativa",
};

const perfilSchema = z.record(z.string(), z.union([z.string(), z.number()])).transform((p) => {
  const limpo: PerfilSugerido = {};
  for (const campo of CAMPOS_FISCAIS) {
    const v = p[campo];
    if (v !== undefined) limpo[campo] = v;
  }
  return limpo;
});

const criterios = {
  id: z.string(),
  ncmPrefixo: z.string(),
  cest: z.string().nullable(),
  operacao: z.string().nullable(),
  regime: z.string().nullable(),
  ufDestino: z.string().nullable(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
  versao: z.number(),
  ativa: z.boolean(),
  status: z.enum(["vigente", "futura", "encerrada", "inativa"]),
  observacao: z.string().nullable(),
  perfilNome: z.string(),
  perfil: perfilSchema,
};

const minhaSchema = z.object({
  ...criterios,
  criadoEm: z.string(),
  perfilId: z.string(),
  perfilOrigem: z.enum(["global", "empresa"]),
});
const globalSchema = z.object({
  ...criterios,
  oculta: z.boolean(),
  motivoOculta: z.string().nullable(),
});
const perfilDisponivelSchema = z.object({
  id: z.string(),
  nome: z.string(),
  origem: z.enum(["global", "empresa"]),
  perfil: perfilSchema,
});

export type RegraEmpresa = z.infer<typeof minhaSchema>;
export type RegraGlobalVista = z.infer<typeof globalSchema>;
export type PerfilDisponivel = z.infer<typeof perfilDisponivelSchema>;
export type ListaFiscal<T> = { total: number; itens: T[] };

const lista = <T extends z.ZodType>(item: T) =>
  z.object({ total: z.number(), itens: z.array(item) });

/** Cada leitura devolve nulo se a resposta tiver formato inesperado (a tela mostra erro em vez de quebrar). */
export const lerMinhasRegras = (r: unknown): ListaFiscal<RegraEmpresa> | null => {
  const x = lista(minhaSchema).safeParse(r);
  return x.success ? x.data : null;
};
export const lerRegrasGlobais = (r: unknown): ListaFiscal<RegraGlobalVista> | null => {
  const x = lista(globalSchema).safeParse(r);
  return x.success ? x.data : null;
};
export const lerPerfisDisponiveis = (r: unknown): PerfilDisponivel[] | null => {
  const x = z.array(perfilDisponivelSchema).safeParse(r);
  return x.success ? x.data : null;
};

export const OPERACOES = [
  { valor: "venda", rotulo: "Venda" },
  { valor: "devolucao", rotulo: "Devolução" },
  { valor: "transferencia", rotulo: "Transferência" },
] as const;
export const REGIMES = [
  { valor: "normal", rotulo: "Regime normal" },
  { valor: "simples", rotulo: "Simples Nacional (vale também para MEI)" },
  { valor: "mei", rotulo: "Só MEI (use quando difere do Simples)" },
] as const;

/** "CEST 0100100 · venda · normal · UF SP"; sem critério nenhum, "todos". */
export function descreverCriterios(r: {
  cest: string | null;
  operacao: string | null;
  regime: string | null;
  ufDestino: string | null;
}): string {
  const partes = [
    r.cest && `CEST ${r.cest}`,
    r.operacao,
    r.regime,
    r.ufDestino && `UF ${r.ufDestino}`,
  ];
  const texto = partes.filter(Boolean).join(" · ");
  return texto === "" ? "todos" : texto;
}

/** Valores do perfil numa linha só ("CFOP 5102 · ICMS 18%"), para as listas. */
export function resumoDoPerfil(perfil: PerfilSugerido): string {
  const l = linhasDoPerfil(perfil);
  return l.length === 0 ? "—" : l.map((x) => `${x.rotulo} ${x.valor}`).join(" · ");
}

/** AAAA-MM-DD → DD/MM/AAAA (vazio = traço). */
export const dataBr = (iso: string | null): string =>
  iso ? iso.split("-").reverse().join("/") : "—";

export type FormRegraEmpresa = {
  ncm: string;
  cest: string;
  operacao: string;
  regime: string;
  ufDestino: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  observacao: string;
  perfilModo: "existente" | "novo";
  perfilId: string;
  perfilNome: string;
  cstIcms: string;
  csosn: string;
  cfop: string;
  aliqIcms: string;
  reducaoBaseIcms: string;
  mvaSt: string;
  cstPis: string;
  aliqPis: string;
  cstCofins: string;
  aliqCofins: string;
  cstIbsCbs: string;
  cclasstrib: string;
  origem: string;
};

export const formVazio = (hoje: string): FormRegraEmpresa => ({
  ncm: "",
  cest: "",
  operacao: "",
  regime: "",
  ufDestino: "",
  vigenciaInicio: hoje,
  vigenciaFim: "",
  observacao: "",
  perfilModo: "existente",
  perfilId: "",
  perfilNome: "",
  cstIcms: "",
  csosn: "",
  cfop: "",
  aliqIcms: "",
  reducaoBaseIcms: "",
  mvaSt: "",
  cstPis: "",
  aliqPis: "",
  cstCofins: "",
  aliqCofins: "",
  cstIbsCbs: "",
  cclasstrib: "",
  origem: "",
});

/** Formulário de uma nova versão: mesmos critérios, perfil atual, começando hoje (a versão atual termina no dia anterior). */
export function formNovaVersao(r: RegraEmpresa, hoje: string): FormRegraEmpresa {
  return {
    ...formVazio(hoje),
    ncm: r.ncmPrefixo,
    cest: r.cest ?? "",
    operacao: r.operacao ?? "",
    regime: r.regime ?? "",
    ufDestino: r.ufDestino ?? "",
    observacao: r.observacao ?? "",
    perfilModo: "existente",
    perfilId: r.perfilId,
  };
}

/** Corpo enviado a fiscal_empresa_regra_salvar. */
export type DadosRegraEmpresa = {
  ncm: string;
  cest: string | null;
  operacao: string | null;
  regime: string | null;
  uf_destino: string | null;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  observacao: string | null;
  perfil_id?: string;
  perfil?: Record<string, string | number | null>;
};

/**
 * Valida o formulário e monta o corpo para o banco. `versaoAtual` (nova versão) exige início depois do início da versão atual.
 * Perfil existente: só o id; perfil novo: o nome e os valores (o banco cria o perfil da empresa).
 */
export function montarDadosRegra(
  f: FormRegraEmpresa,
  versaoAtual?: { vigenciaInicio: string },
): { erros: string[]; dados: DadosRegraEmpresa | null } {
  const celulas = {
    ncm: f.ncm,
    cest: f.cest,
    operacao: f.operacao,
    regime: f.regime,
    uf_destino: f.ufDestino,
    vigencia_inicio: f.vigenciaInicio,
    vigencia_fim: f.vigenciaFim,
    observacao: f.observacao,
  };
  const erros: string[] = [];
  let crit: ReturnType<typeof validarCriteriosFiscais>["criterios"] = null;
  let perfil: DadosRegraEmpresa["perfil"];
  let perfilId: string | undefined;

  if (f.perfilModo === "existente") {
    const c = validarCriteriosFiscais(celulas);
    erros.push(...c.erros);
    crit = c.criterios;
    if (f.perfilId === "") erros.push("Escolha o perfil da regra");
    else perfilId = f.perfilId;
    if (f.observacao.trim().length > 500) erros.push("Observação com mais de 500 caracteres");
  } else {
    const l = validarLinhaFiscal(
      {
        ...celulas,
        perfil: f.perfilNome,
        cst_icms: f.cstIcms,
        csosn: f.csosn,
        cfop: f.cfop,
        aliq_icms: f.aliqIcms,
        reducao_base_icms: f.reducaoBaseIcms,
        mva_st: f.mvaSt,
        cst_pis: f.cstPis,
        aliq_pis: f.aliqPis,
        cst_cofins: f.cstCofins,
        aliq_cofins: f.aliqCofins,
        cst_ibs_cbs: f.cstIbsCbs,
        cclasstrib: f.cclasstrib,
        origem: f.origem,
      },
      0,
    );
    erros.push(...l.erros);
    if (l.envio) {
      const e = l.envio;
      crit = {
        ncm: e.ncm,
        cest: e.cest,
        operacao: e.operacao,
        regime: e.regime,
        uf_destino: e.uf_destino,
        vigencia_inicio: e.vigencia_inicio,
        vigencia_fim: e.vigencia_fim,
      };
      perfil = {
        nome: e.perfil,
        cst_icms: e.cst_icms,
        csosn: e.csosn,
        cfop: e.cfop,
        aliq_icms: e.aliq_icms,
        reducao_base_icms: e.reducao_base_icms,
        mva_st: e.mva_st,
        cst_pis: e.cst_pis,
        aliq_pis: e.aliq_pis,
        cst_cofins: e.cst_cofins,
        aliq_cofins: e.aliq_cofins,
        cst_ibs_cbs: e.cst_ibs_cbs,
        cclasstrib: e.cclasstrib,
        origem: e.origem,
      };
    }
  }

  if (crit && versaoAtual && crit.vigencia_inicio <= versaoAtual.vigenciaInicio) {
    erros.push(
      `A nova versão precisa começar depois de ${dataBr(versaoAtual.vigenciaInicio)} (início da versão atual)`,
    );
  }
  if (erros.length > 0 || crit === null) return { erros, dados: null };
  const observacao = f.observacao.trim() === "" ? null : f.observacao.trim();
  return {
    erros,
    dados: {
      ...crit,
      observacao,
      ...(perfilId !== undefined ? { perfil_id: perfilId } : {}),
      ...(perfil !== undefined ? { perfil } : {}),
    },
  };
}

/** Motivo de ocultar uma regra global: de 3 a 300 caracteres. Devolve o texto limpo ou o erro. */
export function validarMotivo(texto: string): { motivo: string | null; erro: string | null } {
  const t = texto.trim();
  if (t.length < 3) return { motivo: null, erro: "Informe o motivo (ao menos 3 caracteres)" };
  if (t.length > 300) return { motivo: null, erro: "O motivo pode ter até 300 caracteres" };
  return { motivo: t, erro: null };
}
