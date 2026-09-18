import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgePercent, Percent, Wallet, Warehouse } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, num } from "@/lib/format";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/relatorio-comissoes")({
  head: () => ({
    meta: [
      { title: "Relatório de comissões — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Total vendido, comissão apurada, valor já pago e saldo a receber de cada vendedor, com quebra por depósito e período.",
      },
      { property: "og:title", content: "Relatório de comissões — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Comissão por vendedor e por depósito, no período escolhido.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RelatorioComissoes,
});

type Linha = {
  vendedor: string;
  deposito: string;
  vendas: number;
  comissao: number;
  pago: number;
  saldo: number;
  pedidos: number;
};

function RelatorioComissoes() {
  const { periodo, setDe, setAte } = usePeriodo();
  const [depositoId, setDepositoId] = useState("todos");

  const { data, isLoading } = useQuery({
    queryKey: ["relatorio-comissoes", periodo.de, periodo.ate],
    queryFn: async () => {
      const [comRes, depRes] = await Promise.all([
        supabase
          .from("comissoes")
          .select("*, profiles(nome), pedidos(numero, deposito_id, depositos(nome))")
          .gte("created_at", `${periodo.de}T00:00:00`)
          .lte("created_at", `${periodo.ate}T23:59:59`)
          .order("created_at", { ascending: false }),
        supabase.from("depositos").select("id, nome").order("nome"),
      ]);
      if (comRes.error) throw comRes.error;
      return { comissoes: comRes.data ?? [], depositos: depRes.data ?? [] };
    },
  });

  const depositos = data?.depositos ?? [];
  const comissoes = useMemo(() => {
    const todas = (data?.comissoes ?? []).filter((c) => c.situacao !== "cancelada");
    return depositoId === "todos"
      ? todas
      : todas.filter((c) => c.pedidos?.deposito_id === depositoId);
  }, [data, depositoId]);

  const total = useMemo(() => {
    let vendas = 0;
    let comissao = 0;
    let pago = 0;
    for (const c of comissoes) {
      vendas += Number(c.valor_venda);
      comissao += Number(c.valor);
      if (c.situacao === "paga") pago += Number(c.valor);
    }
    return { vendas, comissao, pago, saldo: comissao - pago, itens: comissoes.length };
  }, [comissoes]);

  /** Agrupa por vendedor (e opcionalmente por depósito). */
  function agrupar(comDeposito: boolean): Linha[] {
    const mapa = new Map<string, Linha>();
    for (const c of comissoes) {
      const vendedor = c.profiles?.nome ?? "Vendedor";
      const deposito = c.pedidos?.depositos?.nome ?? "Sem depósito";
      const chave = comDeposito ? `${vendedor}||${deposito}` : vendedor;
      const linha =
        mapa.get(chave) ??
        ({
          vendedor,
          deposito: comDeposito ? deposito : "Todos",
          vendas: 0,
          comissao: 0,
          pago: 0,
          saldo: 0,
          pedidos: 0,
        } satisfies Linha);
      linha.vendas += Number(c.valor_venda);
      linha.comissao += Number(c.valor);
      if (c.situacao === "paga") linha.pago += Number(c.valor);
      linha.pedidos += 1;
      linha.saldo = linha.comissao - linha.pago;
      mapa.set(chave, linha);
    }
    return [...mapa.values()].sort((a, b) => b.vendas - a.vendas);
  }

  const porVendedor = useMemo(() => agrupar(false), [comissoes]);
  const porDeposito = useMemo(() => agrupar(true), [comissoes]);

  const porLoja = useMemo(() => {
    const mapa = new Map<string, Linha>();
    for (const l of porDeposito) {
      const atual =
        mapa.get(l.deposito) ??
        ({
          vendedor: "—",
          deposito: l.deposito,
          vendas: 0,
          comissao: 0,
          pago: 0,
          saldo: 0,
          pedidos: 0,
        } satisfies Linha);
      atual.vendas += l.vendas;
      atual.comissao += l.comissao;
      atual.pago += l.pago;
      atual.pedidos += l.pedidos;
      atual.saldo = atual.comissao - atual.pago;
      mapa.set(l.deposito, atual);
    }
    return [...mapa.values()].sort((a, b) => b.vendas - a.vendas);
  }, [porDeposito]);

  function percentual(l: Linha) {
    return l.vendas > 0 ? (l.comissao / l.vendas) * 100 : 0;
  }

  return (
    <div>
      <PageHeader
        title="Relatório de comissões"
        description="Total vendido, comissão apurada, valor já pago e saldo a receber de cada vendedor, com quebra por depósito."
      />

      <div className="panel mb-5 flex flex-wrap items-end gap-3 p-4">
        <div>
          <Label>De</Label>
          <Input
            type="date"
            className="mt-1"
            value={periodo.de}
            onChange={(e) => setDe(e.target.value)}
          />
        </div>
        <div>
          <Label>Até</Label>
          <Input
            type="date"
            className="mt-1"
            value={periodo.ate}
            onChange={(e) => setAte(e.target.value)}
          />
        </div>
        <div className="min-w-56">
          <Label>Depósito</Label>
          <Select value={depositoId} onValueChange={setDepositoId}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os depósitos</SelectItem>
              {depositos.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total vendido"
          value={brl(total.vendas)}
          hint={`${total.itens} venda(s) com comissão`}
          icon={Wallet}
        />
        <StatCard
          label="Comissão apurada"
          value={brl(total.comissao)}
          hint={`${num(total.vendas > 0 ? (total.comissao / total.vendas) * 100 : 0, 2)}% da venda`}
          icon={Percent}
          tone="accent"
        />
        <StatCard label="Já pago" value={brl(total.pago)} tone="success" icon={BadgePercent} />
        <StatCard
          label="Saldo a receber"
          value={brl(total.saldo)}
          hint="Comissões a aprovar e aprovadas"
          tone="warning"
          icon={BadgePercent}
        />
      </div>

      {isLoading ? (
        <div className="panel h-48 animate-pulse" />
      ) : comissoes.length === 0 ? (
        <EmptyState
          title="Nenhuma comissão no período."
          description="A comissão é lançada quando o pedido do vendedor é entregue. Ajuste o período ou o depósito."
        />
      ) : (
        <Tabs defaultValue="vendedor">
          <TabsList>
            <TabsTrigger value="vendedor">Por vendedor</TabsTrigger>
            <TabsTrigger value="deposito">Vendedor por depósito</TabsTrigger>
            <TabsTrigger value="loja">Por depósito</TabsTrigger>
          </TabsList>

          <TabsContent value="vendedor" className="mt-4">
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">Total vendido</TableHead>
                    <TableHead className="text-right">% médio</TableHead>
                    <TableHead className="text-right">Comissão cobrada</TableHead>
                    <TableHead className="text-right">Já pago</TableHead>
                    <TableHead className="text-right">Saldo a receber</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porVendedor.map((l) => (
                    <TableRow key={l.vendedor}>
                      <TableCell className="text-sm font-medium">{l.vendedor}</TableCell>
                      <TableCell className="text-right text-numeric">{l.pedidos}</TableCell>
                      <TableCell className="text-right text-numeric">{brl(l.vendas)}</TableCell>
                      <TableCell className="text-right text-numeric">
                        {num(percentual(l), 2)}%
                      </TableCell>
                      <TableCell className="text-right text-numeric">{brl(l.comissao)}</TableCell>
                      <TableCell className="text-right text-numeric text-muted-foreground">
                        {brl(l.pago)}
                      </TableCell>
                      <TableCell className="text-right text-numeric font-semibold">
                        {brl(l.saldo)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="deposito" className="mt-4">
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead>
                    <TableHead>Depósito</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">Total vendido</TableHead>
                    <TableHead className="text-right">Comissão cobrada</TableHead>
                    <TableHead className="text-right">Já pago</TableHead>
                    <TableHead className="text-right">Saldo a receber</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porDeposito.map((l) => (
                    <TableRow key={`${l.vendedor}-${l.deposito}`}>
                      <TableCell className="text-sm font-medium">{l.vendedor}</TableCell>
                      <TableCell className="text-sm">{l.deposito}</TableCell>
                      <TableCell className="text-right text-numeric">{l.pedidos}</TableCell>
                      <TableCell className="text-right text-numeric">{brl(l.vendas)}</TableCell>
                      <TableCell className="text-right text-numeric">{brl(l.comissao)}</TableCell>
                      <TableCell className="text-right text-numeric text-muted-foreground">
                        {brl(l.pago)}
                      </TableCell>
                      <TableCell className="text-right text-numeric font-semibold">
                        {brl(l.saldo)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="loja" className="mt-4">
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Depósito</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">Total vendido</TableHead>
                    <TableHead className="text-right">Comissão cobrada</TableHead>
                    <TableHead className="text-right">Já pago</TableHead>
                    <TableHead className="text-right">Saldo a receber</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porLoja.map((l) => (
                    <TableRow key={l.deposito}>
                      <TableCell className="text-sm font-medium">
                        <span className="inline-flex items-center gap-2">
                          <Warehouse className="size-4 text-muted-foreground" />
                          {l.deposito}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-numeric">{l.pedidos}</TableCell>
                      <TableCell className="text-right text-numeric">{brl(l.vendas)}</TableCell>
                      <TableCell className="text-right text-numeric">{brl(l.comissao)}</TableCell>
                      <TableCell className="text-right text-numeric text-muted-foreground">
                        {brl(l.pago)}
                      </TableCell>
                      <TableCell className="text-right text-numeric font-semibold">
                        {brl(l.saldo)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
