import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import {
  MAX_CAMPANHA,
  MAX_CAMPANHA_DIA,
  textoCampanha,
  validarCampanha,
} from "./campanha-whatsapp";
import { telefoneWhatsApp } from "./contato-pet.ts";
import { exigirAcessoTesteWhatsApp } from "./whatsapp-teste-acesso";

/** Envia a campanha para UM tutor; a tela chama um por vez, com pausa entre eles. */
export const campanhaEnviar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        campanhaId: z.guid(),
        clienteId: z.guid(),
        modeloId: z.guid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await exigirAcessoTesteWhatsApp((papel) =>
      db.rpc("has_role", { _user_id: context.userId, _role: papel }),
    ).catch((e: Error) => {
      throw new Error(e.message.replace("testar", "enviar campanhas"));
    });
    // o texto vem só de mensagem aprovada por administrador ou gestor da empresa
    const aprovado = await db
      .from("clinica_wa_campanha_modelos")
      .select("texto,ativo")
      .eq("id", data.modeloId)
      .maybeSingle();
    if (aprovado.error || !aprovado.data || !aprovado.data.ativo)
      throw new Error("Escolha uma mensagem aprovada para a campanha.");
    const modelo = aprovado.data.texto;
    const erroTexto = validarCampanha(modelo, 1);
    if (erroTexto) throw new Error(erroTexto);
    const clinica = await db.rpc("clinica_liberada");
    if (clinica.error || !clinica.data) throw new Error("Clínica não liberada.");
    const tenant = await db.rpc("current_tenant_id");
    if (tenant.error || !tenant.data) throw new Error("Sessão sem empresa.");
    const tenantId = String(tenant.data);
    const srv = await import("./whatsapp.server");
    srv.exigirEmpresaLiberada(tenantId);

    const [config, empresa, cliente, pets] = await Promise.all([
      db
        .from("wa_config")
        .select("estado,instancia,numero")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      db
        .from("empresas")
        .select("nome_fantasia,razao_social")
        .eq("tenant_id", tenantId)
        .order("created_at")
        .limit(1)
        .maybeSingle(),
      db
        .from("clientes")
        .select("id,nome,whatsapp,telefone,aceita_mensagens,ativo,deleted_at")
        .eq("tenant_id", tenantId)
        .eq("id", data.clienteId)
        .maybeSingle(),
      db
        .from("pets")
        .select("nome")
        .eq("tenant_id", tenantId)
        .eq("cliente_id", data.clienteId)
        .eq("ativo", true)
        .eq("obito", false)
        .order("nome"),
    ]);
    if (config.error || empresa.error || cliente.error || pets.error)
      throw new Error("Não foi possível conferir os dados da campanha.");
    if (!config.data || config.data.estado !== "conectada")
      throw new Error("Conecte o WhatsApp da clínica antes de enviar.");
    const c = cliente.data;
    if (!c || !c.ativo || c.deleted_at) throw new Error("Tutor não encontrado.");
    if (!c.aceita_mensagens) throw new Error("Este tutor não aceita receber mensagens.");
    const numero = telefoneWhatsApp(c.whatsapp || c.telefone);
    if (!numero) throw new Error("Tutor sem WhatsApp válido.");
    const texto = textoCampanha(
      modelo,
      { tutor: c.nome, pets: (pets.data ?? []).map((p) => p.nome) },
      empresa.data?.nome_fantasia || empresa.data?.razao_social || "Clínica",
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ja = await supabaseAdmin
      .from("clinica_wa_campanha_envios")
      .select("cliente_id,situacao")
      .eq("tenant_id", tenantId)
      .eq("campanha_id", data.campanhaId);
    if (ja.error) throw new Error("Não foi possível conferir a campanha.");
    const anterior = ja.data?.find((r) => r.cliente_id === data.clienteId);
    // nunca reenvia: o mesmo tutor na mesma campanha devolve o resultado já gravado
    if (anterior) return { situacao: anterior.situacao, repetido: true };
    if ((ja.data?.length ?? 0) >= MAX_CAMPANHA)
      throw new Error(`Cada campanha vai para no máximo ${MAX_CAMPANHA} tutores.`);

    const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const hoje = await supabaseAdmin
      .from("clinica_wa_campanha_envios")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", desde);
    if (hoje.error) throw new Error("Não foi possível conferir a campanha.");
    if ((hoje.count ?? 0) >= MAX_CAMPANHA_DIA)
      throw new Error(`Limite de ${MAX_CAMPANHA_DIA} mensagens de campanha por dia atingido.`);

    const reserva = await supabaseAdmin
      .from("clinica_wa_campanha_envios")
      .insert({
        campanha_id: data.campanhaId,
        tenant_id: tenantId,
        criado_por: context.userId,
        cliente_id: c.id,
        tutor: c.nome,
        numero,
        texto,
      })
      .select("id")
      .single();
    if (reserva.error)
      throw new Error("Envio não reservado. Confira o histórico antes de repetir.");

    const ev = await import("./whatsapp-evolution");
    const gravar = (campos: Record<string, string>) =>
      supabaseAdmin
        .from("clinica_wa_campanha_envios")
        .update({ ...campos, updated_at: new Date().toISOString() })
        .eq("id", reserva.data.id)
        .eq("tenant_id", tenantId);
    try {
      const r = await ev.enviarTexto(
        srv.configEvolution(),
        config.data.instancia,
        numero,
        texto,
        0,
      );
      const s = await gravar({ situacao: "enviada", id_externo: r.idMensagem });
      if (s.error) throw new Error("Enviada, mas o resultado não foi gravado.");
      return { situacao: "enviada", repetido: false };
    } catch (erro) {
      if (erro instanceof Error && erro.message.startsWith("Enviada")) throw erro;
      const incerto = !(erro instanceof ev.ErroEvolution) || erro.rede || erro.status >= 500;
      const situacao = incerto ? "incerto" : "falhou";
      await gravar({
        situacao,
        erro: erro instanceof Error ? erro.message.slice(0, 300) : "Falha no envio",
      });
      return { situacao, repetido: false };
    }
  });
