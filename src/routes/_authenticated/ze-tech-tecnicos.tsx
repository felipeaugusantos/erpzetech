import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, CircleDollarSign, Users, Wrench } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateTimeBR, num } from "@/lib/format";
import { usePeriodo } from "@/lib/periodo";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/ze-tech-tecnicos")({
  head: () => ({
    meta: [
      { title: "Custo por técnico — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Horas trabalhadas, custo de peças, mão de obra e comissão de cada técnico das lojas clientes.",
      },
      { property: "og:title", content: "Custo por técnico — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Custo total por técnico das lojas clientes no período escolhido.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ZeTechTecnicos,
});

function ZeTechTecnicos() {
  const { periodo, setDe, setAte } = usePeriodo();
  const [cliente, setCliente] = useState("todos");

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["saas-custo-por-tecnico", periodo.de, periodo.ate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("saas_custo_por_tecnico", {
        p_de: periodo.de,
        p_ate: periodo.ate,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const clientes = useMemo(() => {
    const mapa = new Map<string, string>();
    linhas.forEach((l) => mapa.set(l.cliente_id, l.cliente));
    return [...mapa.entries()];
  }, [linhas]);

  const visiveis = useMemo(
    () => (cliente === "todos" ? linhas : linhas.filter((l) => l.cliente_id === cliente)),
    [linhas, cliente],
  );

  const totais = useMemo(
    () =>
      visiveis.reduce(
        (acc, l) => ({
          tecnicos: acc.tecnicos + 1,
          ordens: acc.ordens + Number(l.ordens ?? 0),
          horas: acc.horas + Number(l.horas ?? 0),
          mao: acc.mao + Number(l.custo_mao_obra ?? 0),
          pecas: acc.pecas + Number(l.valor_pecas ?? 0),
          comissao: acc.comissao + Number(l.comissao ?? 0),
          total: acc.total + Number(l.custo_total ?? 0),
        }),
        { tecnicos: 0, ordens: 0, horas: 0, mao: 0, pecas: 0, comissao: 0, total: 0 },
      ),
    [visiveis],
  );

  return (
    <div>
      <PageHeader
        title="Custo por técnico"
        description="Quanto cada técnico das lojas clientes custou no período: horas trabalhadas, peças usadas, mão de obra e comissão."
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
        <div className="min-w-48">
          <Label>Loja cliente</Label>
          <Select value={cliente} onValueChange={setCliente}>
            <SelectTrigger aria-label="Loja cliente">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as lojas</SelectItem>
              {clientes.map(([id, nome]) => (
                <SelectItem key={id} value={id}>
                  {nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Técnicos" value={num(totais.tecnicos, 0)} icon={Users} />
        <StatCard
          label="Ordens atendidas"
          value={num(totais.ordens, 0)}
          hint={`${num(totais.horas, 1)} h trabalhadas`}
          icon={Wrench}
        />
        <StatCard
          label="Mão de obra"
          value={brl(totais.mao)}
          hint={`Comissão ${brl(totais.comissao)}`}
          icon={Clock}
          tone="warning"
        />
        <StatCard
          label="Custo total"
          value={brl(totais.total)}
          hint={`Peças ${brl(totais.pecas)}`}
          icon={CircleDollarSign}
          tone="accent"
        />
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : visiveis.length === 0 ? (
        <EmptyState
          title="Nenhum técnico cadastrado nas lojas."
          description="Quando as lojas clientes cadastrarem técnicos e lançarem ordens de serviço, o custo aparece aqui."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Loja cliente</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead className="text-right">Ordens</TableHead>
                <TableHead className="text-right">Encerradas</TableHead>
                <TableHead className="text-right">Horas</TableHead>
                <TableHead className="text-right">Valor hora</TableHead>
                <TableHead className="text-right">Mão de obra</TableHead>
                <TableHead className="text-right">Peças</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
                <TableHead className="text-right">Custo total</TableHead>
                <TableHead>Última ordem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((l) => (
                <TableRow key={`${l.cliente_id}-${l.tecnico_id}`}>
                  <TableCell className="font-medium">{l.cliente}</TableCell>
                  <TableCell>{l.tecnico}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.cargo ?? l.especialidade ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.ordens ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.encerradas ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.horas ?? 0), 1)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.custo_hora ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.custo_mao_obra ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.valor_pecas ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.comissao ?? 0))}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {num(Number(l.comissao_percentual ?? 0), 2)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {brl(Number(l.custo_total ?? 0))}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.ultima_ordem ? dateTimeBR(l.ultima_ordem) : "—"}
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
