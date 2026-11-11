import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useRealtimeTabelas } from "@/hooks/useRealtimeTabelas";
import { useRelogio } from "@/hooks/useRelogio";
import type { Chamado } from "@/lib/chamados";
import { minutosDesde } from "@/lib/restaurante";
import { CHAVE_REST, rpcRestaurante, tabela, type Mesa } from "@/lib/restaurante-dados";

/** Chamados abertos pelo QR code das mesas: a equipe marca como atendido. */
export function ChamadosBar({ mesas }: { mesas: Mesa[] }) {
  const qc = useQueryClient();
  const agora = useRelogio();

  useRealtimeTabelas(["restaurante_chamados"], () =>
    qc.invalidateQueries({ queryKey: [CHAVE_REST, "chamados"] }),
  );

  const { data: chamados = [] } = useQuery({
    queryKey: [CHAVE_REST, "chamados"],
    // reforço do tempo real
    refetchInterval: 30_000,
    queryFn: async () => {
      const r = await tabela("restaurante_chamados")
        .select("id, mesa_id, motivo, situacao, criado_em")
        .eq("situacao", "aberto")
        .order("criado_em");
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []) as unknown as Chamado[];
    },
  });

  const atender = useMutation({
    mutationFn: (id: string) => rpcRestaurante("restaurante_chamado_atender", { p_id: id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [CHAVE_REST, "chamados"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (chamados.length === 0) return null;

  return (
    <section
      aria-label="Chamados das mesas"
      className="mb-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-3"
    >
      <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold">
        <BellRing className="size-5 animate-pulse" /> Chamados ({chamados.length})
      </h2>
      <ul className="flex flex-wrap gap-2">
        {chamados.map((c) => {
          const mesa = mesas.find((m) => m.id === c.mesa_id);
          return (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm"
            >
              <span>
                <strong>Mesa {mesa?.numero ?? "?"}</strong> · {c.motivo}
                <span className="block text-xs text-muted-foreground">
                  há {minutosDesde(c.criado_em, agora)} min
                </span>
              </span>
              <Button size="sm" disabled={atender.isPending} onClick={() => atender.mutate(c.id)}>
                Atendi
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
