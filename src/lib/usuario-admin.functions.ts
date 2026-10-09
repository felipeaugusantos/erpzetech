import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Perfis operacionais disponíveis para os operadores da loja. */
export const PERFIS = [
  "administrador",
  "gestor",
  "vendedor",
  "caixa",
  "estoquista",
  "comprador",
  "financeiro",
  "logistica",
  "motorista",
  "garcom",
  "cozinha",
] as const;

export type Perfil = (typeof PERFIS)[number];

type CriarEntrada = {
  nome: string;
  email: string;
  senha: string;
  telefone?: string | null;
  codigo?: string | null;
  filialId?: string | null;
  perfis: string[];
};

type AtualizarEntrada = {
  userId: string;
  nome?: string;
  telefone?: string | null;
  codigo?: string | null;
  filialId?: string | null;
  ativo?: boolean;
  perfis?: string[];
};

type SenhaEntrada = { userId: string; senha: string };

function validaPerfis(perfis: unknown): Perfil[] {
  const lista = Array.isArray(perfis) ? perfis.map(String) : [];
  const validos = lista.filter((p): p is Perfil => (PERFIS as readonly string[]).includes(p));
  if (validos.length === 0) throw new Error("Escolha pelo menos um perfil de acesso");
  return [...new Set(validos)];
}

/** Confirma que quem chama é administrador e devolve o tenant/empresa dele. */
async function contextoAdmin(supabase: {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- query builder do Supabase
  from: (t: string) => any;
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
}) {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("Sessão expirada");

  const admin = await supabase.rpc("has_role", { _user_id: user.user.id, _role: "administrador" });
  if (admin.error) throw admin.error;
  if (!admin.data) throw new Error("Somente o administrador da empresa pode gerenciar usuários");

  const perfil = await supabase
    .from("profiles")
    .select("tenant_id, empresa_id, filial_id")
    .eq("id", user.user.id)
    .maybeSingle();
  if (perfil.error) throw perfil.error;
  if (!perfil.data?.tenant_id) throw new Error("Perfil sem empresa vinculada");

  return {
    userId: user.user.id,
    tenantId: perfil.data.tenant_id as string,
    empresaId: (perfil.data.empresa_id as string | null) ?? null,
    filialId: (perfil.data.filial_id as string | null) ?? null,
  };
}

/** Cria o login de um operador dentro da empresa do administrador. */
export const criarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CriarEntrada) => {
    const nome = String(input.nome ?? "").trim();
    const email = String(input.email ?? "")
      .trim()
      .toLowerCase();
    const senha = String(input.senha ?? "");
    if (nome.length < 3) throw new Error("Informe o nome do operador");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido");
    if (senha.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres");
    return {
      nome,
      email,
      senha,
      telefone: input.telefone?.trim() || null,
      codigo: input.codigo?.trim() || null,
      filialId: input.filialId || null,
      perfis: validaPerfis(input.perfis),
    };
  })
  .handler(async ({ data, context }) => {
    const ctx = await contextoAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const criado = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.senha,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (criado.error || !criado.data.user) {
      throw new Error(criado.error?.message ?? "Não foi possível criar o usuário");
    }
    const novoId = criado.data.user.id;

    const perfil = await supabaseAdmin.from("profiles").upsert({
      id: novoId,
      nome: data.nome,
      email: data.email,
      telefone: data.telefone,
      codigo: data.codigo,
      tenant_id: ctx.tenantId,
      empresa_id: ctx.empresaId,
      filial_id: data.filialId ?? ctx.filialId,
      ativo: true,
    });
    if (perfil.error) throw perfil.error;

    const limpeza = await supabaseAdmin.from("user_roles").delete().eq("user_id", novoId);
    if (limpeza.error) throw limpeza.error;

    const papeis = await supabaseAdmin
      .from("user_roles")
      // garcom e cozinha entram nos tipos gerados quando o Lovable os atualizar depois da migration
      .insert(
        data.perfis.map((role) => ({ user_id: novoId, role, tenant_id: ctx.tenantId })) as never,
      );
    if (papeis.error) throw papeis.error;

    return { ok: true, id: novoId, email: data.email };
  });

/** Atualiza dados, situação e perfis de um operador da mesma empresa. */
export const atualizarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AtualizarEntrada) => {
    if (!input.userId) throw new Error("Usuário não informado");
    return {
      userId: input.userId,
      nome: input.nome?.trim() || undefined,
      telefone: input.telefone === undefined ? undefined : input.telefone?.trim() || null,
      codigo: input.codigo === undefined ? undefined : input.codigo?.trim() || null,
      filialId: input.filialId === undefined ? undefined : input.filialId || null,
      ativo: input.ativo,
      perfis: input.perfis === undefined ? undefined : validaPerfis(input.perfis),
    };
  })
  .handler(async ({ data, context }) => {
    const ctx = await contextoAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const alvo = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (alvo.error) throw alvo.error;
    if (!alvo.data || alvo.data.tenant_id !== ctx.tenantId) {
      throw new Error("Usuário não pertence à sua empresa");
    }
    if (data.userId === ctx.userId && data.ativo === false) {
      throw new Error("Você não pode desativar o seu próprio acesso");
    }

    const patch: {
      nome?: string;
      telefone?: string | null;
      codigo?: string | null;
      filial_id?: string | null;
      ativo?: boolean;
    } = {};
    if (data.nome !== undefined) patch.nome = data.nome;
    if (data.telefone !== undefined) patch.telefone = data.telefone;
    if (data.codigo !== undefined) patch.codigo = data.codigo;
    if (data.filialId !== undefined) patch.filial_id = data.filialId;
    if (data.ativo !== undefined) patch.ativo = data.ativo;

    if (Object.keys(patch).length > 0) {
      const upd = await supabaseAdmin.from("profiles").update(patch).eq("id", data.userId);
      if (upd.error) throw upd.error;
    }

    if (data.perfis) {
      if (data.userId === ctx.userId && !data.perfis.includes("administrador")) {
        throw new Error("Você não pode remover o seu próprio perfil de administrador");
      }
      const limpeza = await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
      if (limpeza.error) throw limpeza.error;
      const papeis = await supabaseAdmin.from("user_roles").insert(
        data.perfis.map((role) => ({
          user_id: data.userId,
          role,
          tenant_id: ctx.tenantId,
        })) as never,
      );
      if (papeis.error) throw papeis.error;
    }

    return { ok: true };
  });

/** Define uma nova senha provisória para o operador. */
export const redefinirSenhaUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SenhaEntrada) => {
    if (!input.userId) throw new Error("Usuário não informado");
    const senha = String(input.senha ?? "");
    if (senha.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres");
    return { userId: input.userId, senha };
  })
  .handler(async ({ data, context }) => {
    const ctx = await contextoAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const alvo = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (alvo.error) throw alvo.error;
    if (!alvo.data || alvo.data.tenant_id !== ctx.tenantId) {
      throw new Error("Usuário não pertence à sua empresa");
    }

    const upd = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.senha,
    });
    if (upd.error) throw upd.error;
    return { ok: true };
  });
