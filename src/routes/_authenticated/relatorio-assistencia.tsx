import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import { CircleDollarSign, Clock, Download, Wrench } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR, num } from "@/lib/format";
import { usePeriodo } from "@/lib/periodo";
import { useModulosCnae } from "@/lib/cnae";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/relatorio-assistencia")({
  head: () => ({
    meta: [
      { title: "Relatório de assistência técnica — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Ordens de serviço, reparos e custos por loja, com exportação do relatório em PDF.",
      },
      { property: "og:title", content: "Relatório de assistência técnica — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Exporte em PDF as ordens, reparos e custos da assistência técnica da loja.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RelatorioAssistencia,
});

const SITUACOES: Record<string, string> = {
  aberta: "Aberta",
  em_analise: "Em análise",
  orcamento: "Orçamento",
  aprovada: "Aprovada",
  em_reparo: "Em reparo",
  pronta: "Pronta",
  entregue: "Entregue",
  cancelada: "Cancelada",
};

function RelatorioAssistencia() {
  const { periodo, setDe, setAte } = usePeriodo();
  const { data: session } = useSessionData();
  const modulos = useModulosCnae();
  const [filialId, setFilialId] = useState("todas");
  const [situacao, setSituacao] = useState("todas");

  const { data: ordens = [], isLoading } = useQuery({
    queryKey: ["relatorio-assistencia", periodo.de, periodo.ate, filialId],
    enabled: modulos.assistencia,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("assistencia_ordens_relatorio", {
        p_de: periodo.de,
        p_ate: periodo.ate,
        p_filial_id: filialId === "todas" ? undefined : filialId,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const linhas = useMemo(
    () => (situacao === "todas" ? ordens : ordens.filter((o) => o.situacao === situacao)),
    [ordens, situacao],
  );

  const totais = useMemo(
    () =>
      linhas.reduce(
        (acc, o) => ({
          ordens: acc.ordens + 1,
          entregues: acc.entregues + (o.situacao === "entregue" ? 1 : 0),
          horas: acc.horas + Number(o.horas_trabalhadas ?? 0),
          pecas: acc.pecas + Number(o.valor_pecas ?? 0),
          servicos: acc.servicos + Number(o.valor_servicos ?? 0),
          total: acc.total + Number(o.valor_total ?? 0),
        }),
        { ordens: 0, entregues: 0, horas: 0, pecas: 0, servicos: 0, total: 0 },
      ),
    [linhas],
  );

  function exportarPdf() {
    if (linhas.length === 0) {
      toast.error("Nenhuma ordem no período para exportar.");
      return;
    }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const empresa = session?.empresa;
    const loja =
      filialId === "todas"
        ? "Todas as lojas"
        : (session?.filiais.find((f) => f.id === filialId)?.nome ?? "Loja");

    doc.setFontSize(14);
    doc.text(
      (empresa?.nome_fantasia || empresa?.razao_social || "ERP Ze Tech").slice(0, 60),
      14,
      14,
    );
    doc.setFontSize(10);
    doc.text(`Relatório de assistência técnica — ${loja}`, 14, 20);
    doc.text(`Período: ${dateBR(periodo.de)} a ${dateBR(periodo.ate)}`, 14, 25);

    const colunas: [string, number][] = [
      ["Nº", 14],
      ["Abertura", 24],
      ["Loja", 44],
      ["Cliente", 74],
      ["Equipamento", 112],
      ["Técnico", 158],
      ["Situação", 192],
      ["Horas", 216],
      ["Peças", 236],
      ["M. obra", 256],
      ["Total", 276],
    ];

    let y = 34;
    const cabecalho = () => {
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      colunas.forEach(([label, x]) => doc.text(label, x, y));
      doc.setFont("helvetica", "normal");
      doc.line(14, y + 1.5, 290, y + 1.5);
      y += 6;
    };
    cabecalho();

    linhas.forEach((o) => {
      if (y > 195) {
        doc.addPage();
        y = 16;
        cabecalho();
      }
      const valores = [
        String(o.numero ?? ""),
        dateBR(o.abertura),
        (o.filial ?? "—").slice(0, 16),
        (o.cliente ?? "—").slice(0, 20),
        [o.equipamento, o.marca, o.modelo].filter(Boolean).join(" ").slice(0, 26),
        (o.tecnico ?? "—").slice(0, 18),
        SITUACOES[o.situacao] ?? o.situacao,
        num(Number(o.horas_trabalhadas ?? 0), 1),
        brl(Number(o.valor_pecas ?? 0)),
        brl(Number(o.valor_servicos ?? 0)),
        brl(Number(o.valor_total ?? 0)),
      ];
      valores.forEach((v, i) => doc.text(v, colunas[i]![1], y));
      y += 5;

      const reparo = [o.defeito_relatado, o.laudo].filter(Boolean).join(" · ");
      if (reparo) {
        doc.setTextColor(110);
        doc.text(`Reparo: ${reparo}`.slice(0, 170), 24, y);
        doc.setTextColor(0);
        y += 5;
      }
    });

    if (y > 185) {
      doc.addPage();
      y = 16;
    }
    y += 3;
    doc.line(14, y, 290, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(
      `Ordens: ${num(totais.ordens, 0)}   Entregues: ${num(totais.entregues, 0)}   Horas: ${num(totais.horas, 1)}   Peças: ${brl(totais.pecas)}   Mão de obra: ${brl(totais.servicos)}   Total: ${brl(totais.total)}`,
      14,
      y,
    );

    doc.save(`assistencia-${periodo.de}-a-${periodo.ate}.pdf`);
    toast.success("Relatório exportado em PDF.");
  }

  if (!modulos.carregando && !modulos.assistencia) return <ModuloBloqueado modulo="assistencia" />;

  return (
    <div>
      <PageHeader
        title="Relatório de assistência técnica"
        description="Ordens, reparos e custos da loja no período, com exportação em PDF para imprimir ou enviar."
        action={
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
        <div className="min-w-44">
          <Label>Loja</Label>
          <Select value={filialId} onValueChange={setFilialId}>
            <SelectTrigger aria-label="Loja">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as lojas</SelectItem>
              {(session?.filiais ?? []).map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-44">
          <Label>Situação</Label>
          <Select value={situacao} onValueChange={setSituacao}>
            <SelectTrigger aria-label="Situação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {Object.entries(SITUACOES).map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Ordens no período"
          value={num(totais.ordens, 0)}
          hint={`${num(totais.entregues, 0)} entregues`}
          icon={Wrench}
        />
        <StatCard label="Horas trabalhadas" value={num(totais.horas, 1)} icon={Clock} />
        <StatCard label="Peças" value={brl(totais.pecas)} tone="warning" icon={CircleDollarSign} />
        <StatCard
          label="Total dos reparos"
          value={brl(totais.total)}
          hint={`Mão de obra ${brl(totais.servicos)}`}
          tone="accent"
          icon={CircleDollarSign}
        />
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : linhas.length === 0 ? (
        <EmptyState
          title="Nenhuma ordem no período."
          description="Ajuste o período ou a loja para ver as ordens de serviço."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Abertura</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Equipamento</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Horas</TableHead>
                <TableHead className="text-right">Peças</TableHead>
                <TableHead className="text-right">Mão de obra</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((o) => (
                <TableRow key={o.os_id}>
                  <TableCell className="font-medium">{o.numero}</TableCell>
                  <TableCell>{dateBR(o.abertura)}</TableCell>
                  <TableCell className="text-muted-foreground">{o.filial ?? "—"}</TableCell>
                  <TableCell>{o.cliente ?? "—"}</TableCell>
                  <TableCell>
                    {o.equipamento}
                    <span className="block text-xs text-muted-foreground">
                      {[o.marca, o.modelo].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </TableCell>
                  <TableCell>{o.tecnico ?? "—"}</TableCell>
                  <TableCell>{SITUACOES[o.situacao] ?? o.situacao}</TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(o.horas_trabalhadas ?? 0), 1)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(o.valor_pecas ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(o.valor_servicos ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {brl(Number(o.valor_total ?? 0))}
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
