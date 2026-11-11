/* eslint-disable @typescript-eslint/no-explicit-any -- retornos dinâmicos do emissor fiscal (ACBr) e cliente Supabase sem tipos */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import { exigirPapelFiscal } from "./nfe-escopo.ts";
import {
  PAPEIS_CONFIG_RECEBIDAS,
  PAPEIS_MANIFESTACAO,
  atualizacaoDePendente,
  cnpjParaDistribuicao,
  cnpjsNormalizados,
  configRecebidasValida,
  exigirCnpjPermitido,
  validarManifestacao,
  type ConfigRecebidas,
} from "./nfe-recebidas.ts";

/**
 * Notas emitidas contra o CNPJ da empresa (Distribuição DF-e) e manifestação do destinatário.
 * A busca é automática (configurada no emissor fiscal) ou sob demanda; confirmar e recusar são sempre
 * ações de uma pessoa autorizada, registradas em `nfe_manifestacoes`.
 */

type Ctx = { supabase: any; userId: string };
type Ambiente = "homologacao" | "producao";

const ambienteDe = (v: unknown): Ambiente => (v === "producao" ? "producao" : "homologacao");

async function exigirPapel(supabase: any, userId: string, papeis: readonly string[], msg: string) {
  const respostas = await Promise.all(
    papeis.map((r) => supabase.rpc("has_role", { _user_id: userId, _role: r })),
  );
  if (!respostas.some((r: any) => r.data === true)) throw new Error(msg);
}

/** Empresas (CNPJ) que a pessoa pode operar: a do perfil, ou todas da conta quando o perfil não tem uma. */
async function empresasDaPessoa(supabase: any, userId: string) {
  const escopo = await exigirPapelFiscal(supabase, userId);
  let q = supabase
    .from("empresas")
    .select("id, cnpj, razao_social, nome_fantasia")
    .eq("tenant_id", escopo.tenantId);
  if (escopo.empresaId) q = q.eq("id", escopo.empresaId);
  const { data, error } = await q;
  if (error) throw error;
  const empresas = ((data ?? []) as any[]).filter((e) => e.cnpj);
  return { tenantId: escopo.tenantId, empresas };
}

const nomeAmbiente = (v: unknown) => ambienteDe(v);

/** Empresas com CNPJ e a configuração de busca/ciência automáticas de cada uma. */
export const painelNotasRecebidas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ambiente?: string }) => ({ ambiente: nomeAmbiente(input?.ambiente) }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");
    const { empresas } = await empresasDaPessoa(supabase, userId);
    const lista = await Promise.all(
      empresas.map(async (e) => {
        let config: ConfigRecebidas | null = null;
        let erro: string | null = null;
        try {
          const cnpj = cnpjParaDistribuicao(e.cnpj);
          const r = await acbr<any>(data.ambiente, `/empresas/${cnpj}/distnfe`);
          config = {
            distribuicao_automatica: r?.distribuicao_automatica === true,
            distribuicao_intervalo_horas: Number(r?.distribuicao_intervalo_horas ?? 24),
            ciencia_automatica: r?.ciencia_automatica === true,
          };
        } catch (err) {
          erro = err instanceof Error ? err.message : "Não foi possível ler a configuração.";
        }
        return {
          cnpj: String(e.cnpj),
          nome: String(e.nome_fantasia || e.razao_social || e.cnpj),
          config,
          erro,
        };
      }),
    );
    return { empresas: lista };
  });

/** Liga/desliga a busca automática e a ciência automática (administrador ou gestor). */
export const salvarConfigNotasRecebidas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { cnpj: string; ambiente?: string; config: Partial<ConfigRecebidas> }) => ({
      cnpj: String(input?.cnpj ?? ""),
      ambiente: ambienteDe(input?.ambiente),
      config: configRecebidasValida(input?.config ?? {}),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");
    await exigirPapel(
      supabase,
      userId,
      PAPEIS_CONFIG_RECEBIDAS,
      "Somente administrador ou gestor pode alterar a busca automática.",
    );
    const { empresas } = await empresasDaPessoa(supabase, userId);
    const cnpj = exigirCnpjPermitido(
      data.cnpj,
      empresas.map((e) => String(e.cnpj)),
    );
    await acbr(data.ambiente, `/empresas/${cnpj}/distnfe`, {
      method: "PUT",
      body: { ...data.config, ambiente: data.ambiente },
    });
    return { ok: true };
  });

/** Notas ainda sem manifestação conclusiva (ciência da operação não conta como conclusiva). */
export const listarNotasRecebidas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cnpj: string; ambiente?: string; pagina?: number }) => ({
    cnpj: String(input?.cnpj ?? ""),
    ambiente: ambienteDe(input?.ambiente),
    pagina: Math.max(0, Math.trunc(Number(input?.pagina ?? 0)) || 0),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");
    const { empresas } = await empresasDaPessoa(supabase, userId);
    const cnpj = exigirCnpjPermitido(
      data.cnpj,
      empresas.map((e) => String(e.cnpj)),
    );
    const por = 25;
    const q = new URLSearchParams({
      cpf_cnpj: cnpj,
      ambiente: data.ambiente,
      conclusiva: "true",
      $top: String(por),
      $skip: String(data.pagina * por),
      $inlinecount: "true",
    });
    const r = await acbr<any>(data.ambiente, `/distribuicao/nfe/notas-sem-manifestacao?${q}`);
    const notas = ((r?.data ?? []) as any[]).map((n) => ({
      chave: String(n.chave_acesso ?? ""),
      emitente: String(n.emitente_nome_razao_social ?? ""),
      emitenteCnpj: String(n.emitente_cpf_cnpj ?? ""),
      emissao: (n.data_emissao as string | null) ?? null,
      valor: Number(n.valor_nfe ?? 0),
      tipoNfe: n.tipo_nfe as number | null,
    }));
    return { notas, total: Number(r?.["@count"] ?? notas.length), porPagina: por };
  });

/** Pede à Sefaz as notas novas contra o CNPJ, a partir do último NSU recebido. */
export const buscarNotasRecebidas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cnpj: string; ambiente?: string }) => ({
    cnpj: String(input?.cnpj ?? ""),
    ambiente: ambienteDe(input?.ambiente),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");
    const { empresas } = await empresasDaPessoa(supabase, userId);
    const cnpj = exigirCnpjPermitido(
      data.cnpj,
      empresas.map((e) => String(e.cnpj)),
    );
    // Sem ignorar o intervalo mínimo da Sefaz: forçar consultas pode bloquear o CNPJ.
    const ultimas = await acbr<any>(
      data.ambiente,
      `/distribuicao/nfe?${new URLSearchParams({ cpf_cnpj: cnpj, ambiente: data.ambiente, $top: "1" })}`,
    );
    const ultimoNsu = Number(ultimas?.data?.[0]?.ultimo_nsu ?? 0) || 0;
    let r = await acbr<any>(data.ambiente, "/distribuicao/nfe", {
      method: "POST",
      body: {
        cpf_cnpj: cnpj,
        ambiente: data.ambiente,
        tipo_consulta: "dist-nsu",
        dist_nsu: ultimoNsu,
        ignorar_tempo_espera: false,
      },
    });
    for (let i = 0; i < 6 && r?.status === "processando" && r?.id; i++) {
      await new Promise((ok) => setTimeout(ok, 1500));
      r = await acbr<any>(data.ambiente, `/distribuicao/nfe/${r.id}`);
    }
    return {
      status: String(r?.status ?? "desconhecido"),
      mensagem: (r?.motivo_status as string | null) ?? null,
      novos: Array.isArray(r?.documentos) ? r.documentos.length : null,
    };
  });

/** Registra a manifestação: ciência, confirmação, desconhecimento ou operação não realizada. */
export const manifestarNota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      cnpj: string;
      ambiente?: string;
      chave: string;
      tipo: string;
      justificativa?: string;
      emitente?: string;
      valor?: number;
    }) => ({
      cnpj: String(input?.cnpj ?? ""),
      ambiente: ambienteDe(input?.ambiente),
      pedido: validarManifestacao({
        chave: input?.chave,
        tipo: input?.tipo,
        justificativa: input?.justificativa,
      }),
      emitente: String(input?.emitente ?? "").slice(0, 200) || null,
      valor: Number.isFinite(Number(input?.valor)) ? Number(input?.valor) : null,
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");
    await exigirPapel(
      supabase,
      userId,
      PAPEIS_MANIFESTACAO,
      "Somente administrador, gestor ou financeiro pode manifestar uma nota.",
    );
    const { tenantId, empresas } = await empresasDaPessoa(supabase, userId);
    const cnpj = exigirCnpjPermitido(
      data.cnpj,
      empresas.map((e) => String(e.cnpj)),
    );

    const retorno = await acbr<any>(data.ambiente, "/distribuicao/nfe/manifestacoes", {
      method: "POST",
      body: {
        cpf_cnpj: cnpj,
        ambiente: data.ambiente,
        chave_acesso: data.pedido.chave,
        tipo_evento: data.pedido.tipo,
        ...(data.pedido.justificativa ? { justificativa: data.pedido.justificativa } : {}),
      },
    });

    // O evento já foi enviado: se o registro local falhar, avisa sem esconder que a Sefaz recebeu.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("nfe_manifestacoes" as never).insert({
      tenant_id: tenantId,
      cnpj,
      ambiente: data.ambiente,
      chave_acesso: data.pedido.chave,
      tipo_evento: data.pedido.tipo,
      justificativa: data.pedido.justificativa,
      status: String(retorno?.status ?? "pendente"),
      protocolo: retorno?.numero_protocolo ?? null,
      mensagem: retorno?.motivo_status ?? null,
      provider_id: retorno?.id ?? null,
      emitente: data.emitente,
      valor: data.valor,
      autor_id: userId,
    } as never);
    return {
      status: String(retorno?.status ?? "pendente"),
      protocolo: (retorno?.numero_protocolo as string | null) ?? null,
      mensagem: (retorno?.motivo_status as string | null) ?? null,
      registroLocalFalhou: error ? error.message : null,
    };
  });

/**
 * Histórico de manifestações das empresas da pessoa (quem, quando, qual evento). Uma pessoa presa a uma
 * empresa só vê as dela; quem não está presa a nenhuma vê as da conta. Eventos ainda pendentes são
 * conferidos no emissor fiscal, para o histórico não ficar para sempre em "pendente".
 */
export const historicoManifestacoes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as unknown as Ctx;
    const { acbr } = await import("./acbr.server");
    const { tenantId, empresas } = await empresasDaPessoa(supabase, userId);
    const cnpjs = cnpjsNormalizados(empresas.map((e) => String(e.cnpj)));
    if (cnpjs.length === 0) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("nfe_manifestacoes" as never)
      .select(
        "id, cnpj, ambiente, chave_acesso, tipo_evento, justificativa, status, protocolo, mensagem, provider_id, emitente, valor, autor_id, created_at",
      )
      .eq("tenant_id", tenantId)
      .in("cnpj", cnpjs)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as any[];

    // Reconcilia os pendentes (no máximo 10 por consulta); falha do emissor não derruba o histórico.
    await Promise.all(
      linhas
        .filter((l) => l.status === "pendente" && l.provider_id)
        .slice(0, 10)
        .map(async (l) => {
          try {
            const r = await acbr<any>(
              ambienteDe(l.ambiente),
              `/distribuicao/nfe/manifestacoes/${encodeURIComponent(String(l.provider_id))}`,
            );
            const patch = atualizacaoDePendente(l.status, r);
            if (!patch) return;
            const { error: erroAtualizar } = await supabaseAdmin
              .from("nfe_manifestacoes" as never)
              .update(patch as never)
              .eq("id", l.id)
              .eq("tenant_id", tenantId);
            if (!erroAtualizar) Object.assign(l, patch);
          } catch {
            // segue pendente até a próxima consulta
          }
        }),
    );

    const ids = [...new Set(linhas.map((l) => l.autor_id).filter(Boolean))];
    const nomes = new Map<string, string>();
    if (ids.length) {
      const { data: perfis } = await supabaseAdmin
        .from("profiles")
        .select("id, nome")
        .in("id", ids as string[]);
      for (const p of (perfis ?? []) as any[]) nomes.set(p.id, p.nome);
    }
    return linhas.map(({ provider_id: _p, ...l }) => ({
      ...l,
      autor: nomes.get(l.autor_id) ?? null,
    }));
  });
