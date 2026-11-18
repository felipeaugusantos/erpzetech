import { useQuery } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { AnexoClinico } from "@/lib/anexos";
import { dateTimeBR } from "@/lib/format";

export function AvisoExamesConsulta({ atendimentoId }: { atendimentoId: string }) {
  const lista = useQuery({
    queryKey: ["clinica-anexos", atendimentoId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_anexos", {
        p_atendimento_id: atendimentoId,
      });
      if (error) throw error;
      return (data ?? []) as unknown as AnexoClinico[];
    },
  });
  const ativos = (lista.data ?? []).filter((a) => a.situacao === "ativo");
  if (lista.error)
    return (
      <p className="text-xs text-destructive">Não foi possível conferir os exames anexados.</p>
    );
  if (!ativos.length) return null;
  const datas = ativos.map((a) => a.created_at).sort();
  const ultima = datas.at(-1);
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-primary">
      <Paperclip className="size-4 shrink-0" />
      <span>Observação: Tem Exames</span>
      {ultima && <span className="text-muted-foreground">Inclusão: {dateTimeBR(ultima)}</span>}
    </p>
  );
}
