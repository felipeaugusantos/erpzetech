/* eslint-disable @typescript-eslint/no-explicit-any -- cliente Supabase injetado pelas funções de servidor */
// Funções de servidor do contador: lista das notas da empresa autorizada e download do XML autorizado.
// Cada chamada confere de novo o acesso (revogação vale na hora). O cliente só informa o id da nota: o id do
// emissor, a empresa e o ambiente vêm do banco, e a leitura passa pelo RLS do contador.
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth as requireAuth } from "@/integrations/supabase/auth-middleware";
import { conferirNotaDoContador, exigirContador, intervaloDoMes } from "./contador-escopo.ts";

type Ctx = { supabase: any; userId: string };

export const contadorNotas = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { mes: string }) => ({ mes: String(input?.mes ?? "") }))
  .handler(async ({ data, context }) => {
    const { supabase } = context as unknown as Ctx;
    const acesso = await exigirContador(supabase);
    const { inicio, fim } = intervaloDoMes(data.mes);
    const { data: notas, error } = await supabase
      .from("nfe")
      .select("id, numero, serie, situacao, chave, valor_total, emitida_em, created_at")
      .eq("empresa_id", acesso.empresa_id)
      .in("situacao", ["autorizada", "cancelada"])
      .gte("created_at", inicio)
      .lt("created_at", fim)
      .order("numero", { ascending: true })
      .limit(1000);
    if (error) throw new Error("Não foi possível listar as notas");
    return { empresa: { nome: acesso.empresa_nome, cnpj: acesso.cnpj }, notas: notas ?? [] };
  });

export const contadorXml = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { nfeId: string }) => {
    const id = String(input?.nfeId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error("Nota fiscal não informada");
    }
    return { nfeId: id };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context as unknown as Ctx;
    const acesso = await exigirContador(supabase);
    const { data: nota, error } = await supabase
      .from("nfe")
      .select("id, empresa_id, situacao, provider_id, chave, ambiente")
      .eq("id", data.nfeId)
      .maybeSingle();
    if (error) throw new Error("Não foi possível ler a nota");
    const alvo = conferirNotaDoContador(nota, acesso);

    const { acbrToken, baseUrl } = await import("./acbr.server");
    const token = await acbrToken();
    const resposta = await fetch(
      `${baseUrl(alvo.ambiente)}/nfe/${encodeURIComponent(alvo.providerId)}/xml`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!resposta.ok) throw new Error("O emissor ainda não disponibilizou o XML desta nota");
    const xml = await resposta.text();
    return { xml, nome: `${alvo.chave ?? data.nfeId}.xml` };
  });
