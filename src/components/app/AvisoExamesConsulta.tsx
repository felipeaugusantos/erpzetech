import { useQuery } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { AnexoClinico } from "@/lib/anexos";
import { dateTimeBR } from "@/lib/format";
import type { ResumoExame } from "@/lib/exames";
import { examesDaConsulta } from "@/lib/exames-consulta";

export function AvisoExamesConsulta({ atendimentoId, petId, dia, consultasNoDia }: {
  atendimentoId: string; petId: string; dia: string; consultasNoDia: number;
}) {
  const exames = useQuery({
    queryKey: ["clinica-exames-pet", petId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exames_do_pet", { p_pet_id: petId });
      if (error) throw error;
      return data as unknown as { exames: ResumoExame[] };
    },
  });
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
  const relacionados = examesDaConsulta(exames.data?.exames ?? [], atendimentoId, dia, consultasNoDia);
  if (lista.error || exames.error)
    return (
      <p className="text-xs text-destructive">Não foi possível conferir os exames anexados.</p>
    );
  if (!ativos.length && !relacionados.length) return null;
  const datas = [...ativos.map((a) => a.created_at), ...relacionados.map((e) => e.aberto_em)].sort();
  const ultima = datas.at(-1);
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-primary">
      <Paperclip className="size-4 shrink-0" />
      <span>Observação: Tem Exames</span>
      {ultima && <span className="text-muted-foreground">Inclusão: {dateTimeBR(ultima)}</span>}
    </p>
  );
}
