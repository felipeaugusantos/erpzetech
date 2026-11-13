import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, FileText, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { type ResumoExame, SITUACOES_EXAME } from "@/lib/exames";
import { dateBR } from "@/lib/format";
import { rotulo } from "@/lib/pet";

export function ExamesProntuario({ petId }: { petId: string }) {
  const lista = useQuery({
    queryKey: ["clinica-exames-pet", petId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exames_do_pet", { p_pet_id: petId });
      if (error) throw error;
      return data as unknown as { exames: ResumoExame[] };
    },
  });
  const exames = [...(lista.data?.exames ?? [])].sort((a, b) =>
    b.data_coleta.localeCompare(a.data_coleta) || b.aberto_em.localeCompare(a.aberto_em),
  );

  return (
    <section className="min-w-0 border-y border-border py-5" aria-label="Exames do paciente">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <FlaskConical className="size-5 text-primary" /> Exames do paciente
          {lista.data && <Badge variant="secondary">{exames.length}</Badge>}
        </h3>
        <Button asChild size="sm" variant="outline">
          <Link to="/clinica-laudos" search={{ pet: petId }}><FileText className="size-4" /> Laudos e evolução</Link>
        </Button>
      </div>
      {lista.isPending ? <div className="h-24 animate-pulse bg-muted" aria-label="Carregando exames" /> : lista.error ? (
        <div className="grid justify-items-start gap-2">
          <p role="alert" className="text-sm text-destructive">Não foi possível carregar os exames: {lista.error.message}</p>
          <Button size="sm" variant="outline" onClick={() => void lista.refetch()}>Tentar novamente</Button>
        </div>
      ) : !exames.length ? <p className="text-sm text-muted-foreground">Nenhum exame registrado para este paciente.</p> : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {exames.map(exame => (
            <li key={exame.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-border bg-card p-4">
              <div className="flex shrink-0 items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-primary">
                <CalendarDays className="size-5" />
                <div><p className="text-xs font-medium">Data da coleta</p><time dateTime={exame.data_coleta} className="block text-lg font-semibold tabular-nums">{dateBR(exame.data_coleta)}</time></div>
              </div>
              <div className="min-w-0 flex-1 basis-32">
                <h4 className="break-words font-semibold">{exame.nome}</h4>
                <Badge className="mt-1" variant={exame.situacao === "fechado" ? "default" : "outline"}>{rotulo(SITUACOES_EXAME, exame.situacao)}</Badge>
                {exame.laboratorio && <p className="mt-1 break-words text-sm text-muted-foreground">{exame.laboratorio}</p>}
                <p className="mt-1 break-words text-xs text-muted-foreground">{exame.veterinario}</p>
              </div>
              <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
                <Link to="/clinica-exames" search={{ pet: petId, exame: exame.id, atendimento: undefined }}><FileText className="size-4" />{exame.situacao === "fechado" ? "Ver laudo" : "Ver exame"}</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}