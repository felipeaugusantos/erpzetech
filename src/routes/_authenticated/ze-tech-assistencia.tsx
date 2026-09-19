import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Wrench, CheckCircle2, Hammer, CircleDollarSign } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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

export const Route = createFileRoute("/_authenticated/ze-tech-assistencia")({
  head: () => ({
    meta: [
      { title: "Assistência técnica dos clientes — Ze Tech" },
      {
        name: "description",
        content:
          "Painel da equipe Ze Tech com ordens de assistência técnica abertas, encerradas, em reparo e os custos de peças e mão de obra por loja cliente.",
      },
      { property: "og:title", content: "Assistência técnica dos clientes — Ze Tech" },
      {
        property: "og:description",
        content: "Aberturas, encerramentos, reparos e custos de assistência técnica por cliente.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssistenciaZeTech,
});

function AssistenciaZeTech() {
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const { periodo, setDe, setAte } = usePeriodo();

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["saas-assistencia", periodo.de, periodo.ate],
    enabled: operador === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("saas_assistencia_por_cliente", {
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
          abertas: acc.abertas + Number(l.abertas ?? 0),
          encerradas: acc.encerradas + Number(l.encerradas ?? 0),
          reparo: acc.reparo + Number(l.em_reparo ?? 0),
          pendentes: acc.pendentes + Number(l.pendentes ?? 0),
          pecas: acc.pecas + Number(l.valor_pecas ?? 0),
          servicos: acc.servicos + Number(l.valor_servicos ?? 0),
          total: acc.total + Number(l.valor_total ?? 0),
        }),
        { abertas: 0, encerradas: 0, reparo: 0, pendentes: 0, pecas: 0, servicos: 0, total: 0 },
      ),
    [linhas],
  );

  const grafico = useMemo(
    () =>
      linhas
        .filter((l) => Number(l.abertas ?? 0) > 0)
        .slice(0, 10)
        .map((l) => ({
          nome: (l.cliente ?? "").slice(0, 16),
          abertas: Number(l.abertas ?? 0),
          encerradas: Number(l.encerradas ?? 0),
        })),
    [linhas],
  );

  if (carregandoAcesso) {
    return <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>;
  }

  if (operador !== true) {
    return (
      <EmptyState
        title="Área exclusiva da equipe Ze Tech."
        description="Entre com um acesso da equipe para ver a assistência técnica dos clientes."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Assistência técnica dos clientes"
        description="Ordens abertas e encerradas no período, o que está em reparo e quanto cada loja gastou com peças e mão de obra."
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
        <StatCard label="Ordens abertas" value={num(totais.abertas, 0)} icon={Wrench} />
        <StatCard
          label="Encerradas (entregues)"
          value={num(totais.encerradas, 0)}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Em reparo"
          value={num(totais.reparo, 0)}
          hint={`${num(totais.pendentes, 0)} em andamento`}
          icon={Hammer}
          tone="warning"
        />
        <StatCard
          label="Custo total"
          value={brl(totais.total)}
          hint={`Peças ${brl(totais.pecas)} · Serviços ${brl(totais.servicos)}`}
          icon={CircleDollarSign}
          tone="accent"
        />
      </div>

      {grafico.length > 0 && (
        <div className="panel mb-5 p-4">
          <p className="mb-3 font-display text-sm font-semibold">
            Aberturas e encerramentos por cliente
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="nome" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip formatter={(v) => num(Number(v), 0)} />
                <Bar dataKey="abertas" name="Abertas" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                <Bar
                  dataKey="encerradas"
                  name="Encerradas"
                  fill="var(--accent)"
                  radius={[4, 4, 0, 0]}
                />
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
          description="Cadastre os clientes no painel da Ze Tech para acompanhar a assistência técnica."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead className="text-right">Abertas</TableHead>
                <TableHead className="text-right">Encerradas</TableHead>
                <TableHead className="text-right">Em reparo</TableHead>
                <TableHead className="text-right">Em andamento</TableHead>
                <TableHead className="text-right">Canceladas</TableHead>
                <TableHead className="text-right">Peças</TableHead>
                <TableHead className="text-right">Mão de obra</TableHead>
                <TableHead className="text-right">Custo total</TableHead>
                <TableHead className="text-right">Ticket médio</TableHead>
                <TableHead>Última abertura</TableHead>
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
                    {num(Number(l.abertas ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.encerradas ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.em_reparo ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.pendentes ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.canceladas ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.valor_pecas ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.valor_servicos ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {brl(Number(l.valor_total ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.ticket_medio ?? 0))}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.ultima_abertura ? dateTimeBR(l.ultima_abertura) : "—"}
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
