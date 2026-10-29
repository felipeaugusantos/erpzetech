import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDollarSign, Droplets, Repeat } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/ze-tech-lava-rapido")({
  head: () => ({
    meta: [
      { title: "Lava rápido dos clientes — EZRA" },
      {
        name: "description",
        content:
          "Painel da equipe EZRA com o uso do lava rápido por loja cliente: ordens, faturamento, planos mensais, fotos e comissões.",
      },
      { property: "og:title", content: "Lava rápido dos clientes — EZRA" },
      {
        property: "og:description",
        content: "Ordens entregues, faturamento e planos mensais do lava rápido por cliente.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LavaRapidoZeTech,
});

type Linha = {
  cliente_id: string;
  cliente: string;
  plano: string | null;
  ordens: number;
  entregues: number;
  canceladas: number;
  em_andamento: number;
  ultima_ordem: string | null;
  faturamento: number;
  itens_planos: number;
  itens_brindes: number;
  ticket_medio: number;
  assinaturas_ativas: number;
  assinaturas_vendidas: number;
  valor_assinaturas: number;
  veiculos: number;
  fotos: number;
  comissoes_a_pagar: number;
  baixas_com_falha: number;
};

function LavaRapidoZeTech() {
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const { periodo, setDe, setAte } = usePeriodo();

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["saas-lava-rapido", periodo.de, periodo.ate],
    enabled: operador === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("saas_lava_rapido_por_cliente", {
        p_de: periodo.de,
        p_ate: periodo.ate,
      });
      if (error) throw error;
      return (data ?? []) as unknown as Linha[];
    },
  });

  const totais = useMemo(
    () =>
      linhas.reduce(
        (acc, l) => ({
          entregues: acc.entregues + Number(l.entregues ?? 0),
          andamento: acc.andamento + Number(l.em_andamento ?? 0),
          faturamento: acc.faturamento + Number(l.faturamento ?? 0),
          assinaturas: acc.assinaturas + Number(l.assinaturas_ativas ?? 0),
          vendidas: acc.vendidas + Number(l.assinaturas_vendidas ?? 0),
          valorAssinaturas: acc.valorAssinaturas + Number(l.valor_assinaturas ?? 0),
        }),
        {
          entregues: 0,
          andamento: 0,
          faturamento: 0,
          assinaturas: 0,
          vendidas: 0,
          valorAssinaturas: 0,
        },
      ),
    [linhas],
  );

  const grafico = useMemo(
    () =>
      linhas
        .filter((l) => Number(l.entregues ?? 0) > 0)
        .slice(0, 10)
        .map((l) => ({
          nome: (l.cliente ?? "").slice(0, 16),
          entregues: Number(l.entregues ?? 0),
          canceladas: Number(l.canceladas ?? 0),
        })),
    [linhas],
  );

  if (carregandoAcesso) {
    return <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>;
  }

  if (operador !== true) {
    return (
      <EmptyState
        title="Área exclusiva da equipe EZRA."
        description="Entre com um acesso da equipe para ver o lava rápido dos clientes."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Lava rápido dos clientes"
        description="Ordens entregues no período, faturamento dos serviços cobrados (sem o que o plano ou o brinde cobriu) e planos mensais. Só aparecem as lojas com o módulo liberado."
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
        <StatCard
          label="Ordens entregues"
          value={num(totais.entregues, 0)}
          hint={`${num(totais.andamento, 0)} em andamento agora`}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Faturamento dos serviços"
          value={brl(totais.faturamento)}
          icon={CircleDollarSign}
          tone="accent"
        />
        <StatCard
          label="Planos ativos"
          value={num(totais.assinaturas, 0)}
          hint={`${num(totais.vendidas, 0)} vendidos no período · ${brl(totais.valorAssinaturas)}`}
          icon={Repeat}
        />
        <StatCard label="Lojas com lava rápido" value={num(linhas.length, 0)} icon={Droplets} />
      </div>

      {grafico.length > 0 && (
        <div className="panel mb-5 p-4">
          <p className="mb-3 font-display text-sm font-semibold">
            Entregas e cancelamentos por cliente
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="nome" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip formatter={(v) => num(Number(v), 0)} />
                <Bar
                  dataKey="entregues"
                  name="Entregues"
                  fill="var(--primary)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="canceladas"
                  name="Canceladas"
                  fill="var(--mint)"
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
          title="Nenhuma loja com o lava rápido liberado."
          description="Libere o módulo no cadastro da empresa do cliente (CNAE 45.20-0/06 ou Módulos sem CNPJ) para acompanhar aqui."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead className="text-right">Entregues</TableHead>
                <TableHead className="text-right">Em andamento</TableHead>
                <TableHead className="text-right">Canceladas</TableHead>
                <TableHead className="text-right">Faturamento</TableHead>
                <TableHead className="text-right">Ticket médio</TableHead>
                <TableHead className="text-right">Cobertas (plano · brinde)</TableHead>
                <TableHead className="text-right">Planos ativos</TableHead>
                <TableHead className="text-right">Veículos</TableHead>
                <TableHead className="text-right">Fotos</TableHead>
                <TableHead className="text-right">Comissões a pagar</TableHead>
                <TableHead className="text-right">Baixas com falha</TableHead>
                <TableHead>Última ordem</TableHead>
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
                    {num(Number(l.entregues ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.em_andamento ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.canceladas ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {brl(Number(l.faturamento ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.ticket_medio ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.itens_planos ?? 0), 0)} · {num(Number(l.itens_brindes ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.assinaturas_ativas ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.veiculos ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(l.fotos ?? 0), 0)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.comissoes_a_pagar ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {Number(l.baixas_com_falha ?? 0) > 0 ? (
                      <Badge variant="destructive">{num(Number(l.baixas_com_falha), 0)}</Badge>
                    ) : (
                      "0"
                    )}
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
