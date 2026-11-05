import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";

import { PortalShell } from "@/components/portal/PortalShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { exigirSessaoPortal } from "@/lib/portal-sessao";
import { avisoDoEstado, chavePortal, type EstadoItem } from "@/lib/portal-tutor";

export const Route = createFileRoute("/portal/receita/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Receita — Portal do tutor" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: exigirSessaoPortal,
  component: Receita,
});

type ItemReceita = {
  medicamento?: string;
  posologia?: string;
  via?: string;
  duracao?: string;
  quantidade?: string;
};

type Receita = {
  estado: EstadoItem;
  pet: { id: string; nome: string; especie: string };
  titulo: string;
  numero?: number;
  ano?: number;
  emitido_em?: string;
  cancelado_em?: string | null;
  itens?: ItemReceita[];
  orientacoes?: string | null;
  clinica?: string | null;
  veterinario?: { nome: string; crmv: string; crmv_uf: string };
};

const data = (v: string) => new Date(v).toLocaleDateString("pt-BR");

function Receita() {
  const { id } = Route.useParams();
  const { user } = Route.useRouteContext();
  const receita = useQuery({
    queryKey: chavePortal(user.id, "receita", id),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("portal_receita_obter", { p_id: id });
      if (error) throw error;
      return data as unknown as Receita;
    },
  });
  const r = receita.data;

  return (
    <PortalShell>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/portal">
          <ArrowLeft className="size-4" /> Meus animais
        </Link>
      </Button>

      {receita.isLoading ? (
        <div className="panel h-24 animate-pulse" />
      ) : receita.isError || !r ? (
        <p className="panel p-4 text-sm text-destructive" role="alert">
          Não foi possível abrir esta receita. Ela pode não estar mais disponível para a sua conta.
        </p>
      ) : r.estado !== "disponivel" ? (
        <div className="panel space-y-1 p-4">
          <h1 className="break-words text-lg font-semibold">{r.titulo}</h1>
          {r.numero && r.ano && (
            <p className="text-xs text-muted-foreground">
              Nº {r.numero}/{r.ano}
              {r.emitido_em ? ` · emitida em ${data(r.emitido_em)}` : ""}
              {r.cancelado_em ? ` · cancelada em ${data(r.cancelado_em)}` : ""}
            </p>
          )}
          <p className="text-sm font-medium text-destructive" role="status">
            {avisoDoEstado(r.estado, "receita")}
          </p>
        </div>
      ) : (
        <>
          <div>
            <h1 className="break-words text-lg font-semibold">{r.titulo}</h1>
            <p className="text-sm text-muted-foreground">
              {r.pet.nome} · Nº {r.numero}/{r.ano}
              {r.emitido_em ? ` · emitida em ${data(r.emitido_em)}` : ""}
            </p>
          </div>

          <ol className="space-y-2" aria-label="Medicamentos">
            {(r.itens ?? []).map((i, k) => (
              <li key={k} className="panel p-3 text-sm">
                <p className="break-words font-medium">{i.medicamento}</p>
                {i.posologia && <p className="break-words">{i.posologia}</p>}
                <p className="text-xs text-muted-foreground">
                  {[
                    i.via && `Via ${i.via}`,
                    i.duracao && `Duração: ${i.duracao}`,
                    i.quantidade && `Quantidade: ${i.quantidade}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ol>

          {r.orientacoes && (
            <section className="panel p-3" aria-label="Orientações">
              <h2 className="text-sm font-semibold">Orientações</h2>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.orientacoes}</p>
            </section>
          )}

          <p className="text-xs text-muted-foreground">
            {r.veterinario
              ? `${r.veterinario.nome} · CRMV ${r.veterinario.crmv}/${r.veterinario.crmv_uf}`
              : ""}
            {r.clinica ? ` · ${r.clinica}` : ""}
          </p>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="size-4" /> Imprimir
          </Button>
        </>
      )}
    </PortalShell>
  );
}
