import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { erroDoUsuario, normalizarUsuario, tenantDoCodigoDeAcesso } from "@/lib/usuario-login";

/** A mesma mensagem para usuário que não existe, inativo ou senha errada: não revela quem tem login na empresa. */
const GENERICO = "Usuário ou senha incorretos";

export type SessaoDeLogin = { access_token: string; refresh_token: string };

function clientePublico() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(process.env["SUPABASE_URL"]!, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: key.startsWith("sb_")
      ? {
          fetch: (input, init) => {
            const h = new Headers(init?.headers);
            if (h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
            h.set("apikey", key);
            return fetch(input, { ...init, headers: h });
          },
        }
      : {},
  });
}

/**
 * Entra pelo usuário dentro da empresa. O servidor acha a conta do usuário, confere a senha com o provedor de autenticação e devolve só a
 * sessão: o endereço interno de login nunca chega ao navegador.
 */
async function entrarNaEmpresa(
  tenantId: string,
  usuarioBruto: string,
  senha: string,
): Promise<SessaoDeLogin> {
  const usuario = normalizarUsuario(usuarioBruto);
  if (erroDoUsuario(usuario) || !senha) throw new Error(GENERICO);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const perfil = await supabaseAdmin
    .from("profiles")
    .select("id, ativo")
    .eq("tenant_id", tenantId)
    .eq("usuario", usuario)
    .maybeSingle();
  if (perfil.error || !perfil.data || !perfil.data.ativo) throw new Error(GENERICO);

  const conta = await supabaseAdmin.auth.admin.getUserById(perfil.data.id);
  const email = conta.data.user?.email;
  if (conta.error || !email) throw new Error(GENERICO);

  const { data, error } = await clientePublico().auth.signInWithPassword({
    email,
    password: senha,
  });
  if (error || !data.session) throw new Error(GENERICO);
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

/** Login da tela de entrada: empresa (o link dela) + usuário + senha. */
export const entrarPorUsuario = createServerFn({ method: "POST" })
  .inputValidator((input: { slug: string; usuario: string; senha: string }) => ({
    slug: String(input?.slug ?? "")
      .toLowerCase()
      .trim()
      .slice(0, 60),
    usuario: String(input?.usuario ?? ""),
    senha: String(input?.senha ?? ""),
  }))
  .handler(async ({ data }): Promise<SessaoDeLogin> => {
    const codigoTenant = tenantDoCodigoDeAcesso(data.slug);
    if (codigoTenant) {
      // O código identifica a empresa, mas não autoriza acesso: perfil ativo e senha continuam obrigatórios.
      return entrarNaEmpresa(codigoTenant, data.usuario, data.senha);
    }
    if (!/^[a-z0-9-]{3,50}$/.test(data.slug)) throw new Error(GENERICO);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const empresa = await supabaseAdmin
      .from("empresas")
      .select("tenant_id")
      .eq("slug", data.slug)
      .eq("ativo", true)
      .maybeSingle();
    if (empresa.error) throw new Error(GENERICO);
    let tenantId = empresa.data?.tenant_id ?? null;
    if (!tenantId) {
      // link combinado no cadastro do assinante, antes de a empresa ser cadastrada
      const assinante = await supabaseAdmin
        .from("saas_clientes")
        .select("tenant_id")
        .eq("link_acesso", data.slug)
        .neq("situacao", "cancelado")
        .not("tenant_id", "is", null)
        .maybeSingle();
      if (assinante.error) throw new Error(GENERICO);
      tenantId = assinante.data?.tenant_id ?? null;
    }
    if (!tenantId) throw new Error(GENERICO);
    return entrarNaEmpresa(tenantId, data.usuario, data.senha);
  });

/** Troca de operador no caixa: quem já está logado informa o usuário (e a senha) de outro colega da mesma empresa. */
export const trocarOperadorPorUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { usuario: string; senha: string }) => ({
    usuario: String(input?.usuario ?? ""),
    senha: String(input?.senha ?? ""),
  }))
  .handler(async ({ data, context }): Promise<SessaoDeLogin> => {
    const meu = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (meu.error || !meu.data?.tenant_id) throw new Error(GENERICO);
    return entrarNaEmpresa(meu.data.tenant_id, data.usuario, data.senha);
  });
