import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { consultaProxima } from "@/lib/proxima-consulta";
import { dateTimeBR } from "@/lib/format";

function useRelogioConsulta() {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const atualizar = () => setAgora(Date.now());
    const timer = window.setInterval(atualizar, 30_000);
    window.addEventListener("focus", atualizar);
    document.addEventListener("visibilitychange", atualizar);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", atualizar);
      document.removeEventListener("visibilitychange", atualizar);
    };
  }, []);
  return agora;
}

export function AlertaConsulta({ inicio, situacao }: { inicio: string; situacao: string }) {
  const agora = useRelogioConsulta();
  if (!consultaProxima(inicio, situacao, agora)) return null;
  return <span className="mt-2 inline-flex items-center gap-1.5 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-xs font-semibold text-warning" aria-label="Alerta de consulta nas próximas 24 horas"><BellRing className="size-3.5 shrink-0" />Consulta nas próximas 24h</span>;
}

type Consulta = { id: string; inicio: string; veterinario: string; situacao: string };

export function AlertasConsultaPaciente({ petId }: { petId: string }) {
  const agora = useRelogioConsulta();
  const { data, error } = useQuery({
    queryKey: ["clinica-proxima-consulta", petId],
    refetchInterval: 60_000,
    refetchOnMount: "always",
    queryFn: async () => {
      const r = await supabase.rpc("clinica_proxima_consulta_opcoes", { p_pet_id: petId });
      if (r.error) throw r.error;
      return r.data as unknown as { consultas: Consulta[] };
    },
  });
  if (error) return <p role="status" className="border-l-2 border-warning px-3 py-2 text-sm text-muted-foreground">Não foi possível atualizar os alertas de consulta.</p>;
  const consultas = (data?.consultas ?? []).filter((c) => consultaProxima(c.inicio, c.situacao, agora));
  if (!consultas.length) return null;
  return <section aria-label="Alertas de próxima consulta" aria-live="polite" className="space-y-2 border-l-4 border-warning bg-warning/10 px-4 py-3">
    <h3 className="flex items-center gap-2 text-sm font-semibold"><BellRing className="size-4 shrink-0 text-warning" />Consulta nas próximas 24 horas</h3>
    {consultas.map((c) => <p key={c.id} className="text-sm"><strong>{dateTimeBR(c.inicio)}</strong> · {c.veterinario}</p>)}
  </section>;
}