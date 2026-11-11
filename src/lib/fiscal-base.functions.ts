import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import type { CampoFiscal } from "./fiscal-regras.ts";
import { mensagemNcmInexistente, ncmNaTabela } from "./ncm.ts";
import { LIMITE_LINHAS_FISCAL, type ResultadoCargaFiscal } from "./fiscal-importacao.ts";

// Base fiscal global (plano em docs/parametrizacao-fiscal.md, PR 3): só a equipe Ze Tech lê e grava. As funções de banco são só de
// service_role; aqui a pessoa é conferida como equipe e a chamada usa o serviço. O banco confere tudo de novo.

type Chamada = (
  nome: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function exigirOperador(supabase: {
  rpc: (n: "eh_saas_operador") => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}) {
  const { data, error } = await supabase.rpc("eh_saas_operador");
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Área exclusiva da equipe Ze Tech.");
}

/** Cliente de serviço com a chamada de função tipada aqui (os tipos gerados só conhecem as funções depois da migração aplicada). */
async function servico(): Promise<Chamada> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return (nome, args) => (supabaseAdmin as unknown as { rpc: Chamada }).rpc(nome, args);
}

const esquemaCarga = z.object({
  fonte: z.string().trim().min(3, "Informe a fonte da carga").max(200),
  linhas: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, "Planilha sem linhas")
    .max(LIMITE_LINHAS_FISCAL, `Até ${LIMITE_LINHAS_FISCAL} linhas por carga`),
});

async function rodarCarga(
  input: z.infer<typeof esquemaCarga>,
  confirmar: boolean,
  userId: string,
  supabase: Parameters<typeof exigirOperador>[0],
): Promise<ResultadoCargaFiscal> {
  await exigirOperador(supabase);
  // o navegador já conferiu, mas esta é a conferência que vale: NCM que não existe na Tabela NCM vigente não entra na base
  const inexistentes = [
    ...new Set(input.linhas.map((l) => String(l["ncm"] ?? "")).filter((n) => !ncmNaTabela(n))),
  ];
  if (inexistentes.length > 0) {
    throw new Error(
      `${mensagemNcmInexistente(inexistentes[0] ?? "")}${inexistentes.length > 1 ? ` (e mais ${inexistentes.length - 1})` : ""}.`,
    );
  }
  const rpc = await servico();
  const { data, error } = await rpc("fiscal_base_publicar", {
    p_linhas: input.linhas,
    p_fonte: input.fonte,
    p_confirmar: confirmar,
    p_operador: userId,
  });
  if (error) throw new Error(error.message);
  return data as ResultadoCargaFiscal;
}

/** Prévia: roda a carga inteira no banco e desfaz. Mostra o que seria novo, nova versão, igual ou erro. */
export const previaCargaFiscal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => esquemaCarga.parse(input))
  .handler(({ data, context }) =>
    rodarCarga(data, false, context.userId, context.supabase as never),
  );

/** Publica a carga: tudo ou nada (com qualquer linha com erro, nada é gravado). */
export const publicarCargaFiscal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => esquemaCarga.parse(input))
  .handler(({ data, context }) =>
    rodarCarga(data, true, context.userId, context.supabase as never),
  );

export type RegraBaseFiscal = {
  id: string;
  ncmPrefixo: string;
  cest: string | null;
  operacao: string | null;
  regime: string | null;
  ufDestino: string | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  versao: number;
  ativa: boolean;
  status: "vigente" | "futura" | "encerrada" | "inativa";
  fonte: string | null;
  observacao: string | null;
  criadoEm: string;
  perfilNome: string;
  perfil: Partial<Record<CampoFiscal, string | number>>;
};

const esquemaListar = z.object({
  busca: z.string().trim().max(120).optional(),
  apenasVigentes: z.boolean().default(false),
  pagina: z.number().int().min(0).max(100000).default(0),
});

export const LIMITE_LISTA_FISCAL = 100;

export const listarBaseFiscal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => esquemaListar.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase as never);
    const rpc = await servico();
    const { data: r, error } = await rpc("fiscal_base_listar", {
      p_busca: data.busca ? data.busca : null,
      p_apenas_vigentes: data.apenasVigentes,
      p_limite: LIMITE_LISTA_FISCAL,
      p_pagina: data.pagina,
    });
    if (error) throw new Error(error.message);
    return r as { total: number; itens: RegraBaseFiscal[] };
  });

const esquemaEncerrar = z.object({
  regraId: z.guid(),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
});

export const encerrarRegraFiscal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => esquemaEncerrar.parse(input))
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase as never);
    const rpc = await servico();
    const { error } = await rpc("fiscal_base_encerrar", {
      p_regra_id: data.regraId,
      p_fim: data.fim,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
