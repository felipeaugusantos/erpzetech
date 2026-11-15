import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resumirDiaCaixa } from "@/lib/caixa-relatorio";
import { brl, dateTimeBR } from "@/lib/format";
import { hojeISO, labelForma } from "@/lib/financeiro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function RelatorioDiaCaixa({
  aberto,
  onOpenChange,
}: {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
}) {
  const [dia, setDia] = useState(hojeISO);
  const {
    data = [],
    isPending,
    error,
  } = useQuery({
    queryKey: ["caixa-relatorio-dia", dia],
    enabled: aberto && Boolean(dia),
    queryFn: async () => {
      const inicio = new Date(`${dia}T00:00:00-03:00`);
      const fim = new Date(inicio.getTime() + 86400000);
      const linhas = [];
      for (let de = 0; ; de += 1000) {
        const { data, error } = await supabase
          .from("caixa_movimentos")
          .select("*")
          .gte("created_at", inicio.toISOString())
          .lt("created_at", fim.toISOString())
          .order("created_at")
          .order("id")
          .range(de, de + 999);
        if (error) throw error;
        linhas.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return linhas;
    },
  });
  const r = resumirDiaCaixa(data, dia);
  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Relatório diário de caixa</DialogTitle>
        </DialogHeader>
        <div className="flex gap-3 print:hidden">
          <Input
            type="date"
            aria-label="Dia do relatório"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={isPending || Boolean(error) || !dia}
            onClick={() => window.print()}
          >
            <Printer className="size-4" /> Imprimir
          </Button>
        </div>
        <section id="documento-impresso" className="space-y-5">
          <h2 className="font-display text-xl font-semibold">
            Caixa — {dia.split("-").reverse().join("/")}
          </h2>
          <p className="text-sm text-muted-foreground">
            Movimentos do dia em Brasília · caixas acessíveis desta empresa
          </p>
          {isPending ? (
            <p>Carregando…</p>
          ) : error ? (
            <p role="alert" className="text-destructive">
              Não foi possível carregar o relatório.
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  ["Aberturas", r.abertura],
                  ["Entradas", r.entradas],
                  ["Saídas", r.saidas],
                  ["Vendas recebidas", r.vendas],
                ].map(([label, valor]) => (
                  <div key={label}>
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{brl(Number(valor))}</dd>
                  </div>
                ))}
              </dl>
              <h3 className="font-semibold">Por forma de pagamento</h3>
              {r.formas.map((f) => (
                <div
                  key={f.forma}
                  className="grid grid-cols-3 gap-2 border-b border-border py-2 text-sm"
                >
                  <span>{labelForma(f.forma)}</span>
                  <span>Entradas {brl(f.entradas)}</span>
                  <span>Saídas {brl(f.saidas)}</span>
                </div>
              ))}
              <h3 className="font-semibold">Movimentos · {r.lista.length}</h3>
              {!r.lista.length && (
                <p className="text-sm text-muted-foreground">Nenhum movimento neste dia.</p>
              )}
              {r.lista.map((m, i) => (
                <div
                  key={i}
                  className="grid gap-1 border-b border-border py-2 text-sm sm:grid-cols-[1fr_1fr_1fr_auto]"
                >
                  <span>{dateTimeBR(m.created_at)}</span>
                  <span>{m.tipo}</span>
                  <span>{labelForma(m.forma_pagamento)}</span>
                  <strong className="tabular-nums">{brl(Number(m.valor))}</strong>
                </div>
              ))}
            </>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
