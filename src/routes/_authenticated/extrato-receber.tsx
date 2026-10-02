import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpCircle, CalendarClock, Wallet } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";
import { corConta, estaVencida, hojeISO, labelConta, labelForma } from "@/lib/financeiro";
import { usePeriodo } from "@/lib/periodo";
import { PageHeader, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/extrato-receber")({
  head: () => ({
    meta: [
      { title: "Extrato de contas a receber — ERP Ze Tech" },
      {
        name: "description",
        content: "Saldo total, contas vencidas e valor a receber por cliente e por vencimento.",
      },
      { property: "og:title", content: "Extrato de contas a receber — ERP Ze Tech" },
      { property: "og:description", content: "Extrato do que a loja tem para receber." },
    ],
  }),
  component: ExtratoReceber,
});

type Conta = {
  id: string;
  numero: number | null;
  descricao: string;
  vencimento: string;
  valor: number | string;
  valor_recebido: number | string;
  situacao: string;
  parcela: number;
  parcelas: number;
  forma_pagamento: string | null;
  cliente_id: string | null;
  clientes: { nome: string } | null;
};

function ExtratoReceber() {
  const { periodo, setDe, setAte } = usePeriodo();
  const [aba, setAba] = useState("vencimentos");

  const { data: contas = [], isLoading } = useQuery({
    queryKey: ["extrato-receber"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contas_receber")
        .select(
          "id, numero, descricao, vencimento, valor, valor_recebido, situacao, parcela, parcelas, forma_pagamento, cliente_id, clientes(nome)",
        )
        .order("vencimento");
      if (error) throw error;
      return data as unknown as Conta[];
    },
  });

  const { data: baixas = [] } = useQuery({
    queryKey: ["extrato-receber-baixas", periodo.de, periodo.ate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financeiro_baixas")
        .select("id, valor, data_baixa, forma_pagamento, observacao, conta_receber_id")
        .not("conta_receber_id", "is", null)
        .gte("data_baixa", periodo.de)
        .lte("data_baixa", periodo.ate)
        .order("data_baixa", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const abertas = useMemo(
    () => contas.filter((c) => ["aberto", "parcial"].includes(c.situacao)),
    [contas],
  );
  const saldoDe = (c: Conta) => Number(c.valor) - Number(c.valor_recebido);

  const saldoTotal = abertas.reduce((s, c) => s + saldoDe(c), 0);
  const vencidas = abertas.filter((c) => estaVencida(c.situacao, c.vencimento));
  const saldoVencido = vencidas.reduce((s, c) => s + saldoDe(c), 0);
  const aVencer = saldoTotal - saldoVencido;
  const recebidoPeriodo = baixas.reduce((s, b) => s + Number(b.valor), 0);

  const porCliente = useMemo(() => {
    const mapa = new Map<
      string,
      { nome: string; saldo: number; vencido: number; contas: number }
    >();
    for (const c of abertas) {
      const chave = c.cliente_id ?? "sem-cliente";
      const linha = mapa.get(chave) ?? {
        nome: c.clientes?.nome ?? "Sem cliente",
        saldo: 0,
        vencido: 0,
        contas: 0,
      };
      linha.saldo += saldoDe(c);
      if (estaVencida(c.situacao, c.vencimento)) linha.vencido += saldoDe(c);
      linha.contas += 1;
      mapa.set(chave, linha);
    }
    return [...mapa.values()].sort((a, b) => b.saldo - a.saldo);
  }, [abertas]);

  const nomeConta = (id: string | null) => {
    const c = contas.find((x) => x.id === id);
    if (!c) return "—";
    return `nº ${c.numero ?? "—"} · ${c.clientes?.nome ?? "Sem cliente"}`;
  };

  return (
    <div>
      <PageHeader
        title="Extrato de contas a receber"
        description="Saldo total, o que está vencido e o que ainda vai vencer, com os recebimentos do período."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/contas-receber">Contas a receber</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/fluxo-caixa">Fluxo de caixa</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/relatorio-comissoes">Relatório de comissões</Link>
            </Button>
          </div>
        }
      />

      <div className="panel mb-5 flex flex-wrap items-end gap-3 p-3">
        <div>
          <Label>Recebimentos de</Label>
          <Input type="date" value={periodo.de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <Label>até</Label>
          <Input type="date" value={periodo.ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          O mesmo período usado no painel e nos relatórios.
        </p>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Saldo total a receber" value={brl(saldoTotal)} icon={Wallet} />
        <StatCard
          label="Contas vencidas"
          value={brl(saldoVencido)}
          hint={`${vencidas.length} conta(s)`}
          tone="danger"
          icon={AlertTriangle}
        />
        <StatCard label="A vencer" value={brl(aVencer)} tone="accent" icon={CalendarClock} />
        <StatCard
          label="Recebido no período"
          value={brl(recebidoPeriodo)}
          hint={`${baixas.length} recebimento(s)`}
          tone="success"
          icon={ArrowUpCircle}
        />
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <Tabs value={aba} onValueChange={setAba}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="vencimentos">Por vencimento</TabsTrigger>
            <TabsTrigger value="clientes">Por cliente</TabsTrigger>
            <TabsTrigger value="recebimentos">Recebimentos do período</TabsTrigger>
          </TabsList>

          <TabsContent value="vencimentos" className="mt-4">
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Nº</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-28">Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Recebido</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="w-28">Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {abertas.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        Nenhuma conta em aberto.
                      </TableCell>
                    </TableRow>
                  ) : (
                    abertas.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-numeric">{c.numero ?? "—"}</TableCell>
                        <TableCell>{c.clientes?.nome ?? "Sem cliente"}</TableCell>
                        <TableCell className="text-sm">
                          {c.descricao}
                          <p className="text-xs text-muted-foreground">
                            Parcela {c.parcela}/{c.parcelas}
                            {c.forma_pagamento ? ` · ${labelForma(c.forma_pagamento)}` : ""}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm">{dateBR(c.vencimento)}</TableCell>
                        <TableCell className="text-right text-numeric">
                          {brl(Number(c.valor))}
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {brl(Number(c.valor_recebido))}
                        </TableCell>
                        <TableCell className="text-right text-numeric font-semibold">
                          {brl(saldoDe(c))}
                        </TableCell>
                        <TableCell>
                          <Badge className={corConta(c.situacao, c.vencimento)}>
                            {labelConta(c.situacao, c.vencimento)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Hoje é {dateBR(hojeISO())}. As baixas são feitas na tela de contas a receber.
            </p>
          </TabsContent>

          <TabsContent value="clientes" className="mt-4">
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Contas em aberto</TableHead>
                    <TableHead className="text-right">Vencido</TableHead>
                    <TableHead className="text-right">Saldo a receber</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porCliente.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        Nenhuma conta em aberto.
                      </TableCell>
                    </TableRow>
                  ) : (
                    porCliente.map((l) => (
                      <TableRow key={l.nome}>
                        <TableCell className="font-medium">{l.nome}</TableCell>
                        <TableCell className="text-right text-numeric">{l.contas}</TableCell>
                        <TableCell className="text-right text-numeric text-destructive">
                          {l.vencido ? brl(l.vencido) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-numeric font-semibold">
                          {brl(l.saldo)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="recebimentos" className="mt-4">
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Data</TableHead>
                    <TableHead>Conta</TableHead>
                    <TableHead>Forma</TableHead>
                    <TableHead>Observação</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baixas.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        Nenhum recebimento no período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    baixas.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="text-sm">{dateBR(b.data_baixa)}</TableCell>
                        <TableCell className="text-sm">{nomeConta(b.conta_receber_id)}</TableCell>
                        <TableCell className="text-sm">{labelForma(b.forma_pagamento)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {b.observacao ?? "—"}
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {brl(Number(b.valor))}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
