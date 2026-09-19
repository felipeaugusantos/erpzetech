import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDollarSign, Hammer, Wrench } from "lucide-react";
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
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
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

export const Route = createFileRoute("/_authenticated/assistencia-lojas")({
  head: () => ({
    meta: [
      { title: "Assistência técnica por loja — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Ordens de serviço, reparos e custos de peças e mão de obra de cada loja no período escolhido.",
      },
      { property: "og:title", content: "Assistência técnica por loja — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Ordens abertas, encerradas, em reparo e custos por loja.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssistenciaLojas,
});

function AssistenciaLojas() {
  const { periodo, setDe, setAte } = usePeriodo();

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["assistencia-por-filial", periodo.de, periodo.ate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("assistencia_por_filial", {
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
          nome: (l.filial ?? "").slice(0, 16),
          abertas: Number(l.abertas ?? 0),
          encerradas: Number(l.encerradas ?? 0),
        })),
    [linhas],
  );

  return (
    <div>
      <PageHeader
        title="Assistência técnica por loja"
        description="Quantas ordens cada loja abriu e encerrou no período, o que está em reparo e quanto custou em peças e mão de obra."
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
          hint={`Peças ${brl(totais.pecas)} · Mão de obra ${brl(totais.servicos)}`}
          icon={CircleDollarSign}
          tone="accent"
        />
      </div>

      {grafico.length > 0 && (
        <div className="panel mb-5 p-4">
          <p className="mb-3 font-display text-sm font-semibold">
            Aberturas e encerramentos por loja
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
          title="Nenhuma loja cadastrada."
          description="Cadastre as lojas da empresa para acompanhar a assistência técnica de cada uma."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Loja</TableHead>
                <TableHead>Código</TableHead>
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
                <TableRow key={l.filial_id}>
                  <TableCell className="font-medium">{l.filial}</TableCell>
                  <TableCell className="text-muted-foreground">{l.codigo ?? "—"}</TableCell>
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
