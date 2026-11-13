import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import { limparArquivosExcluidos } from "./exame-exclusao";

export const limparPdfsExcluidos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: logs, error } = await context.supabase.from("clinica_exames_exclusoes")
      .select("id").eq("usuario_id", context.userId).order("excluido_em", { ascending: false }).limit(100);
    if (error) throw new Error("Não foi possível consultar as exclusões.");
    if (!logs?.length) return { pendentes: 0 };
    const autorizados: string[] = [];
    for (const log of logs) {
      const acesso = await context.supabase.rpc("clinica_exame_exclusao_acesso", { p_id: log.id });
      if (!acesso.error && acesso.data) autorizados.push(log.id);
    }
    if (!autorizados.length) return { pendentes: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const arquivos = await supabaseAdmin.from("clinica_exames_limpeza").select("id,caminho,tentativas")
      .in("exclusao_id", autorizados).is("concluido_em", null).limit(200);
    if (arquivos.error) throw new Error("Limpeza dos PDFs pendente. Tente novamente.");
    return limparArquivosExcluidos(arquivos.data ?? [], async caminho => {
      const resposta = await supabaseAdmin.storage.from("clinica-anexos").remove([caminho]);
      return !resposta.error;
    }, async (id, sucesso) => {
      const anterior = arquivos.data?.find(a => a.id === id);
      const registro = await supabaseAdmin.from("clinica_exames_limpeza").update({
        concluido_em: sucesso ? new Date().toISOString() : null,
        tentativas: (anterior?.tentativas ?? 0) + 1,
        erro: sucesso ? null : "Remoção do arquivo pendente; tentar novamente.",
      }).eq("id", id);
      if (registro.error) throw new Error("Limpeza dos PDFs pendente. Tente novamente.");
    });
  });