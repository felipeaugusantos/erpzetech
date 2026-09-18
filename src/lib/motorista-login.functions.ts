import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Entrada = { motoristaId: string; email: string; senha: string };

/**
 * Cria (ou vincula) um login próprio para um motorista.
 * Somente administrador ou gestor do tenant pode executar.
 */
export const criarLoginMotorista = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Entrada) => {
    const email = String(input.email ?? "").trim().toLowerCase();
    const senha = String(input.senha ?? "");
    if (!input.motoristaId) throw new Error("Motorista não informado");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido");
    if (senha.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres");
    return { motoristaId: input.motoristaId, email, senha };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const [{ data: ehAdmin }, { data: ehGestor }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "administrador" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "gestor" }),
    ]);
    if (!ehAdmin && !ehGestor) throw new Error("Somente administrador ou gestor pode criar o login do motorista");

    const { data: motorista, error: erroMotorista } = await supabase
      .from("motoristas")
      .select("id, nome, tenant_id, empresa_id, filial_id, user_id")
      .eq("id", data.motoristaId)
      .maybeSingle();
    if (erroMotorista) throw erroMotorista;
    if (!motorista) throw new Error("Motorista não encontrado");
    if (motorista.user_id) throw new Error("Este motorista já possui login");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const criado = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.senha,
      email_confirm: true,
      user_metadata: { nome: motorista.nome },
    });
    if (criado.error || !criado.data.user) {
      throw new Error(criado.error?.message ?? "Não foi possível criar o login");
    }
    const novoId = criado.data.user.id;

    const perfil = await supabaseAdmin.from("profiles").upsert({
      id: novoId,
      nome: motorista.nome,
      email: data.email,
      tenant_id: motorista.tenant_id,
      empresa_id: motorista.empresa_id,
      filial_id: motorista.filial_id,
    });
    if (perfil.error) throw perfil.error;

    const papel = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: novoId, role: "motorista" }, { onConflict: "user_id,role" });
    if (papel.error) throw papel.error;

    // O motorista deve ter somente o perfil de motorista (o cadastro novo nasce como administrador).
    const limpeza = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", novoId)
      .neq("role", "motorista");
    if (limpeza.error) throw limpeza.error;

    const vinculo = await supabaseAdmin
      .from("motoristas")
      .update({ user_id: novoId })
      .eq("id", motorista.id);
    if (vinculo.error) throw vinculo.error;

    return { ok: true, email: data.email };
  });
