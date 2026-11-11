import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import {
  ADMIN_EQUIPE_ZE_TECH,
  cadastroEquipe,
  exigirAdminEquipe,
  validarRemocaoEquipe,
} from "./equipe-ze-tech";
import { comDesfazer } from "./desfazer";

export const listarEquipeZeTech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const acesso = await context.supabase.rpc("eh_saas_operador");
    if (acesso.error) throw acesso.error;
    if (acesso.data !== true) throw new Error("Área exclusiva da equipe Ze Tech.");
    const membros = await context.supabase
      .from("saas_operadores")
      .select("user_id,nome,created_at")
      .order("created_at");
    if (membros.error) throw membros.error;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const lista = await Promise.all(
      (membros.data ?? []).map(async (m) => {
        const conta = await supabaseAdmin.auth.admin.getUserById(m.user_id);
        if (conta.error) throw new Error("Não foi possível consultar a equipe.");
        return {
          ...m,
          email: conta.data.user?.email ?? "",
          confirmado: Boolean(conta.data.user?.email_confirmed_at),
          principal: m.user_id === ADMIN_EQUIPE_ZE_TECH,
        };
      }),
    );
    return { membros: lista, podeGerenciar: context.userId === ADMIN_EQUIPE_ZE_TECH };
  });

export const cadastrarEquipeZeTech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof cadastroEquipe>) => cadastroEquipe.parse(input))
  .handler(async ({ data, context }) => {
    const acesso = await context.supabase.rpc("eh_saas_operador");
    if (acesso.error) throw acesso.error;
    exigirAdminEquipe(context.userId, acesso.data);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Exact lookup only; never enumerate every Auth user across the customer tenants.
    const perfil = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", data.email.replace(/[\\%_]/g, "\\$&"))
      .maybeSingle();
    if (perfil.error) throw new Error("Não foi possível verificar a conta.");
    let existente: { id: string; email_confirmed_at?: string } | undefined;
    if (perfil.data) {
      const conta = await supabaseAdmin.auth.admin.getUserById(perfil.data.id);
      if (conta.error || conta.data.user?.email?.toLowerCase() !== data.email)
        throw new Error("Não foi possível verificar a conta.");
      existente = conta.data.user;
    }
    if (data.modo === "novo" && existente)
      throw new Error(
        "Este e-mail já tem uma conta. Escolha Conta existente; a senha atual será mantida.",
      );
    if (data.modo === "existente" && !existente)
      throw new Error("Não existe uma conta com esse e-mail.");
    if (data.modo === "existente" && !existente?.email_confirmed_at)
      throw new Error("A pessoa precisa confirmar o e-mail antes de receber este acesso.");
    if (existente) {
      const membro = await context.supabase
        .from("saas_operadores")
        .select("user_id")
        .eq("user_id", existente.id)
        .maybeSingle();
      if (membro.error) throw membro.error;
      if (membro.data) throw new Error("Esta pessoa já faz parte da equipe.");
    }
    await comDesfazer(async (desfazerSe) => {
      let userId = existente?.id;
      if (!userId) {
        const url = process.env["SUPABASE_URL"];
        const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!url || !key) throw new Error("A configuração de acesso não está disponível.");
        const auth = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) => {
              const headers = new Headers(init?.headers);
              if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`)
                headers.delete("Authorization");
              headers.set("apikey", key);
              return fetch(input, { ...init, headers });
            },
          },
        });
        const origin = new URL(getRequest().url).origin;
        const criado = await auth.auth.signUp({
          email: data.email,
          password: data.senha,
          options: { emailRedirectTo: `${origin}/ze-tech-login`, data: { nome: data.nome } },
        });
        if (criado.error) throw new Error(criado.error.message);
        if (!criado.data.user) throw new Error("Não foi possível criar a conta.");
        const id = criado.data.user.id;
        const real = await supabaseAdmin.auth.admin.getUserById(id);
        if (real.error || real.data.user?.email?.toLowerCase() !== data.email)
          throw new Error("Este e-mail já possui cadastro. Use Conta existente.");
        userId = id;
        desfazerSe(async () => supabaseAdmin.auth.admin.deleteUser(id));
      }
      const inserido = await supabaseAdmin
        .from("saas_operadores")
        .insert({ user_id: userId, nome: data.nome });
      if (inserido.error)
        throw new Error(
          "Não foi possível liberar o acesso. Confira se a pessoa já está na equipe.",
        );
    });
    return { confirmacaoPendente: data.modo === "novo" };
  });

export const removerEquipeZeTech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => z.object({ userId: z.guid() }).parse(input))
  .handler(async ({ data, context }) => {
    const acesso = await context.supabase.rpc("eh_saas_operador");
    if (acesso.error) throw acesso.error;
    exigirAdminEquipe(context.userId, acesso.data);
    validarRemocaoEquipe(data.userId);
    const alvo = await context.supabase
      .from("saas_operadores")
      .select("user_id")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (alvo.error) throw alvo.error;
    if (!alvo.data) throw new Error("Integrante não encontrado.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const removido = await supabaseAdmin
      .from("saas_operadores")
      .delete()
      .eq("user_id", alvo.data.user_id);
    if (removido.error) throw removido.error;
    return { ok: true };
  });
