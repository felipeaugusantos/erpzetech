import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  cnpjDaEmpresa,
  empresaHabilitada,
  LimitadorConsultas,
  lerRespostaIbpt,
  montarUrl,
  validarConsulta,
  type ConsultaIbpt,
} from "./ibpt-api.ts";

/**
 * Consulta as alíquotas aproximadas de uma NCM na API da IBPT (De Olho no Imposto) e devolve a linha no mesmo
 * formato do CSV; a tela grava pelo caminho da importação (rpc tributos_aprox_importar, que confere papel e empresa).
 *
 * Segurança (a credencial é do servidor, não da empresa):
 *  - só administrador, gestor ou financeiro, da empresa da própria sessão;
 *  - a empresa precisa estar em IBPT_EMPRESAS_HABILITADAS (ids de tenant separados por vírgula). Falha fechado:
 *    sem a lista, ninguém consulta. Ainda NÃO está resolvido se a licença do token vale para todas as empresas
 *    ou só para o CNPJ dono dele; por isso a habilitação é explícita;
 *  - a credencial precisa pertencer à empresa: IBPT_CNPJ tem de ser um CNPJ cadastrado da empresa da sessão
 *    (tabela empresas, sob RLS). Divergência = falha fechado; não se presume licença multiempresa;
 *  - ativação bloqueada até IBPT_ATIVA=sim, que só deve ser definido depois de conferidos os termos de uso e a
 *    licença do token (ainda NÃO confirmados);
 *  - contenção local: uma consulta por vez por empresa, intervalo mínimo e teto por janela (limite da IBPT desconhecido);
 *  - IBPT_TOKEN e IBPT_CNPJ ficam só no servidor e nunca entram em retorno, erro ou log (a URL leva o token).
 */
const limitador = new LimitadorConsultas();
const PAPEIS = ["administrador", "gestor", "financeiro"] as const;

export const consultarTributosIbpt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ConsultaIbpt) => {
    validarConsulta(input);
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as {
      supabase: {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              k: string,
              v: string,
            ) => PromiseLike<{ data: { cnpj: string | null }[] | null; error: unknown }>;
          };
        };
        rpc: (
          n: string,
          a?: Record<string, unknown>,
        ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
      userId: string;
    };

    const { data: tenant, error: eTenant } = await supabase.rpc("current_tenant_id");
    if (eTenant || typeof tenant !== "string") throw new Error("Usuário sem empresa vinculada.");
    const papeis = await Promise.all(
      PAPEIS.map((r) => supabase.rpc("has_role", { _user_id: userId, _role: r })),
    );
    if (!papeis.some((r) => r.data === true)) {
      throw new Error("Somente administrador, gestor ou financeiro consulta a IBPT.");
    }
    if (!empresaHabilitada(process.env["IBPT_EMPRESAS_HABILITADAS"], tenant)) {
      throw new Error("A consulta à IBPT não está habilitada para esta empresa.");
    }
    if (process.env["IBPT_ATIVA"] !== "sim") {
      throw new Error("A consulta à IBPT está desativada até a conferência dos termos de uso.");
    }
    const token = process.env["IBPT_TOKEN"];
    const cnpj = process.env["IBPT_CNPJ"];
    if (!token || !cnpj) throw new Error("Consulta IBPT não configurada no servidor.");
    const { data: empresas, error: eEmp } = await supabase
      .from("empresas")
      .select("cnpj")
      .eq("tenant_id", tenant);
    if (
      eEmp ||
      !cnpjDaEmpresa(
        cnpj,
        (empresas ?? []).map((e) => e.cnpj),
      )
    ) {
      throw new Error("A credencial IBPT configurada não pertence a esta empresa.");
    }
    limitador.reservar(tenant);
    try {
      return await consultar(data, token, cnpj);
    } finally {
      limitador.liberar(tenant);
    }
  });

async function consultar(data: ConsultaIbpt, token: string, cnpj: string) {
  let resp: Response;
  try {
    resp = await fetch(montarUrl(data, token, cnpj), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // a mensagem original pode conter a URL (com o token): não repassar
    throw new Error("Não foi possível falar com a IBPT. Tente de novo.");
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("A IBPT recusou a credencial configurada.");
  }
  if (!resp.ok) throw new Error(`A IBPT não respondeu (HTTP ${resp.status}). Tente de novo.`);
  let corpo: unknown;
  try {
    corpo = await resp.json();
  } catch {
    throw new Error("Resposta da IBPT em formato inesperado.");
  }
  return lerRespostaIbpt(corpo, data);
}
