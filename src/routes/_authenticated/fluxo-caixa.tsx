import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, Store, TrendingUp } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, dateTimeBR } from "@/lib/format";
import { entradaCaixa, hojeISO, labelForma, somaDias } from "@/lib/financeiro";
import { PageHeader, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/fluxo-caixa")({
  head: () => ({
    meta: [
      { title: "Fluxo de caixa — ERP Ze Tech" },
      {
        name: "description",
        content: "Entradas e saídas realizadas e projeção pelas contas em aberto.",
      },
      { property: "og:title", content: "Fluxo de caixa — ERP Ze Tech" },
      { property: "og:description", content: "Visão de caixa realizada e projetada." },
    ],
  }),
  component: FluxoCaixa,
});

type Linha = { data: string; receber: number; pagar: number };

function FluxoCaixa() {
  const [de, setDe] = useState(somaDias(hojeISO(), -30));
  const [ate, setAte] = useState(somaDias(hojeISO(), 30));

  const { data: baixas = [] } = useQuery({
    queryKey: ["fluxo-baixas", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financeiro_baixas")
        .select("conta_receber_id, conta_pagar_id, valor, data_baixa")
        .gte("data_baixa", de)
        .lte("data_baixa", ate);
      if (error) throw error;
      return data;
    },
  });

  const { data: receber = [] } = useQuery({
    queryKey: ["fluxo-receber", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contas_receber")
        .select("vencimento, valor, valor_recebido, situacao")
        .in("situacao", ["aberto", "parcial"])
        .gte("vencimento", de)
        .lte("vencimento", ate);
      if (error) throw error;
      return data;
    },
  });

  const { data: pagar = [] } = useQuery({
    queryKey: ["fluxo-pagar", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contas_pagar")
        .select("vencimento, valor, valor_pago, situacao")
        .in("situacao", ["aberto", "parcial"])
        .gte("vencimento", de)
        .lte("vencimento", ate);
      if (error) throw error;
      return data;
    },
  });

  const { data: movimentos = [] } = useQuery({
    queryKey: ["fluxo-caixa-movimentos", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("caixa_movimentos")
        .select(
          "id, tipo, valor, forma_pagamento, descricao, created_at, deposito_id, pedido_id, depositos(nome), caixas(numero)",
        )
        .gte("created_at", `${de}T00:00:00`)
        .lte("created_at", `${ate}T23:59:59`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const recebido = baixas.reduce((s, b) => (b.conta_receber_id ? s + Number(b.valor) : s), 0);
  const pago = baixas.reduce((s, b) => (b.conta_pagar_id ? s + Number(b.valor) : s), 0);
  const aReceber = receber.reduce((s, c) => s + Number(c.valor) - Number(c.valor_recebido), 0);
  const aPagar = pagar.reduce((s, c) => s + Number(c.valor) - Number(c.valor_pago), 0);

  const entradasCaixa = movimentos.reduce(
    (s, m) => (entradaCaixa(m.tipo) ? s + Number(m.valor) : s),
    0,
  );
  const saidasCaixa = movimentos.reduce(
    (s, m) => (entradaCaixa(m.tipo) ? s : s + Number(m.valor)),
    0,
  );
  const vendasPdv = movimentos.filter((m) => m.tipo === "venda");
  const totalPdv = vendasPdv.reduce((s, m) => s + Number(m.valor), 0);

  const pdvPorDeposito = useMemo(() => {
    const mapa = new Map<string, { nome: string; total: number; vendas: number }>();
    for (const m of vendasPdv) {
      const nome = (m.depositos as { nome: string } | null)?.nome ?? "Sem depósito";
      const linha = mapa.get(nome) ?? { nome, total: 0, vendas: 0 };
      linha.total += Number(m.valor);
      linha.vendas += 1;
      mapa.set(nome, linha);
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total);
  }, [vendasPdv]);


  const projecao = useMemo(() => {
    const mapa = new Map<string, Linha>();
    const add = (data: string, campo: "receber" | "pagar", v: number) => {
      const linha = mapa.get(data) ?? { data, receber: 0, pagar: 0 };
      linha[campo] += v;
      mapa.set(data, linha);
    };
    for (const c of receber) add(c.vencimento, "receber", Number(c.valor) - Number(c.valor_recebido));
    for (const c of pagar) add(c.vencimento, "pagar", Number(c.valor) - Number(c.valor_pago));
    return [...mapa.values()].sort((a, b) => a.data.localeCompare(b.data));
  }, [receber, pagar]);

  let acumulado = 0;

  return (
    <div>
      <PageHeader
        title="Fluxo de caixa"
        description="Entradas, saídas, vendas de balcão e projeção pelas contas em aberto."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/pdv">PDV — venda rápida</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/orcamentos">Orçamentos</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/extrato-receber">Extrato a receber</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/caixa">Caixa</Link>
            </Button>
          </div>
        }
      />

      <div className="panel mb-5 flex flex-wrap items-end gap-3 p-3">
        <div>
          <Label>De</Label>
          <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <Label>Até</Label>
          <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Recebido" value={brl(recebido)} tone="success" icon={ArrowUpCircle} />
        <StatCard label="Pago" value={brl(pago)} tone="danger" icon={ArrowDownCircle} />
        <StatCard
          label="Resultado realizado"
          value={brl(recebido - pago)}
          tone={recebido - pago >= 0 ? "accent" : "danger"}
          icon={TrendingUp}
        />
        <StatCard
          label="Projeção do período"
          value={brl(aReceber - aPagar)}
          hint={`A receber ${brl(aReceber)} · A pagar ${brl(aPagar)}`}
        />
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Entradas no caixa"
          value={brl(entradasCaixa)}
          tone="success"
          icon={ArrowUpCircle}
        />
        <StatCard
          label="Saídas do caixa"
          value={brl(saidasCaixa)}
          tone="danger"
          icon={ArrowDownCircle}
        />
        <StatCard
          label="Vendas de balcão (PDV)"
          value={brl(totalPdv)}
          hint={`${vendasPdv.length} venda(s)`}
          tone="accent"
          icon={Store}
        />
        <StatCard label="Saldo do caixa no período" value={brl(entradasCaixa - saidasCaixa)} />
      </div>

      {pdvPorDeposito.length > 0 && (
        <div className="panel mb-5 p-4">
          <h2 className="mb-3 font-display text-lg font-semibold">Vendas de balcão por depósito</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Depósito</TableHead>
                  <TableHead className="text-right">Vendas</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pdvPorDeposito.map((l) => (
                  <TableRow key={l.nome}>
                    <TableCell>{l.nome}</TableCell>
                    <TableCell className="text-right text-numeric">{l.vendas}</TableCell>
                    <TableCell className="text-right text-numeric font-semibold">
                      {brl(l.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="panel mb-5 p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">Entradas e saídas do caixa</h2>
        {movimentos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum movimento de caixa no período selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Data</TableHead>
                  <TableHead>Movimento</TableHead>
                  <TableHead>Depósito</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead className="text-right">Entrada</TableHead>
                  <TableHead className="text-right">Saída</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movimentos.map((m) => {
                  const entrada = entradaCaixa(m.tipo);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="text-sm">{dateTimeBR(m.created_at)}</TableCell>
                      <TableCell className="text-sm">
                        <span className="capitalize">{m.tipo.replace("_", " ")}</span>
                        <p className="text-xs text-muted-foreground">
                          {m.descricao ?? "—"}
                          {(m.caixas as { numero: number } | null)?.numero
                            ? ` · caixa nº ${(m.caixas as { numero: number }).numero}`
                            : ""}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {(m.depositos as { nome: string } | null)?.nome ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">{labelForma(m.forma_pagamento)}</TableCell>
                      <TableCell className="text-right text-numeric text-success">
                        {entrada ? brl(Number(m.valor)) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-numeric text-destructive">
                        {entrada ? "—" : brl(Number(m.valor))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>


      <div className="panel p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">Projeção por vencimento</h2>
        {projecao.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma conta em aberto no período selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">A receber</TableHead>
                  <TableHead className="text-right">A pagar</TableHead>
                  <TableHead className="text-right">Saldo do dia</TableHead>
                  <TableHead className="text-right">Acumulado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projecao.map((l) => {
                  const saldo = l.receber - l.pagar;
                  acumulado += saldo;
                  return (
                    <TableRow key={l.data}>
                      <TableCell className="text-sm">{dateBR(l.data)}</TableCell>
                      <TableCell className="text-right text-numeric text-success">
                        {l.receber ? brl(l.receber) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-numeric text-destructive">
                        {l.pagar ? brl(l.pagar) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-numeric">{brl(saldo)}</TableCell>
                      <TableCell className="text-right text-numeric font-semibold">
                        {brl(acumulado)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
