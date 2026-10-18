import { createServerFn } from "@tanstack/react-start";
import { comDesfazer } from "./desfazer.ts";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  exigirOperadorZeTech,
  validarSenhaAdminCliente,
  validarVinculoAdminCliente,
} from "./cliente-admin-senha.ts";

type Entrada = { clienteId: string; email: string; senha: string };

/**
 * Cria o login do administrador de um cliente assinante (loja).
 * Somente operadores da Ze Tech podem executar.
 * O cliente ganha um tenant próprio e o administrador entra com a empresa em branco,
 * para cadastrar os dados da loja no primeiro acesso.
 */
export const criarAdminCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Entrada) => {
    const email = String(input.email ?? "")
      .trim()
      .toLowerCase();
    const senha = String(input.senha ?? "");
    if (!input.clienteId) throw new Error("Cliente não informado");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido");
    if (senha.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres");
    return { clienteId: input.clienteId, email, senha };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: operador, error: erroOperador } = await supabase.rpc("eh_saas_operador");
    if (erroOperador) throw erroOperador;
    if (!operador) throw new Error("Somente a equipe Ze Tech pode criar o acesso do administrador");

    const { data: cliente, error: erroCliente } = await supabase
      .from("saas_clientes")
      .select("id, nome, responsavel, tenant_id, admin_user_id")
      .eq("id", data.clienteId)
      .maybeSingle();
    if (erroCliente) throw erroCliente;
    if (!cliente) throw new Error("Cliente não encontrado");
    if (cliente.admin_user_id)
      throw new Error("Este cliente já possui um administrador cadastrado");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Várias etapas em lugares diferentes (empresa, Auth, perfil, papel, vínculo): se uma falhar, desfaz as
    // anteriores, senão sobra empresa sem dono e o e-mail fica preso, e repetir cria outra empresa.
    await comDesfazer(async (desfazerSe) => {
      // Cada cliente opera em um espaço próprio de dados.
      let tenantId = cliente.tenant_id;
      if (!tenantId) {
        const novoTenant = await supabaseAdmin
          .from("tenants")
          .insert({ nome: cliente.nome })
          .select("id")
          .single();
        if (novoTenant.error) throw novoTenant.error;
        tenantId = novoTenant.data.id;
        const idNovo = tenantId;
        desfazerSe(async () => {
          await supabaseAdmin.from("tenants").delete().eq("id", idNovo);
        });
      }

      const criado = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.senha,
        email_confirm: true,
        user_metadata: { nome: cliente.responsavel ?? cliente.nome },
      });
      if (criado.error || !criado.data.user) {
        const ja =
          (criado.error as { code?: string } | null)?.code === "email_exists" ||
          /already been registered/i.test(criado.error?.message ?? "");
        throw new Error(
          ja
            ? `O e-mail ${data.email} já tem login no sistema (pode ser de outra loja ou da equipe Ze Tech). Use um e-mail diferente para o administrador deste cliente.`
            : (criado.error?.message ?? "Não foi possível criar o acesso"),
        );
      }
      const userId = criado.data.user.id;
      desfazerSe(async () => {
        await supabaseAdmin.auth.admin.deleteUser(userId);
      });

      // O gatilho de novo usuário aponta para o primeiro tenant; corrigimos para o tenant do cliente
      // e deixamos empresa e filial em branco para o administrador cadastrar no primeiro acesso.
      const perfil = await supabaseAdmin.from("profiles").upsert({
        id: userId,
        nome: cliente.responsavel ?? cliente.nome,
        email: data.email,
        tenant_id: tenantId,
        empresa_id: null,
        filial_id: null,
        ativo: true,
      });
      if (perfil.error) throw perfil.error;

      const limpeza = await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
      if (limpeza.error) throw limpeza.error;

      const papel = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: "administrador", tenant_id: tenantId });
      if (papel.error) throw papel.error;

      const vinculo = await supabaseAdmin
        .from("saas_clientes")
        .update({
          admin_email: data.email,
          admin_user_id: userId,
          admin_criado_em: new Date().toISOString(),
          tenant_id: tenantId,
        })
        .eq("id", cliente.id);
      if (vinculo.error) throw vinculo.error;
    });

    return { ok: true, email: data.email };
  });

/** Redefine somente o administrador vinculado ao assinante escolhido. */
export const redefinirSenhaAdminCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clienteId: string; senha: string }) => {
    if (!input.clienteId) throw new Error("Cliente não informado");
    return {
      clienteId: input.clienteId,
      senha: validarSenhaAdminCliente(String(input.senha ?? "")),
    };
  })
  .handler(async ({ data, context }) => {
    const { data: operador, error: erroOperador } = await context.supabase.rpc("eh_saas_operador");
    if (erroOperador) throw erroOperador;
    exigirOperadorZeTech(operador);

    const { data: cliente, error } = await context.supabase
      .from("saas_clientes")
      .select("admin_user_id, tenant_id")
      .eq("id", data.clienteId)
      .maybeSingle();
    if (error) throw error;
    if (!cliente?.admin_user_id || !cliente.tenant_id)
      throw new Error("Este cliente não possui administrador vinculado");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [perfil, papeis] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, tenant_id")
        .eq("id", cliente.admin_user_id)
        .maybeSingle(),
      supabaseAdmin
        .from("user_roles")
        .select("role, tenant_id")
        .eq("user_id", cliente.admin_user_id),
    ]);
    if (perfil.error) throw perfil.error;
    if (papeis.error) throw papeis.error;
    const userId = validarVinculoAdminCliente(cliente, perfil.data, papeis.data ?? []);
    const atualizado = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: data.senha,
    });
    if (atualizado.error) throw atualizado.error;
    return { ok: true };
  });
