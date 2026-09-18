import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, TrendingUp } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";
import { hojeISO, somaDias } from "@/lib/financeiro";
import { PageHeader, StatCard } from "@/components/app/PageHeader";
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

  const recebido = baixas.reduce((s, b) => (b.conta_receber_id ? s + Number(b.valor) : s), 0);
  const pago = baixas.reduce((s, b) => (b.conta_pagar_id ? s + Number(b.valor) : s), 0);
  const aReceber = receber.reduce((s, c) => s + Number(c.valor) - Number(c.valor_recebido), 0);
  const aPagar = pagar.reduce((s, c) => s + Number(c.valor) - Number(c.valor_pago), 0);

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
        description="O que já entrou e saiu no período e a projeção pelas contas em aberto."
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
