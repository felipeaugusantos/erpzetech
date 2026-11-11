import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  resumirHistoricoClinico,
  resumoIaLiberado,
  type ResultadoResumo,
} from "@/lib/clinica-resumo-ia.functions";
import { dateBR } from "@/lib/format";

/** Rascunho de leitura do histórico: não é gravado, não vira adendo e não altera o prontuário. */
export function ResumoIaClinica({
  petId,
  souVeterinario,
}: {
  petId: string;
  souVeterinario: boolean;
}) {
  const [resultado, setResultado] = useState<ResultadoResumo | null>(null);
  const liberado = useQuery({
    // "clinica-" no início: o cache persistido do navegador não guarda esta consulta
    queryKey: ["clinica-resumo-ia-liberado"],
    staleTime: Number.POSITIVE_INFINITY,
    enabled: souVeterinario,
    queryFn: () => resumoIaLiberado(),
  });
  const gerar = useMutation({
    mutationFn: () => resumirHistoricoClinico({ data: { petId } }),
    onSuccess: setResultado,
    onError: (e: Error) => toast.error("Não foi possível resumir", { description: e.message }),
  });

  if (!souVeterinario || !liberado.data) return null;

  const r = resultado && !resultado.vazio ? resultado.resumo : null;
  return (
    <div className="panel p-4" data-testid="resumo-ia">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold">Resumo do histórico</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => gerar.mutate()}
          disabled={gerar.isPending}
        >
          <Sparkles className="mr-1 h-4 w-4" />
          {gerar.isPending ? "Resumindo…" : r ? "Resumir de novo" : "Resumir histórico"}
        </Button>
      </div>
      {resultado?.vazio && (
        <p className="mt-2 text-sm text-muted-foreground">
          Ainda não há atendimento nem alergia escrita para resumir.
        </p>
      )}
      {r && (
        <div className="mt-3 grid gap-3 text-sm">
          <p
            role="note"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
          >
            Resumo gerado por IA a partir do que está escrito, sem diagnóstico nem sugestão de
            tratamento. Confira no prontuário abaixo. Não foi gravado.
          </p>
          <p>{r.visao_geral}</p>
          {r.alergias && (
            <p>
              <strong>Alergias:</strong> {r.alergias}
            </p>
          )}
          {r.linha_do_tempo.length > 0 && (
            <ul className="grid gap-1">
              {r.linha_do_tempo.map((l, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">
                    {/^\d{4}-\d{2}-\d{2}$/.test(l.data) ? dateBR(l.data) : l.data}
                  </span>{" "}
                  — {l.fato}
                </li>
              ))}
            </ul>
          )}
          {r.pendencias.length > 0 && (
            <div>
              <strong>Pendências:</strong>
              <ul className="ml-4 list-disc">
                {r.pendencias.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {r.faltou && (
            <p className="text-muted-foreground">
              <strong>Não consta:</strong> {r.faltou}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
