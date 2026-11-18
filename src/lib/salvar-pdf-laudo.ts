import { supabase } from "@/integrations/supabase/client";

export type ReservaPdfLaudo = {
  id: string;
  caminho: string;
  enviado: boolean;
  confirmado: boolean;
};
export async function salvarPdfLaudo(
  exameId: string,
  arquivo: File,
  reservas: Map<string, ReservaPdfLaudo>,
  nome?: string,
) {
  const base = (nome?.trim() || arquivo.name).replace(/[\\/:*?"<>|]/g, "-").replace(/\.pdf$/i, "");
  const nomeArquivo = (base.length > 116 ? base.slice(0, 116) : base) + ".pdf";
  let reserva = reservas.get(exameId);
  if (!reserva) {
    const { data, error } = await supabase.rpc("clinica_anexo_preparar", {
      p_dados: {
        exame_id: exameId,
        categoria: "laudo",
        descricao: "PDF original do laudo importado",
        nome_arquivo: nomeArquivo,
        mime: "application/pdf",
        tamanho: arquivo.size,
      },
    });
    if (error) throw error;
    reserva = {
      ...(data as unknown as { id: string; caminho: string }),
      enviado: false,
      confirmado: false,
    };
    reservas.set(exameId, reserva);
  }
  if (reserva.confirmado) return;
  if (!reserva.enviado) {
    const { error } = await supabase.storage
      .from("clinica-anexos")
      .upload(reserva.caminho, arquivo, { contentType: "application/pdf", upsert: false });
    if (error) {
      const { error: confirmacao } = await supabase.rpc("clinica_anexo_confirmar", {
        p_id: reserva.id,
      });
      if (confirmacao) throw error;
      reserva.confirmado = true;
      return;
    }
    reserva.enviado = true;
  }
  const { error } = await supabase.rpc("clinica_anexo_confirmar", { p_id: reserva.id });
  if (error) throw error;
  reserva.confirmado = true;
}
