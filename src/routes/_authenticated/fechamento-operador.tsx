import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateTimeBR } from "@/lib/format";
import { hojeISO, somaDias } from "@/lib/financeiro";
import { PageHeader, StatCard } from "@/components/app/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/fechamento-operador")({
  head: () => ({
    meta: [
      { title: "Fechamento por operador — ERP Ze Tech" },
      { name: "description", content: "Vendas, formas de pagamento, cancelamentos, sangrias, suprimentos e diferenças de caixa por operador." },
      { property: "og:title", content: "Fechamento por operador — ERP Ze Tech" },
      { property: "og:description", content: "Relatório de fechamento de caixa por operador." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Fechamento,
});

function Fechamento() {
  const [de, setDe] = useState(somaDias(hojeISO(), -7));
  const [ate, setAte] = useState(hojeISO());
  const { data: linhas = [] } = useQuery({
    queryKey: ["fechamento-operador", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("relatorio_fechamento_operador", { p_de: de, p_ate: ate });
      if (error) throw error;
      return data ?? [];
    },
  });
  const soma = (k: keyof (typeof linhas)[number]) => linhas.reduce((s, l) => s + Number(l[k] ?? 0), 0);

  return (
    <div>
      <PageHeader title="Fechamento por operador" description="Cada caixa aberto por operador, com vendas, formas de pagamento, cancelamentos, sangrias, suprimentos e diferença." />
      <div className="panel mb-5 flex flex-wrap gap-3 p-3">
        <div><Label>De</Label><Input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div><Label>Até</Label><Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Vendas" value={brl(soma("vendas"))} tone="success" />
        <StatCard label="Cancelamentos" value={brl(soma("cancelamentos"))} tone="danger" />
        <StatCard label="Sangrias / suprimentos" value={`${brl(soma("sangrias"))} / ${brl(soma("suprimentos"))}`} />
        <StatCard label="Diferença total" value={brl(soma("diferenca"))} tone={soma("diferenca") < 0 ? "danger" : "accent"} />
      </div>
      <div className="panel overflow-x-auto p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Operador / caixa</TableHead>
              <TableHead className="text-right">Vendas</TableHead>
              <TableHead className="text-right">Dinheiro</TableHead>
              <TableHead className="text-right">PIX</TableHead>
              <TableHead className="text-right">Crédito</TableHead>
              <TableHead className="text-right">Débito</TableHead>
              <TableHead className="text-right">Outras</TableHead>
              <TableHead className="text-right">Cancelamentos</TableHead>
              <TableHead className="text-right">Sangrias</TableHead>
              <TableHead className="text-right">Suprimentos</TableHead>
              <TableHead className="text-right">Esperado</TableHead>
              <TableHead className="text-right">Contado</TableHead>
              <TableHead className="text-right">Diferença</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && <TableRow><TableCell colSpan={13} className="py-6 text-center text-muted-foreground">Nenhum caixa no período.</TableCell></TableRow>}
            {linhas.map((l) => (
              <TableRow key={l.caixa_id}>
                <TableCell className="text-sm">
                  <b>{l.operador}</b>
                  <p className="text-xs text-muted-foreground">Caixa nº {l.numero ?? "—"} · {dateTimeBR(l.aberto_em)} {l.fechado_em ? `→ ${dateTimeBR(l.fechado_em)}` : "(aberto)"}</p>
                </TableCell>
                <TableCell className="text-right text-numeric">{brl(l.vendas)}<p className="text-xs text-muted-foreground">{l.qtd_vendas} venda(s)</p></TableCell>
                <TableCell className="text-right text-numeric">{brl(l.dinheiro)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(l.pix)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(l.cartao_credito)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(l.cartao_debito)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(l.outras)}</TableCell>
                <TableCell className="text-right text-numeric text-destructive">{brl(l.cancelamentos)}<p className="text-xs">{l.qtd_cancelamentos}</p></TableCell>
                <TableCell className="text-right text-numeric">{brl(l.sangrias)}</TableCell>
                <TableCell className="text-right text-numeric">{brl(l.suprimentos)}</TableCell>
                <TableCell className="text-right text-numeric">{l.esperado == null ? "—" : brl(l.esperado)}</TableCell>
                <TableCell className="text-right text-numeric">{l.informado == null ? "—" : brl(l.informado)}</TableCell>
                <TableCell className={`text-right text-numeric font-semibold ${Number(l.diferenca ?? 0) < 0 ? "text-destructive" : ""}`}>{l.diferenca == null ? "—" : brl(l.diferenca)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
