import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { PortalShell } from "@/components/portal/PortalShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { exigirSessaoPortal } from "@/lib/portal-sessao";
import { avisoDoEstado, chavePortal, type EstadoItem } from "@/lib/portal-tutor";

export const Route = createFileRoute("/portal/animal/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Exames e receitas — Portal do tutor" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: exigirSessaoPortal,
  component: Animal,
});

type Itens = {
  pet: { id: string; nome: string; especie: string };
  exames: { id: string; nome: string; data_coleta: string; estado: EstadoItem }[];
  receitas: {
    id: string;
    titulo: string;
    numero: number;
    ano: number;
    emitido_em: string;
    estado: EstadoItem;
    veterinario: string;
  }[];
};

const data = (v: string) =>
  new Date(v.length === 10 ? `${v}T00:00:00` : v).toLocaleDateString("pt-BR");

function Animal() {
  const { id } = Route.useParams();
  const { user } = Route.useRouteContext();
  const itens = useQuery({
    queryKey: chavePortal(user.id, "animal", id),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("portal_pet_itens", { p_pet_id: id });
      if (error) throw error;
      return data as unknown as Itens;
    },
  });
  const d = itens.data;

  return (
    <PortalShell>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/portal">
          <ArrowLeft className="size-4" /> Meus animais
        </Link>
      </Button>

      {itens.isLoading ? (
        <div className="panel h-24 animate-pulse" />
      ) : itens.isError || !d ? (
        <p className="panel p-4 text-sm text-destructive" role="alert">
          Não foi possível abrir este animal. Ele pode não estar mais vinculado à sua conta.
        </p>
      ) : (
        <>
          <h1 className="break-words text-lg font-semibold">{d.pet.nome}</h1>

          <section aria-label="Exames" className="space-y-2">
            <h2 className="text-base font-semibold">Exames</h2>
            {d.exames.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum exame liberado pela clínica.</p>
            ) : (
              <ul className="space-y-2">
                {d.exames.map((e) => (
                  <li key={e.id} className="panel p-3">
                    {e.estado === "disponivel" ? (
                      <Link to="/portal/exame/$id" params={{ id: e.id }} className="block">
                        <p className="break-words font-medium">{e.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          Coleta em {data(e.data_coleta)}
                        </p>
                      </Link>
                    ) : (
                      <div>
                        <p className="break-words font-medium">{e.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {avisoDoEstado(e.estado, "exame")}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Receitas" className="space-y-2">
            <h2 className="text-base font-semibold">Receitas</h2>
            {d.receitas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma receita liberada pela clínica.
              </p>
            ) : (
              <ul className="space-y-2">
                {d.receitas.map((r) => (
                  <li key={r.id} className="panel p-3">
                    <Link to="/portal/receita/$id" params={{ id: r.id }} className="block">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="break-words font-medium">{r.titulo}</p>
                        {r.estado === "cancelado" && <Badge variant="destructive">Cancelada</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Nº {r.numero}/{r.ano} · emitida em {data(r.emitido_em)} · {r.veterinario}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </PortalShell>
  );
}
