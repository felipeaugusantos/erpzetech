import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chamadoInput, empresaDoChamado, type Chamado, type ListaChamados } from "./help-chamados";

const endpoint = "https://helpzetech.lovable.app/api/public/erp/tickets";
const mensagens: Record<string, string> = {
  unauthorized:
    "A chave de conexão com a central não foi aceita. A equipe Ze Tech precisa conferir a mesma chave nos dois sistemas.",
  company_blocked: "O acesso da empresa está bloqueado na central. Contate a equipe Ze Tech.",
  user_conflict:
    "Este e-mail já está vinculado a outro cadastro na central. Confira o contato com a equipe Ze Tech.",
  company_conflict_or_blocked:
    "Há uma divergência no cadastro da empresa na central. Contate a equipe Ze Tech.",
  invalid_product: "O produto ERP não está disponível na central. Contate a equipe Ze Tech.",
};

export const listarChamados = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ page: z.number().int().min(1).max(10000) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ListaChamados> => {
    const perfil = await context.supabase
      .from("profiles")
      .select("tenant_id, ativo, empresa_id")
      .eq("id", context.userId)
      .single();
    if (perfil.error || !perfil.data?.ativo || !perfil.data.tenant_id)
      throw new Error("Acesso não disponível.");
    let consulta = context.supabase
      .from("empresas")
      .select("id, tenant_id")
      .eq("tenant_id", perfil.data.tenant_id);
    if (perfil.data.empresa_id) consulta = consulta.eq("id", perfil.data.empresa_id);
    const empresa = await consulta.single();
    const externalId = empresaDoChamado(perfil.data, empresa.data);
    const key = process.env["ERP_ZETECH_API_KEY"];
    if (!key)
      return {
        tickets: [],
        total: 0,
        page: data.page,
        error: "A conexão com a central ainda não foi configurada.",
      };
    try {
      const url = new URL(endpoint);
      url.searchParams.set("company_external_id", externalId);
      url.searchParams.set("page", String(data.page));
      url.searchParams.set("page_size", "20");
      const response = await fetch(url, {
        headers: { "x-erp-key": key },
        signal: AbortSignal.timeout(25000),
      });
      const body = await response.json();
      if (response.status === 404 && body.error === "company_not_found")
        return { tickets: [], total: 0, page: data.page };
      if (!response.ok)
        return {
          tickets: [],
          total: 0,
          page: data.page,
          error:
            mensagens[body.error] ?? "Não foi possível consultar os chamados. Tente novamente.",
        };
      return { tickets: body.tickets ?? [], total: body.total ?? 0, page: data.page };
    } catch {
      return {
        tickets: [],
        total: 0,
        page: data.page,
        error: "A central não respondeu. Tente novamente em instantes.",
      };
    }
  });

export const abrirChamado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => chamadoInput.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      ticket?: Chamado;
      error?: string;
      welcomeEmailSent?: boolean;
      portalUserCreated?: boolean;
    }> => {
      const perfil = await context.supabase
        .from("profiles")
        .select("tenant_id, ativo, empresa_id")
        .eq("id", context.userId)
        .single();
      if (perfil.error || !perfil.data?.ativo || !perfil.data.tenant_id)
        throw new Error("Acesso não disponível.");
      let consulta = context.supabase
        .from("empresas")
        .select("id, tenant_id, cnpj, razao_social, nome_fantasia")
        .eq("tenant_id", perfil.data.tenant_id);
      if (perfil.data.empresa_id) consulta = consulta.eq("id", perfil.data.empresa_id);
      const empresa = await consulta.single();
      const externalId = empresaDoChamado(perfil.data, empresa.data);
      if (!empresa.data) throw new Error("Empresa não disponível.");
      const cnpj = (empresa.data.cnpj ?? "").replace(/\D/g, "");
      if (cnpj.length !== 14)
        return {
          error:
            "A central exige CNPJ para abrir chamados. A equipe Ze Tech precisa habilitar empresas sem CNPJ na central.",
        };
      const key = process.env["ERP_ZETECH_API_KEY"];
      if (!key) return { error: "A conexão com a central ainda não foi configurada." };
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-erp-key": key },
          signal: AbortSignal.timeout(45000),
          body: JSON.stringify({
            request_id: data.requestId,
            company: {
              external_id: externalId,
              cnpj,
              name: empresa.data.razao_social || empresa.data.nome_fantasia,
            },
            user: { name: data.name, email: data.email },
            ticket: {
              product_id: "33333333-0000-0000-0000-000000000001",
              subject: data.subject,
              description: data.description,
              priority: data.priority,
            },
          }),
        });
        const body = await response.json();
        if (!response.ok)
          return {
            error:
              mensagens[body.error] ??
              "Não foi possível abrir o chamado. Tente novamente sem fechar este formulário.",
          };
        return {
          ticket: body.ticket,
          portalUserCreated: body.portal_user_created,
          welcomeEmailSent: body.welcome_email_sent,
        };
      } catch {
        return {
          error:
            "A central não confirmou o envio. Tente novamente sem fechar este formulário para evitar duplicação.",
        };
      }
    },
  );
