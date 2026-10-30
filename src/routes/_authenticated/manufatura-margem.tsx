import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { ManufaturaBloqueada } from "@/components/app/ManufaturaBloqueada";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useManufatura } from "@/hooks/useManufatura";
import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";
import { usePeriodo } from "@/lib/periodo";
import { PERFIS_GESTAO_MANUFATURA, margemDoPedido } from "@/lib/manufatura";

export const Route = createFileRoute("/_authenticated/manufatura-margem")({
  head: () => ({
    meta: [
      { title: "Margem por pedido — EZRA ERP" },
      {
        name: "description",
        content:
          "Quanto o cliente pagou e quanto custou produzir cada pedido sob medida, com lucro e margem.",
      },
    ],
  }),
  component: MargemModulo,
});

function MargemModulo() {
  const m = useManufatura();
  if (m.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!m.liberada) return <ManufaturaBloqueada motivo="modulo" />;
  if (!m.temPerfil(PERFIS_GESTAO_MANUFATURA)) return <ManufaturaBloqueada motivo="perfil" />;
  return <Margem />;
}

function Margem() {
  const { periodo, setDe, setAte } = usePeriodo();
  const { de, ate } = periodo;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["mf-margem-pedidos", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("mf_margem_pedidos", { p_de: de, p_ate: ate });
      if (error) throw error;
      return data ?? [];
    },
  });

  const linhas = useMemo(
    () =>
      (data ?? []).map((l) => ({
        ...l,
        ...margemDoPedido(Number(l.receita), Number(l.custo_real)),
      })),
    [data],
  );

  const totais = useMemo(() => {
    const receita = linhas.reduce((s, l) => s + Number(l.receita), 0);
    const custo = linhas.reduce((s, l) => s + Number(l.custo_real), 0);
    return { receita, custo, ...margemDoPedido(receita, custo) };
  }, [linhas]);

  const parcial = linhas.some((l) => l.ordens_abertas > 0);

  return (
    <div>
      <PageHeader
        title="Margem por pedido"
        description="O que o cliente pagou contra o custo real das ordens de produção do pedido."
      />

      <div className="panel mb-4 grid gap-3 p-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="mg-de">De</Label>
          <Input id="mg-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">
            Data do pedido. Mesmo período do dashboard.
          </p>
        </div>
        <div>
          <Label htmlFor="mg-ate">Até</Label>
          <Input id="mg-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : isError ? (
        <EmptyState
          title="Não foi possível carregar a margem"
          description="Verifique a conexão e tente de novo."
          action={<Button onClick={() => void refetch()}>Tentar de novo</Button>}
        />
      ) : linhas.length === 0 ? (
        <EmptyState
          title="Nenhum pedido com ordem de produção no período"
          description="Ao criar uma ordem, escolha o pedido do cliente para ver aqui o lucro do móvel."
        />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Receita" value={brl(totais.receita)} />
            <StatCard label="Custo de produção" value={brl(totais.custo)} />
            <StatCard label="Lucro" value={brl(totais.lucro)} />
            <StatCard
              label="Margem"
              value={totais.margem === null ? "—" : `${totais.margem.toLocaleString("pt-BR")}%`}
            />
          </div>
          {parcial && (
            <p className="mb-3 text-sm text-muted-foreground">
              Pedidos com ordem ainda aberta mostram custo parcial: o lucro real só fecha quando a
              produção é concluída.
            </p>
          )}
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">Custo estimado</TableHead>
                  <TableHead className="text-right">Custo real</TableHead>
                  <TableHead className="text-right">Lucro</TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={l.pedido_id}>
                    <TableCell>
                      <span className="font-medium">#{l.numero ?? "—"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{dateBR(l.data)}</span>
                    </TableCell>
                    <TableCell>{l.cliente ?? "—"}</TableCell>
                    <TableCell className="text-right">{brl(Number(l.receita))}</TableCell>
                    <TableCell className="text-right">{brl(Number(l.custo_estimado))}</TableCell>
                    <TableCell className="text-right">
                      {brl(Number(l.custo_real))}
                      {l.ordens_abertas > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          parcial
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className={`text-right ${l.lucro < 0 ? "text-destructive" : ""}`}>
                      {brl(l.lucro)}
                    </TableCell>
                    <TableCell className="text-right">
                      {l.margem === null ? "—" : `${l.margem.toLocaleString("pt-BR")}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
