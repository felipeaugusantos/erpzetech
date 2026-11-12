import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Pill, Printer } from "lucide-react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { SeletorPeriodo } from "@/components/app/SeletorPeriodo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { dateTimeBR } from "@/lib/format";
import { periodoDoAtalho, type Periodo } from "@/lib/periodo";

export const Route = createFileRoute("/_authenticated/clinica-receitas")({
  head: () => ({
    meta: [
      { title: "Receitas — ERP Ze Tech" },
      { name: "description", content: "Receitas emitidas com data, remédios e doses de cada paciente." },
      { property: "og:title", content: "Receitas — ERP Ze Tech" },
      { property: "og:description", content: "Acompanhe o tratamento de cada paciente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReceitasModulo,
});

type ItemReceita = {
  medicamento: string;
  posologia: string;
  via?: string;
  duracao?: string;
  quantidade?: string;
};
type Receita = {
  id: string;
  ano: number;
  numero: number;
  titulo: string;
  situacao: "emitido" | "cancelado";
  emitido_em: string;
  pet_id: string;
  pet: string;
  tutor: string | null;
  veterinario: string | null;
  itens: ItemReceita[];
};

function ReceitasModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Receitas />;
}

function Receitas() {
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDoAtalho("30d"));
  const [filtro, setFiltro] = useState("");
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(periodo.de) && /^\d{4}-\d{2}-\d{2}$/.test(periodo.ate);

  const lista = useQuery({
    queryKey: ["clinica-receitas", periodo.de, periodo.ate],
    enabled: valido,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_receitas", {
        p_de: periodo.de,
        p_ate: periodo.ate,
      });
      if (error) throw error;
      return (data ?? []) as unknown as Receita[];
    },
  });

  const visiveis = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    const todas = lista.data ?? [];
    if (!t) return todas;
    return todas.filter(
      (r) =>
        r.pet.toLowerCase().includes(t) ||
        (r.tutor ?? "").toLowerCase().includes(t) ||
        r.itens.some((i) => i.medicamento.toLowerCase().includes(t)),
    );
  }, [lista.data, filtro]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Receitas"
        description="Receitas emitidas, com os remédios e as doses, para acompanhar o tratamento de cada paciente."
      />
      <SeletorPeriodo periodo={periodo} aoMudar={setPeriodo} />
      <Input
        placeholder="Filtrar por pet, tutor ou remédio"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        className="max-w-md"
      />

      {lista.isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lista.error ? (
        <p className="text-sm text-destructive">{(lista.error as Error).message}</p>
      ) : visiveis.length === 0 ? (
        <EmptyState
          title="Nenhuma receita no período"
          description="As receitas emitidas no prontuário ou no atendimento aparecem aqui."
        />
      ) : (
        <div className="space-y-3">
          {visiveis.map((r) => (
            <div key={r.id} className="panel p-4">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-display font-semibold">
                    <Link
                      to="/clinica-prontuario"
                      search={{ pet: r.pet_id }}
                      className="underline-offset-2 hover:underline"
                    >
                      {r.pet}
                    </Link>
                    {r.tutor && (
                      <span className="font-normal text-muted-foreground"> · {r.tutor}</span>
                    )}
                    {r.situacao === "cancelado" && (
                      <Badge variant="destructive" className="ml-2">
                        Cancelada
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    nº {r.numero}/{r.ano} · {dateTimeBR(r.emitido_em)}
                    {r.veterinario ? ` · ${r.veterinario}` : ""}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/clinica-documento" search={{ id: r.id }}>
                    <Printer className="size-4" /> Abrir / imprimir
                  </Link>
                </Button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">Remédio</th>
                    <th className="py-1 font-medium">Dose / modo de usar</th>
                    <th className="hidden py-1 font-medium sm:table-cell">Duração</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {r.itens.map((i, k) => (
                    <tr key={k} className={r.situacao === "cancelado" ? "opacity-60" : ""}>
                      <td className="py-1.5 pr-3 font-medium">
                        {i.medicamento}
                        {i.quantidade ? (
                          <span className="font-normal text-muted-foreground"> · {i.quantidade}</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3">
                        {i.posologia}
                        {i.via ? <span className="text-muted-foreground"> · {i.via}</span> : null}
                      </td>
                      <td className="hidden py-1.5 sm:table-cell">{i.duracao || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
