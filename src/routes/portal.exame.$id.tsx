import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { PortalShell } from "@/components/portal/PortalShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { exigirSessaoPortal } from "@/lib/portal-sessao";
import {
  agruparResultados,
  avisoDoEstado,
  chavePortal,
  referenciaDoResultado,
  valorDoResultado,
  type EstadoItem,
  type ResultadoExame,
} from "@/lib/portal-tutor";

export const Route = createFileRoute("/portal/exame/$id")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Exame — Portal do tutor" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  beforeLoad: exigirSessaoPortal,
  component: Exame,
});

type Exame = {
  estado: EstadoItem;
  pet: { id: string; nome: string; especie: string };
  nome: string;
  data_coleta?: string;
  material?: string | null;
  laboratorio?: string | null;
  clinica?: string | null;
  veterinario?: { nome: string; crmv: string; crmv_uf: string };
  anexos?: number;
  resultados?: ResultadoExame[];
};

function Exame() {
  const { id } = Route.useParams();
  const exame = useQuery({
    queryKey: chavePortal("exame", id),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("portal_exame_obter", { p_id: id });
      if (error) throw error;
      return data as unknown as Exame;
    },
  });
  const e = exame.data;

  return (
    <PortalShell>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/portal">
          <ArrowLeft className="size-4" /> Meus animais
        </Link>
      </Button>

      {exame.isLoading ? (
        <div className="panel h-24 animate-pulse" />
      ) : exame.isError || !e ? (
        <p className="panel p-4 text-sm text-destructive" role="alert">
          Não foi possível abrir este exame. Ele pode não estar mais disponível para a sua conta.
        </p>
      ) : e.estado !== "disponivel" ? (
        <div className="panel space-y-1 p-4">
          <h1 className="break-words text-lg font-semibold">{e.nome}</h1>
          <p className="text-sm" role="status">
            {avisoDoEstado(e.estado, "exame")}
          </p>
        </div>
      ) : (
        <>
          <div>
            <h1 className="break-words text-lg font-semibold">{e.nome}</h1>
            <p className="text-sm text-muted-foreground">
              {e.pet.nome}
              {e.data_coleta
                ? ` · coleta em ${new Date(`${e.data_coleta}T00:00:00`).toLocaleDateString("pt-BR")}`
                : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {[e.material, e.laboratorio].filter(Boolean).join(" · ")}
              {e.clinica ? ` · ${e.clinica}` : ""}
            </p>
            {e.veterinario && (
              <p className="text-xs text-muted-foreground">
                {e.veterinario.nome} · CRMV {e.veterinario.crmv}/{e.veterinario.crmv_uf}
              </p>
            )}
          </div>

          {agruparResultados(e.resultados ?? []).map((g) => (
            <section key={g.grupo} className="panel p-3" aria-label={g.grupo}>
              <h2 className="text-sm font-semibold">{g.grupo}</h2>
              <ul className="mt-1 divide-y divide-border">
                {g.itens.map((r, i) => {
                  const ref = referenciaDoResultado(r);
                  return (
                    <li key={`${r.nome}-${i}`} className="py-2 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="min-w-0 break-words">{r.nome}</span>
                        <strong className="break-words">{valorDoResultado(r)}</strong>
                      </div>
                      {ref && (
                        <p className="text-xs text-muted-foreground">
                          Referência da clínica{r.unidade ? ` (${r.unidade})` : ""}: {ref}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {(e.anexos ?? 0) > 0 && (
            <p className="text-sm text-muted-foreground">
              A clínica anexou {e.anexos} {e.anexos === 1 ? "arquivo" : "arquivos"} a este exame
              (laudo ou imagem). Ainda não{" "}
              {e.anexos === 1 ? "está disponível" : "estão disponíveis"} no portal: peça à clínica.
            </p>
          )}
        </>
      )}
    </PortalShell>
  );
}
