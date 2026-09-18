import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CircleDollarSign, Users, Wallet } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { brl, dateBR } from "@/lib/format";
import { usePeriodo } from "@/lib/periodo";
import { SITUACAO_SAAS, TIPO_FATURA_SAAS, diasEntre, useSaasDados, useSaasOperador } from "@/lib/saas";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/ze-tech-relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios da Ze Tech — assinaturas" },
      {
        name: "description",
        content:
          "Consolidado das assinaturas do ERP Ze Tech: clientes por plano, planos ativos, vencimentos e pagamentos recebidos.",
      },
      { property: "og:title", content: "Relatórios da Ze Tech — assinaturas" },
      {
        property: "og:description",
        content: "Receita recorrente, clientes por plano, vencimentos e pagamentos no período.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RelatoriosZeTech,
});

function RelatoriosZeTech() {
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const { data, isLoading } = useSaasDados(operador === true);
  const { periodo } = usePeriodo();

  const resumos = data?.resumos ?? [];
  const planos = data?.planos ?? [];
  const faturas = data?.faturas ?? [];

  const noPeriodo = useMemo(
    () => faturas.filter((f) => f.vencimento >= periodo.de && f.vencimento <= periodo.ate),
    [faturas, periodo],
  );

  const pagosNoPeriodo = useMemo(
    () => faturas.filter((f) => f.pago_em && f.pago_em >= periodo.de && f.pago_em <= periodo.ate),
    [faturas, periodo],
  );

  const porPlano = useMemo(
    () =>
      planos.map((p) => {
        const clientes = resumos.filter((r) => r.cliente.plano_id === p.id);
        const ativos = clientes.filter((c) => c.cliente.situacao === "ativo");
        return {
          plano: p.nome,
          clientes: clientes.length,
          ativos: ativos.length,
          teste: clientes.filter((c) => c.cliente.situacao === "teste").length,
          recorrente: ativos.reduce((s, c) => s + c.mensal, 0),
          aberto: clientes.reduce((s, c) => s + c.aberto, 0),
          atrasado: clientes.reduce((s, c) => s + c.atrasado, 0),
        };
      }),
    [planos, resumos],
  );

  const kpis = useMemo(
    () => ({
      clientes: resumos.length,
      ativos: resumos.filter((r) => r.cliente.situacao === "ativo").length,
      recorrente: resumos
        .filter((r) => r.cliente.situacao === "ativo")
        .reduce((s, r) => s + r.mensal, 0),
      recebido: pagosNoPeriodo.reduce((s, f) => s + Number(f.valor_pago), 0),
      aVencer: noPeriodo.reduce(
        (s, f) => s + Math.max(Number(f.valor) - Number(f.valor_pago), 0),
        0,
      ),
      atrasado: resumos.reduce((s, r) => s + r.atrasado, 0),
    }),
    [resumos, pagosNoPeriodo, noPeriodo],
  );

  if (carregandoAcesso) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  if (!operador)
    return (
      <EmptyState
        title="Área exclusiva da Ze Tech"
        description="Os relatórios de assinatura só estão disponíveis para a equipe Ze Tech."
      />
    );

  return (
    <>
      <PageHeader
        title="Relatórios da Ze Tech"
        description={`Assinaturas consolidadas · período ${dateBR(periodo.de)} a ${dateBR(periodo.ate)} (o mesmo do painel).`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/ze-tech">Painel de clientes</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/ze-tech-planos">Planos</Link>
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Clientes"
          value={String(kpis.clientes)}
          hint={`${kpis.ativos} com plano ativo`}
          icon={Users}
        />
        <StatCard
          label="Receita recorrente"
          value={brl(kpis.recorrente)}
          hint="Por mês, clientes ativos"
          icon={CircleDollarSign}
        />
        <StatCard
          label="Recebido no período"
          value={brl(kpis.recebido)}
          hint={`${pagosNoPeriodo.length} pagamento(s)`}
          icon={Wallet}
        />
        <StatCard
          label="Em atraso"
          value={brl(kpis.atrasado)}
          hint={`${brl(kpis.aVencer)} a vencer no período`}
          icon={AlertTriangle}
          tone={kpis.atrasado > 0 ? "danger" : "default"}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <Tabs defaultValue="planos">
          <TabsList>
            <TabsTrigger value="planos">Clientes por plano</TabsTrigger>
            <TabsTrigger value="vencimentos">Vencimentos</TabsTrigger>
            <TabsTrigger value="pagamentos">Pagamentos</TabsTrigger>
          </TabsList>

          <TabsContent value="planos" className="mt-4 grid gap-4">
            <div className="panel p-4">
              <p className="mb-3 font-display text-sm font-semibold">Receita recorrente por plano</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={porPlano}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="plano" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip formatter={(v: number) => brl(v)} />
                    <Bar dataKey="recorrente" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-40">Plano</TableHead>
                    <TableHead className="w-24 text-center">Clientes</TableHead>
                    <TableHead className="w-24 text-center">Ativos</TableHead>
                    <TableHead className="w-24 text-center">Em teste</TableHead>
                    <TableHead className="w-32 text-right">Recorrente</TableHead>
                    <TableHead className="w-32 text-right">Em aberto</TableHead>
                    <TableHead className="w-32 text-right">Em atraso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porPlano.map((p) => (
                    <TableRow key={p.plano} className="align-middle">
                      <TableCell className="font-medium">{p.plano}</TableCell>
                      <TableCell className="text-center">{p.clientes}</TableCell>
                      <TableCell className="text-center">{p.ativos}</TableCell>
                      <TableCell className="text-center">{p.teste}</TableCell>
                      <TableCell className="text-right">{brl(p.recorrente)}</TableCell>
                      <TableCell className="text-right">{brl(p.aberto)}</TableCell>
                      <TableCell className="text-right">{brl(p.atrasado)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="vencimentos" className="mt-4">
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-52">Cliente</TableHead>
                    <TableHead className="w-28">Plano</TableHead>
                    <TableHead className="w-32 text-center">Situação</TableHead>
                    <TableHead className="w-36">Próximo vencimento</TableHead>
                    <TableHead className="w-32 text-right">Valor</TableHead>
                    <TableHead className="w-36">Contrato até</TableHead>
                    <TableHead className="w-28 text-center">Pagamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumos.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        Nenhum cliente cadastrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    resumos.map((r) => (
                      <TableRow key={r.cliente.id} className="align-middle">
                        <TableCell className="font-medium">{r.cliente.nome}</TableCell>
                        <TableCell>{r.plano?.nome ?? "—"}</TableCell>
                        <TableCell className="text-center">
                          {SITUACAO_SAAS[r.cliente.situacao] ?? r.cliente.situacao}
                        </TableCell>
                        <TableCell
                          className={
                            r.proximoVencimento && diasEntre(r.proximoVencimento) < 0
                              ? "text-destructive"
                              : ""
                          }
                        >
                          {r.proximoVencimento ? dateBR(r.proximoVencimento) : "—"}
                        </TableCell>
                        <TableCell className="text-right">{brl(r.proximoValor)}</TableCell>
                        <TableCell>
                          {dateBR(r.fim)}
                          <span className="block text-xs text-muted-foreground">
                            {r.diasRestantes < 0 ? "vencido" : `${r.diasRestantes} dia(s)`}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {r.status === "pago" ? (
                            <Badge>Pago</Badge>
                          ) : r.status === "atrasado" ? (
                            <Badge variant="destructive">Em atraso</Badge>
                          ) : (
                            <Badge variant="secondary">Em aberto</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="pagamentos" className="mt-4">
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-52">Cliente</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-28">Tipo</TableHead>
                    <TableHead className="w-28">Pago em</TableHead>
                    <TableHead className="w-28">Forma</TableHead>
                    <TableHead className="w-28 text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagosNoPeriodo.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        Nenhum pagamento recebido no período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagosNoPeriodo.map((f) => (
                      <TableRow key={f.id} className="align-middle">
                        <TableCell className="font-medium">
                          {resumos.find((r) => r.cliente.id === f.cliente_id)?.cliente.nome ?? "—"}
                        </TableCell>
                        <TableCell>{f.descricao}</TableCell>
                        <TableCell>{TIPO_FATURA_SAAS[f.tipo] ?? f.tipo}</TableCell>
                        <TableCell>{dateBR(f.pago_em)}</TableCell>
                        <TableCell className="capitalize">{f.forma_pagamento ?? "—"}</TableCell>
                        <TableCell className="text-right">{brl(f.valor_pago)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
