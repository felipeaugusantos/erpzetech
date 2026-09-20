import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import { Download, FileText, Package, Receipt } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, num } from "@/lib/format";
import { usePeriodo } from "@/lib/periodo";
import { useSaasOperador } from "@/lib/saas";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/ze-tech-relatorio-fiscal")({
  head: () => ({
    meta: [
      { title: "Relatório fiscal por período — Ze Tech" },
      {
        name: "description",
        content:
          "Entradas, saídas, saldo de estoque e impostos de cada loja assinante no período, com exportação em PDF.",
      },
      { property: "og:title", content: "Relatório fiscal por período — Ze Tech" },
      {
        property: "og:description",
        content: "Exporte em PDF o consolidado fiscal das lojas assinantes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ZeTechRelatorioFiscal,
});

function ZeTechRelatorioFiscal() {
  const { periodo, setDe, setAte } = usePeriodo();
  const { data: operador } = useSaasOperador();
  const [busca, setBusca] = useState("");

  const { data: linhasBrutas = [], isLoading } = useQuery({
    queryKey: ["ze-tech-relatorio-fiscal", periodo.de, periodo.ate],
    enabled: !!operador,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("saas_fiscal_por_periodo", {
        p_de: periodo.de,
        p_ate: periodo.ate,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const linhas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return linhasBrutas;
    return linhasBrutas.filter((l) =>
      [l.cliente, l.plano].filter(Boolean).some((x) => String(x).toLowerCase().includes(t)),
    );
  }, [linhasBrutas, busca]);

  const totais = useMemo(
    () =>
      linhas.reduce(
        (acc, l) => ({
          entradas: acc.entradas + Number(l.entradas ?? 0),
          saidas: acc.saidas + Number(l.saidas ?? 0),
          saldo: acc.saldo + Number(l.saldo_estoque ?? 0),
          notas: acc.notas + Number(l.notas ?? 0),
          valor: acc.valor + Number(l.valor_notas ?? 0),
          impostos: acc.impostos + Number(l.impostos ?? 0),
        }),
        { entradas: 0, saidas: 0, saldo: 0, notas: 0, valor: 0, impostos: 0 },
      ),
    [linhas],
  );

  /** Dez maiores lojas por movimento, para o gráfico e o resumo do PDF. */
  const grafico = useMemo(
    () =>
      [...linhas]
        .sort(
          (a, b) =>
            Number(b.entradas ?? 0) +
            Number(b.saidas ?? 0) -
            (Number(a.entradas ?? 0) + Number(a.saidas ?? 0)),
        )
        .slice(0, 10)
        .map((l) => ({
          nome: String(l.cliente ?? "—").slice(0, 14),
          entradas: Number(l.entradas ?? 0),
          saidas: Number(l.saidas ?? 0),
          impostos: Number(l.impostos ?? 0),
        })),
    [linhas],
  );



  function exportarPdf() {
    if (linhas.length === 0) {
      toast.error("Nenhum dado no período para exportar.");
      return;
    }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFontSize(14);
    doc.text("Ze Tech — Relatório fiscal por período", 14, 14);
    doc.setFontSize(10);
    doc.text(`Período: ${dateBR(periodo.de)} a ${dateBR(periodo.ate)}`, 14, 21);

    const colunas: [string, number][] = [
      ["Loja cliente", 14],
      ["Plano", 62],
      ["Entradas", 92],
      ["Saídas", 116],
      ["Saldo estoque", 140],
      ["Notas", 170],
      ["Faturado", 186],
      ["ICMS", 210],
      ["ICMS ST", 230],
      ["PIS", 250],
      ["COFINS", 264],
      ["Impostos", 282],
    ];

    let y = 30;
    const cabecalho = () => {
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      colunas.forEach(([label, x]) => doc.text(label, x, y));
      doc.setFont("helvetica", "normal");
      doc.line(14, y + 1.5, 293, y + 1.5);
      y += 6;
    };
    cabecalho();

    linhas.forEach((l) => {
      if (y > 195) {
        doc.addPage();
        y = 16;
        cabecalho();
      }
      const valores = [
        String(l.cliente ?? "—").slice(0, 28),
        String(l.plano ?? "—").slice(0, 16),
        brl(Number(l.entradas ?? 0)),
        brl(Number(l.saidas ?? 0)),
        brl(Number(l.saldo_estoque ?? 0)),
        num(Number(l.notas ?? 0), 0),
        brl(Number(l.valor_notas ?? 0)),
        brl(Number(l.icms ?? 0)),
        brl(Number(l.icms_st ?? 0)),
        brl(Number(l.pis ?? 0)),
        brl(Number(l.cofins ?? 0)),
        brl(Number(l.impostos ?? 0)),
      ];
      valores.forEach((v, i) => doc.text(v, colunas[i]![1], y));
      y += 5;
    });

    if (y > 185) {
      doc.addPage();
      y = 16;
    }
    y += 3;
    doc.line(14, y, 293, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(
      `Entradas: ${brl(totais.entradas)}   Saídas: ${brl(totais.saidas)}   Saldo em estoque: ${brl(totais.saldo)}   Notas: ${num(totais.notas, 0)}   Faturado: ${brl(totais.valor)}   Impostos: ${brl(totais.impostos)}`,
      14,
      y,
    );

    doc.save(`ze-tech-fiscal-${periodo.de}-a-${periodo.ate}.pdf`);
    toast.success("Relatório exportado em PDF.");
  }

  if (!operador) {
    return (
      <EmptyState
        title="Área restrita à equipe Ze Tech."
        description="Entre com a conta da equipe para ver o relatório fiscal das lojas."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Relatório fiscal por período"
        description="Entradas, saídas, saldo em estoque e impostos de cada loja assinante, com exportação em PDF."
        actions={
          <Button onClick={exportarPdf} disabled={linhas.length === 0}>
            <Download className="size-4" /> Exportar PDF
          </Button>
        }
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
        <div className="min-w-56 flex-1">
          <Label>Buscar loja</Label>
          <Input
            placeholder="Nome da loja ou plano"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Entradas" value={brl(totais.entradas)} icon={Package} />
        <StatCard label="Saídas" value={brl(totais.saidas)} tone="warning" icon={Package} />
        <StatCard label="Saldo em estoque" value={brl(totais.saldo)} tone="accent" icon={Package} />
        <StatCard
          label="Impostos no período"
          value={brl(totais.impostos)}
          hint={`${num(totais.notas, 0)} notas · ${brl(totais.valor)} faturado`}
          tone="success"
          icon={Receipt}
        />
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : linhas.length === 0 ? (
        <EmptyState
          title="Nenhum movimento fiscal no período."
          description="Ajuste o período para ver entradas, saídas e impostos das lojas."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Loja cliente</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead className="text-right">Entradas</TableHead>
                <TableHead className="text-right">Saídas</TableHead>
                <TableHead className="text-right">Saldo estoque</TableHead>
                <TableHead className="text-right">Notas</TableHead>
                <TableHead className="text-right">Faturado</TableHead>
                <TableHead className="text-right">ICMS</TableHead>
                <TableHead className="text-right">ICMS ST</TableHead>
                <TableHead className="text-right">PIS</TableHead>
                <TableHead className="text-right">COFINS</TableHead>
                <TableHead className="text-right">ISS</TableHead>
                <TableHead className="text-right">Impostos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.cliente_id}>
                  <TableCell className="font-medium">
                    <FileText className="mr-1 inline size-3.5 text-muted-foreground" />
                    {l.cliente}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.plano ?? "—"}</TableCell>
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
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
