import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { dateBR } from "@/lib/format";
import {
  etapasProducao,
  labelEtapa,
  proximaEtapa,
  statusEtapa,
  totalGrade,
  type LinhaGrade,
} from "@/lib/personalizacao";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/producao")({
  head: () => ({
    meta: [
      { title: "Produção — ERP Ze Tech" },
      { name: "description", content: "Impressão, prensa e montagem de cada pedido personalizado, com status e data." },
      { property: "og:title", content: "Produção — ERP Ze Tech" },
      { property: "og:description", content: "Acompanhe cada etapa da produção ligada ao pedido." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Producao,
});

type Registro = {
  id: string;
  pedido_id: string;
  etapa: string;
  arte_situacao: string;
  grade: LinhaGrade[];
  etapas_datas: Record<string, string>;
  pedidos: { numero: number; previsao_entrega: string | null; clientes: { nome: string } | null } | null;
};

const rotulo = { concluida: "Concluída", andamento: "Em andamento", aguardando: "Aguardando" } as const;

function Producao() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["personalizacao"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pedido_personalizacao")
        .select("id, pedido_id, etapa, arte_situacao, grade, etapas_datas, pedidos(numero, previsao_entrega, clientes(nome))")
        .neq("etapa", "entregue")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as Registro[];
    },
  });

  const avancar = useMutation({
    mutationFn: async ({ id, etapa }: { id: string; etapa: string }) => {
      const { error } = await supabase.from("pedido_personalizacao").update({ etapa }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Etapa atualizada");
      void qc.invalidateQueries({ queryKey: ["personalizacao"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Produção"
        description="Cada pedido personalizado com a impressão, a prensa e a montagem. A data mostra quando a etapa começou."
      />
      {isLoading ? (
        <div className="panel h-72 animate-pulse" />
      ) : data.length === 0 ? (
        <EmptyState
          title="Nada em produção"
          description="Pedidos criados com a Grade rápida aparecem aqui."
          action={<Button asChild><Link to="/personalizacao">Ir para Personalização</Link></Button>}
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead className="text-right">Pares</TableHead>
                {etapasProducao.map((e) => <TableHead key={e}>{labelEtapa(e)}</TableHead>)}
                <TableHead>Etapa atual</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r) => {
                const prox = proximaEtapa(r.etapa, r.arte_situacao);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link to="/pedidos/$id" params={{ id: r.pedido_id }} className="font-medium text-primary hover:underline">
                        Pedido nº {r.pedidos?.numero ?? "—"}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {r.pedidos?.clientes?.nome ?? "Sem cliente"}
                        {r.pedidos?.previsao_entrega ? ` · entrega ${dateBR(r.pedidos.previsao_entrega)}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-right text-numeric">{totalGrade(r.grade ?? [])}</TableCell>
                    {etapasProducao.map((e) => {
                      const s = statusEtapa(r.etapa, e);
                      const d = r.etapas_datas?.[e];
                      return (
                        <TableCell key={e}>
                          <Badge variant={s === "concluida" ? "default" : s === "andamento" ? "secondary" : "outline"}>
                            {rotulo[s]}
                          </Badge>
                          {d && s !== "aguardando" && <p className="mt-1 text-xs text-muted-foreground">início {dateBR(d)}</p>}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-sm">
                      {labelEtapa(r.etapa)}
                      {r.etapa === "aguardando_arte" && r.arte_situacao !== "aprovada" && (
                        <p className="text-xs text-muted-foreground">arte ainda não aprovada</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {prox && (
                        <Button size="sm" disabled={avancar.isPending} onClick={() => avancar.mutate({ id: r.id, etapa: prox })}>
                          {labelEtapa(prox)} <ChevronRight className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
