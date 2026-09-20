import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, FileText, PackageOpen, Percent, Wrench } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateTimeBR, num } from "@/lib/format";
import { usePeriodo } from "@/lib/periodo";
import { useSaasOperador } from "@/lib/saas";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/ze-tech-tempo-real")({
  head: () => ({
    meta: [
      { title: "Tempo real dos clientes — Ze Tech" },
      {
        name: "description",
        content:
          "Vendas, notas fiscais, impostos e assistência técnica de cada loja cliente lidos direto do banco, atualizados automaticamente.",
      },
      { property: "og:title", content: "Tempo real dos clientes — Ze Tech" },
      {
        property: "og:description",
        content: "Vendas, notas, impostos e assistência técnica de cada cliente em tempo real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TempoReal,
});

function TempoReal() {
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const { periodo, setDe, setAte } = usePeriodo();

  const { data: linhas = [], isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["saas-tempo-real", periodo.de, periodo.ate],
    enabled: operador === true,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("saas_tempo_real_por_cliente", {
        p_de: periodo.de,
        p_ate: periodo.ate,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const totais = useMemo(
    () =>
      linhas.reduce(
        (acc, l) => ({
          vendas: acc.vendas + Number(l.valor_vendas ?? 0),
          pedidos: acc.pedidos + Number(l.pedidos ?? 0),
          notas: acc.notas + Number(l.notas ?? 0),
          valorNotas: acc.valorNotas + Number(l.valor_notas ?? 0),
          notasServico: acc.notasServico + Number(l.notas_servico ?? 0),
          valorServico: acc.valorServico + Number(l.valor_notas_servico ?? 0),
          locacoes: acc.locacoes + Number(l.locacoes ?? 0),
          valorLocacoes: acc.valorLocacoes + Number(l.valor_locacoes ?? 0),
          locacoesAbertas: acc.locacoesAbertas + Number(l.locacoes_abertas ?? 0),
          impostos: acc.impostos + Number(l.impostos ?? 0),
          os: acc.os + Number(l.os_abertas ?? 0),
          osCusto: acc.osCusto + Number(l.os_custo ?? 0),
        }),
        {
          vendas: 0,
          pedidos: 0,
          notas: 0,
          valorNotas: 0,
          notasServico: 0,
          valorServico: 0,
          locacoes: 0,
          valorLocacoes: 0,
          locacoesAbertas: 0,
          impostos: 0,
          os: 0,
          osCusto: 0,
        },
      ),
    [linhas],
  );

  if (carregandoAcesso) {
    return <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>;
  }

  if (operador !== true) {
    return (
      <EmptyState
        title="Área exclusiva da equipe Ze Tech."
        description="Entre com um acesso da equipe para acompanhar os clientes em tempo real."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Tempo real dos clientes"
        description="Vendas, notas fiscais, impostos e assistência técnica de cada loja, lidos direto do sistema dela e atualizados a cada 30 segundos."
      />

      <div className="panel mb-5 flex flex-wrap items-end gap-3 p-3">
        <div>
          <Label>De</Label>
          <Input type="date" value={periodo.de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <Label>Até</Label>
          <Input type="date" value={periodo.ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Atualizado em {dataUpdatedAt ? dateTimeBR(new Date(dataUpdatedAt).toISOString()) : "—"}
        </p>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Vendas no período"
          value={brl(totais.vendas)}
          hint={`${num(totais.pedidos, 0)} pedidos`}
          icon={Activity}
        />
        <StatCard
          label="Notas emitidas"
          value={num(totais.notas, 0)}
          hint={`${brl(totais.valorNotas)} · ${num(totais.notasServico, 0)} de serviço (${brl(totais.valorServico)})`}
          icon={FileText}
          tone="success"
        />
        <StatCard
          label="Locações"
          value={num(totais.locacoes, 0)}
          hint={`${brl(totais.valorLocacoes)} · ${num(totais.locacoesAbertas, 0)} em aberto`}
          icon={PackageOpen}
          tone="accent"
        />
        <StatCard
          label="Impostos"
          value={brl(totais.impostos)}
          icon={Percent}
          tone="warning"
        />
        <StatCard
          label="Assistência técnica"
          value={num(totais.os, 0)}
          hint={`Custo ${brl(totais.osCusto)}`}
          icon={Wrench}
          tone="accent"
        />
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : linhas.length === 0 ? (
        <EmptyState
          title="Nenhum cliente cadastrado."
          description="Cadastre os clientes no painel da Ze Tech para acompanhar a operação de cada loja."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Vendas</TableHead>
                <TableHead>Última venda</TableHead>
                <TableHead className="text-right">Notas</TableHead>
                <TableHead className="text-right">Autorizadas</TableHead>
                <TableHead className="text-right">Valor faturado</TableHead>
                <TableHead className="text-right">Impostos</TableHead>
                <TableHead className="text-right">Ordens</TableHead>
                <TableHead className="text-right">Em andamento</TableHead>
                <TableHead className="text-right">Custo da assistência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.cliente_id}>
                  <TableCell className="font-medium">{l.cliente}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.plano ?? <Badge variant="outline">Sem plano</Badge>}
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">
                    {l.situacao ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.pedidos ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {brl(Number(l.valor_vendas ?? 0))}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.ultima_venda ? dateTimeBR(l.ultima_venda) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.notas ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.notas_autorizadas ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.valor_notas ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.impostos ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.os_abertas ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.os_pendentes ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.os_custo ?? 0))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
