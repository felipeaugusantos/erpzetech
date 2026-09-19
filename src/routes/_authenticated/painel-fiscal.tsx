import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Percent, Warehouse } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, num } from "@/lib/format";
import { usePeriodo } from "@/lib/periodo";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/painel-fiscal")({
  head: () => ({
    meta: [
      { title: "Painel fiscal por loja — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Entradas, saídas, saldo de estoque e total de impostos de cada loja no período escolhido.",
      },
      { property: "og:title", content: "Painel fiscal por loja — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Movimento de entradas e saídas, saldo em estoque e impostos por loja.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PainelFiscal,
});

function PainelFiscal() {
  const { periodo, setDe, setAte } = usePeriodo();

  const { data: lojas = [], isLoading } = useQuery({
    queryKey: ["painel-fiscal", periodo.de, periodo.ate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("painel_fiscal_loja", {
        p_de: periodo.de,
        p_ate: periodo.ate,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const t = useMemo(
    () =>
      lojas.reduce(
        (acc, l) => ({
          entradas: acc.entradas + Number(l.entradas ?? 0),
          saidas: acc.saidas + Number(l.saidas ?? 0),
          saldo: acc.saldo + Number(l.saldo_estoque ?? 0),
          notas: acc.notas + Number(l.notas ?? 0),
          valor: acc.valor + Number(l.valor_notas ?? 0),
          icms: acc.icms + Number(l.icms ?? 0),
          st: acc.st + Number(l.icms_st ?? 0),
          pis: acc.pis + Number(l.pis ?? 0),
          cofins: acc.cofins + Number(l.cofins ?? 0),
          iss: acc.iss + Number(l.iss ?? 0),
          impostos: acc.impostos + Number(l.impostos ?? 0),
        }),
        {
          entradas: 0,
          saidas: 0,
          saldo: 0,
          notas: 0,
          valor: 0,
          icms: 0,
          st: 0,
          pis: 0,
          cofins: 0,
          iss: 0,
          impostos: 0,
        },
      ),
    [lojas],
  );

  return (
    <div>
      <PageHeader
        title="Painel fiscal por loja"
        description="Entradas, saídas, saldo em estoque e impostos de cada loja no período."
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
          O período é o mesmo do painel principal e do balanço fiscal.
        </p>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Entradas" value={brl(t.entradas)} icon={ArrowDownRight} tone="success" />
        <StatCard label="Saídas" value={brl(t.saidas)} icon={ArrowUpRight} tone="accent" />
        <StatCard label="Saldo em estoque" value={brl(t.saldo)} icon={Warehouse} />
        <StatCard
          label="Impostos no período"
          value={brl(t.impostos)}
          icon={Percent}
          hint={`${num(t.notas, 0)} notas · ${brl(t.valor)}`}
        />
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lojas.length === 0 ? (
        <EmptyState
          title="Nenhuma loja cadastrada."
          description="Cadastre as lojas da empresa para acompanhar o movimento fiscal de cada uma."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Loja</TableHead>
                <TableHead className="text-right">Entradas</TableHead>
                <TableHead className="text-right">Saídas</TableHead>
                <TableHead className="text-right">Saldo em estoque</TableHead>
                <TableHead className="text-right">Notas</TableHead>
                <TableHead className="text-right">Valor das notas</TableHead>
                <TableHead className="text-right">ICMS</TableHead>
                <TableHead className="text-right">ICMS ST</TableHead>
                <TableHead className="text-right">PIS</TableHead>
                <TableHead className="text-right">COFINS</TableHead>
                <TableHead className="text-right">ISS</TableHead>
                <TableHead className="text-right">Total de impostos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lojas.map((l) => (
                <TableRow key={l.filial_id}>
                  <TableCell className="font-medium">{l.filial}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(l.entradas ?? 0))}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(l.saidas ?? 0))}</TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.saldo_estoque ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">{num(Number(l.notas ?? 0), 0)}</TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.valor_notas ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(l.icms ?? 0))}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(l.icms_st ?? 0))}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(l.pis ?? 0))}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(l.cofins ?? 0))}</TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(l.iss ?? 0))}</TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {brl(Number(l.impostos ?? 0))}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-secondary/50 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right text-numeric">{brl(t.entradas)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(t.saidas)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(t.saldo)}</TableCell>
                <TableCell className="text-right text-numeric">{num(t.notas, 0)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(t.valor)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(t.icms)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(t.st)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(t.pis)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(t.cofins)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(t.iss)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(t.impostos)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
