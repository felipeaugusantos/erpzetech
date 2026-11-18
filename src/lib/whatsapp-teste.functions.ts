import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import { entradaTesteWhatsApp, textoTesteWhatsApp } from "./whatsapp-teste";
import { exigirAcessoTesteWhatsApp } from "./whatsapp-teste-acesso";

export const whatsappTeste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        dados: entradaTesteWhatsApp,
        envio: z.object({ id: z.guid(), textoConfirmado: z.string().max(5000) }).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await exigirAcessoTesteWhatsApp((papel) => db.rpc("has_role", {
      _user_id: context.userId,
      _role: papel,
    }));
    const clinica = await db.rpc("clinica_liberada");
    if (clinica.error || !clinica.data) throw new Error("Clínica não liberada.");
    const tenant = await db.rpc("current_tenant_id");
    if (tenant.error || !tenant.data) throw new Error("Sessão sem empresa.");
    const tenantId = String(tenant.data);
    const srv = await import("./whatsapp.server");
    srv.exigirEmpresaLiberada(tenantId);
    const [config, empresa, modelo] = await Promise.all([
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
      db.from("pet_mensagem_modelos").select("texto").eq("tipo", data.dados.modelo).maybeSingle(),
    ]);
    if (config.error || empresa.error || modelo.error)
      throw new Error("Não foi possível conferir a configuração do teste.");
    if (!config.data || config.data.estado !== "conectada")
      throw new Error("Conecte o WhatsApp antes de testar.");
    if (!data.dados.numero) throw new Error("Informe o número com DDD.");
    if (data.dados.numero === config.data.numero)
      throw new Error("Use outro número, diferente do WhatsApp conectado.");
    const texto = textoTesteWhatsApp(
      data.dados,
      empresa.data?.nome_fantasia || empresa.data?.razao_social || "Clínica",
      modelo.data?.texto,
    );
    if (!data.envio) return { texto, situacao: "previa" };
    if (data.envio.textoConfirmado !== texto)
      throw new Error("O modelo mudou. Confira a prévia novamente antes de enviar.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const existente = await supabaseAdmin
      .from("clinica_wa_testes")
      .select("situacao")
      .eq("tenant_id", tenantId)
      .eq("id", data.envio.id)
      .maybeSingle();
    if (existente.error) throw new Error("Não foi possível conferir o teste anterior.");
    if (existente.data) return { texto, situacao: existente.data.situacao };
    const reserva = await supabaseAdmin.from("clinica_wa_testes").insert({
      id: data.envio.id,
      tenant_id: tenantId,
      criado_por: context.userId,
      numero: data.dados.numero,
      modelo: data.dados.modelo,
      texto,
    });
    if (reserva.error)
      throw new Error("O teste não foi reservado. Confira a lista antes de tentar novamente.");
    const ev = await import("./whatsapp-evolution");
    let resultado: { idMensagem: string; jid: string | null };
    try {
      resultado = await ev.enviarTexto(
        srv.configEvolution(),
        config.data.instancia,
        data.dados.numero,
        texto,
        0,
      );
    } catch (erro) {
      const incerto = !(erro instanceof ev.ErroEvolution) || erro.rede || erro.status >= 500;
      const situacao = incerto ? "incerto" : "falhou";
      const mensagem = erro instanceof Error ? erro.message.slice(0, 300) : "Falha no envio";
      const salvo = await supabaseAdmin
        .from("clinica_wa_testes")
        .update({ situacao, erro: mensagem, updated_at: new Date().toISOString() })
        .eq("id", data.envio.id)
        .eq("tenant_id", tenantId);
      if (salvo.error)
        throw new Error("Resultado não gravado. Confira o WhatsApp antes de repetir o teste.");
      return { texto, situacao };
    }
    const salvo = await supabaseAdmin
      .from("clinica_wa_testes")
      .update({
        situacao: "enviada",
        id_externo: resultado.idMensagem,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.envio.id)
      .eq("tenant_id", tenantId);
    if (salvo.error)
      throw new Error(
        "Serviço aceitou, mas não foi possível guardar o resultado. Não repita sem conferir o celular.",
      );
    const statuses = await supabaseAdmin
      .from("clinica_wa_teste_status")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id_externo", resultado.idMensagem);
    if (statuses.error)
      throw new Error(
        "Serviço aceitou; acompanhamento pendente. Confira a lista antes de repetir.",
      );
    for (const status of statuses.data ?? []) {
      const conciliado = await supabaseAdmin.rpc("clinica_wa_teste_status", {
        p_instancia: config.data.instancia,
        p_id_externo: resultado.idMensagem,
        p_status: status.status,
      });
      if (conciliado.error)
        throw new Error("Serviço aceitou; confirmação pendente de atualização.");
    }
    return { texto, situacao: "enviada" };
  });
