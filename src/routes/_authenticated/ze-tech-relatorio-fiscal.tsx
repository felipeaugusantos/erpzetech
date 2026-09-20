import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import { Download, FileText, Package, Receipt, Wrench } from "lucide-react";
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
          notasVenda: acc.notasVenda + Number(l.notas_venda ?? 0),
          valorVenda: acc.valorVenda + Number(l.valor_notas_venda ?? 0),
          notasServico: acc.notasServico + Number(l.notas_servico ?? 0),
          valorServico: acc.valorServico + Number(l.valor_notas_servico ?? 0),
          issServico: acc.issServico + Number(l.iss_servico ?? 0),
          impostos: acc.impostos + Number(l.impostos ?? 0),
        }),
        {
          entradas: 0,
          saidas: 0,
          saldo: 0,
          notas: 0,
          valor: 0,
          notasVenda: 0,
          valorVenda: 0,
          notasServico: 0,
          valorServico: 0,
          issServico: 0,
          impostos: 0,
        },
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
      ["Entradas", 58],
      ["Saídas", 80],
      ["Saldo estoque", 102],
      ["NF-e", 130],
      ["Venda", 142],
      ["NFS-e", 166],
      ["Serviço", 178],
      ["ISS serv.", 202],
      ["ICMS", 222],
      ["ICMS ST", 240],
      ["PIS", 256],
      ["COFINS", 268],
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
        String(l.cliente ?? "—").slice(0, 26),
        brl(Number(l.entradas ?? 0)),
        brl(Number(l.saidas ?? 0)),
        brl(Number(l.saldo_estoque ?? 0)),
        num(Number(l.notas_venda ?? 0), 0),
        brl(Number(l.valor_notas_venda ?? 0)),
        num(Number(l.notas_servico ?? 0), 0),
        brl(Number(l.valor_notas_servico ?? 0)),
        brl(Number(l.iss_servico ?? 0)),
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
      `Entradas: ${brl(totais.entradas)}   Saídas: ${brl(totais.saidas)}   Saldo em estoque: ${brl(totais.saldo)}   Impostos: ${brl(totais.impostos)}`,
      14,
      y,
    );
    y += 5;
    doc.text(
      `NF-e de venda: ${num(totais.notasVenda, 0)} · ${brl(totais.valorVenda)}   NFS-e de serviço: ${num(totais.notasServico, 0)} · ${brl(totais.valorServico)} (ISS ${brl(totais.issServico)})`,
      14,
      y,
    );

    // Gráfico de barras das dez maiores lojas (entradas x saídas x impostos).
    if (grafico.length > 0) {
      doc.addPage();
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Movimento por loja — dez maiores", 14, 16);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("Barras: entradas (escura), saídas (média) e impostos (clara)", 14, 22);

      const base = 150;
      const maximo = Math.max(
        ...grafico.map((g) => Math.max(g.entradas, g.saidas, g.impostos)),
        1,
      );
      const larguraGrupo = 26;
      const larguraBarra = 7;
      doc.line(14, base, 290, base);

      grafico.forEach((g, i) => {
        const x0 = 18 + i * larguraGrupo;
        const series: [number, [number, number, number]][] = [
          [g.entradas, [0, 96, 55]],
          [g.saidas, [90, 150, 120]],
          [g.impostos, [180, 205, 190]],
        ];
        series.forEach(([valor, cor], j) => {
          const altura = Math.max((valor / maximo) * 100, valor > 0 ? 1 : 0);
          doc.setFillColor(cor[0], cor[1], cor[2]);
          doc.rect(x0 + j * (larguraBarra + 1), base - altura, larguraBarra, altura, "F");
        });
        doc.setFontSize(7);
        doc.text(g.nome, x0, base + 5, { maxWidth: larguraGrupo - 2 });
        doc.text(brl(g.entradas), x0, base + 10, { maxWidth: larguraGrupo - 2 });
      });
    }


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

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Entradas" value={brl(totais.entradas)} icon={Package} />
        <StatCard label="Saídas" value={brl(totais.saidas)} tone="warning" icon={Package} />
        <StatCard label="Saldo em estoque" value={brl(totais.saldo)} tone="accent" icon={Package} />
        <StatCard
          label="Notas de venda"
          value={brl(totais.valorVenda)}
          hint={`${num(totais.notasVenda, 0)} NF-e no período`}
          icon={FileText}
        />
        <StatCard
          label="Notas de serviço"
          value={brl(totais.valorServico)}
          hint={`${num(totais.notasServico, 0)} NFS-e · ISS ${brl(totais.issServico)}`}
          tone="accent"
          icon={Wrench}
        />
        <StatCard
          label="Impostos no período"
          value={brl(totais.impostos)}
          hint={`${num(totais.notas, 0)} notas · ${brl(totais.valor)} faturado`}
          tone="success"
          icon={Receipt}
        />
      </div>

      {grafico.length > 0 && (
        <div className="panel mb-5 p-4">
          <p className="mb-3 font-display text-sm font-semibold">
            Entradas, saídas e impostos por loja
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="nome" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => brl(Number(v))} width={90} />
                <Tooltip formatter={(v) => brl(Number(v))} />
                <Legend />
                <Bar dataKey="entradas" name="Entradas" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="saidas" name="Saídas" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="impostos" name="Impostos" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}



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
