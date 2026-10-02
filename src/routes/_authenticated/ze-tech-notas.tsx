import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Receipt, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

export const Route = createFileRoute("/_authenticated/ze-tech-notas")({
  head: () => ({
    meta: [
      { title: "Notas emitidas pelos clientes — Ze Tech" },
      {
        name: "description",
        content:
          "Painel da equipe Ze Tech com a quantidade de notas fiscais emitidas por cada loja cliente no período.",
      },
      { property: "og:title", content: "Notas emitidas pelos clientes — Ze Tech" },
      {
        property: "og:description",
        content: "Quantidade de notas, valor faturado e impostos por cliente assinante.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotasZeTech,
});

function NotasZeTech() {
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const { periodo, setDe, setAte } = usePeriodo();

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["saas-notas", periodo.de, periodo.ate],
    enabled: operador === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("saas_notas_por_cliente", {
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
          notas: acc.notas + Number(l.notas ?? 0),
          autorizadas: acc.autorizadas + Number(l.autorizadas ?? 0),
          valor: acc.valor + Number(l.valor_total ?? 0),
          impostos: acc.impostos + Number(l.impostos ?? 0),
        }),
        { notas: 0, autorizadas: 0, valor: 0, impostos: 0 },
      ),
    [linhas],
  );

  const grafico = useMemo(
    () =>
      linhas
        .filter((l) => Number(l.notas ?? 0) > 0)
        .slice(0, 10)
        .map((l) => ({ nome: (l.cliente ?? "").slice(0, 16), notas: Number(l.notas ?? 0) })),
    [linhas],
  );

  if (carregandoAcesso) {
    return <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>;
  }

  if (operador !== true) {
    return (
      <EmptyState
        title="Área exclusiva da equipe Ze Tech."
        description="Entre com um acesso da equipe para ver as notas emitidas pelos clientes."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Notas emitidas pelos clientes"
        description="Quantas notas fiscais cada loja assinante emitiu no período, com valor faturado e impostos."
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
          O período é o mesmo usado nos demais painéis.
        </p>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Notas no período" value={num(totais.notas, 0)} icon={FileText} />
        <StatCard label="Autorizadas" value={num(totais.autorizadas, 0)} tone="success" />
        <StatCard label="Valor faturado" value={brl(totais.valor)} icon={TrendingUp} />
        <StatCard label="Impostos" value={brl(totais.impostos)} icon={Receipt} tone="accent" />
      </div>

      {grafico.length > 0 && (
        <div className="panel mb-5 p-4">
          <p className="mb-3 font-display text-sm font-semibold">Notas por cliente</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="nome" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip formatter={(v) => num(Number(v), 0)} />
                <Bar dataKey="notas" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : linhas.length === 0 ? (
        <EmptyState
          title="Nenhum cliente cadastrado."
          description="Cadastre os clientes no painel da Ze Tech para acompanhar as notas emitidas."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead className="text-right">Notas</TableHead>
                <TableHead className="text-right">Autorizadas</TableHead>
                <TableHead className="text-right">Em rascunho</TableHead>
                <TableHead className="text-right">Canceladas</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Impostos</TableHead>
                <TableHead>Última emissão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.cliente_id}>
                  <TableCell className="font-medium">{l.cliente}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.plano ?? <Badge variant="outline">Sem plano</Badge>}
                  </TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {num(Number(l.notas ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.autorizadas ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.rascunhos ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.canceladas ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.valor_total ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.impostos ?? 0))}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.ultima_emissao ? dateTimeBR(l.ultima_emissao) : "—"}
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
