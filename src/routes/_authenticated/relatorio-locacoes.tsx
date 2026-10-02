import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import { CalendarClock, CircleDollarSign, Download, Truck } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/relatorio-locacoes")({
  head: () => ({
    meta: [
      { title: "Relatório de locação de equipamentos — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Contratos de locação, devoluções e custos dos equipamentos por período, com exportação em PDF.",
      },
      { property: "og:title", content: "Relatório de locação de equipamentos — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Exporte em PDF os aluguéis, devoluções e custos dos equipamentos da loja.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RelatorioLocacoesModulo,
});

const SITUACOES: Record<string, string> = {
  reservada: "Reservada",
  em_andamento: "Em locação",
  devolvida: "Devolvida",
  cancelada: "Cancelada",
};

const hojeISO = () => new Date().toISOString().slice(0, 10);

function RelatorioLocacoes() {
  const { periodo, setDe, setAte } = usePeriodo();
  const { data: session } = useSessionData();
  const [filialId, setFilialId] = useState("todas");
  const [situacao, setSituacao] = useState("todas");

  const { data: locacoes = [], isLoading } = useQuery({
    queryKey: ["relatorio-locacoes", periodo.de, periodo.ate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locacoes")
        .select(
          "id, numero, filial_id, inicio, previsao_devolucao, devolvido_em, dias, valor_diaria, valor_total, caucao, situacao, clientes(nome), obras(nome), locacao_equipamentos(nome, codigo, valor_aquisicao, custo_manutencao)",
        )
        .gte("inicio", periodo.de)
        .lte("inicio", periodo.ate)
        .order("numero", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const nomeFilial = (id: string | null) => session?.filiais.find((f) => f.id === id)?.nome ?? "—";

  const linhas = useMemo(
    () =>
      locacoes.filter(
        (l) =>
          (filialId === "todas" || l.filial_id === filialId) &&
          (situacao === "todas" || l.situacao === situacao),
      ),
    [locacoes, filialId, situacao],
  );

  const totais = useMemo(
    () =>
      linhas.reduce(
        (acc, l) => ({
          contratos: acc.contratos + 1,
          devolvidas: acc.devolvidas + (l.situacao === "devolvida" ? 1 : 0),
          atrasadas:
            acc.atrasadas +
            (l.situacao === "em_andamento" &&
            !!l.previsao_devolucao &&
            l.previsao_devolucao < hojeISO()
              ? 1
              : 0),
          dias: acc.dias + Number(l.dias ?? 0),
          receita: acc.receita + Number(l.valor_total ?? 0),
          caucao: acc.caucao + Number(l.caucao ?? 0),
          custo: acc.custo + Number(l.locacao_equipamentos?.custo_manutencao ?? 0),
        }),
        { contratos: 0, devolvidas: 0, atrasadas: 0, dias: 0, receita: 0, caucao: 0, custo: 0 },
      ),
    [linhas],
  );

  function exportarPdf() {
    if (linhas.length === 0) {
      toast.error("Nenhuma locação no período para exportar.");
      return;
    }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const empresa = session?.empresa;
    const loja = filialId === "todas" ? "Todas as lojas" : nomeFilial(filialId);

    doc.setFontSize(14);
    doc.text(
      (empresa?.nome_fantasia || empresa?.razao_social || "ERP Ze Tech").slice(0, 60),
      14,
      14,
    );
    doc.setFontSize(10);
    doc.text(`Relatório de locação de equipamentos — ${loja}`, 14, 20);
    doc.text(`Período: ${dateBR(periodo.de)} a ${dateBR(periodo.ate)}`, 14, 25);

    const colunas: [string, number][] = [
      ["Nº", 14],
      ["Início", 24],
      ["Loja", 44],
      ["Cliente", 72],
      ["Equipamento", 110],
      ["Obra", 148],
      ["Previsão", 176],
      ["Devolução", 196],
      ["Situação", 216],
      ["Dias", 238],
      ["Caução", 250],
      ["Custo", 268],
      ["Total", 284],
    ];

    let y = 34;
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
        String(l.numero ?? ""),
        dateBR(l.inicio),
        nomeFilial(l.filial_id).slice(0, 14),
        (l.clientes?.nome ?? "—").slice(0, 20),
        (l.locacao_equipamentos?.nome ?? "—").slice(0, 20),
        (l.obras?.nome ?? "—").slice(0, 14),
        dateBR(l.previsao_devolucao),
        dateBR(l.devolvido_em),
        SITUACOES[l.situacao] ?? l.situacao,
        num(Number(l.dias ?? 0), 0),
        brl(Number(l.caucao ?? 0)),
        brl(Number(l.locacao_equipamentos?.custo_manutencao ?? 0)),
        brl(Number(l.valor_total ?? 0)),
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
      `Contratos: ${num(totais.contratos, 0)}   Devolvidos: ${num(totais.devolvidas, 0)}   Atrasados: ${num(totais.atrasadas, 0)}   Dias: ${num(totais.dias, 0)}   Caução: ${brl(totais.caucao)}   Custo de manutenção: ${brl(totais.custo)}   Receita: ${brl(totais.receita)}`,
      14,
      y,
    );

    doc.save(`locacoes-${periodo.de}-a-${periodo.ate}.pdf`);
    toast.success("Relatório exportado em PDF.");
  }

  return (
    <div>
      <PageHeader
        title="Relatório de locação de equipamentos"
        description="Aluguéis, devoluções, caução e custo dos equipamentos no período, com exportação em PDF."
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
          label="Contratos no período"
          value={num(totais.contratos, 0)}
          hint={`${num(totais.devolvidas, 0)} devolvidos`}
          icon={CalendarClock}
        />
        <StatCard
          label="Devolução atrasada"
          value={num(totais.atrasadas, 0)}
          tone="danger"
          icon={Truck}
        />
        <StatCard
          label="Custo de manutenção"
          value={brl(totais.custo)}
          tone="warning"
          icon={CircleDollarSign}
        />
        <StatCard
          label="Receita de locação"
          value={brl(totais.receita)}
          hint={`Caução ${brl(totais.caucao)}`}
          tone="accent"
          icon={CircleDollarSign}
        />
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : linhas.length === 0 ? (
        <EmptyState
          title="Nenhuma locação no período."
          description="Ajuste o período, a loja ou a situação para ver os contratos de locação."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Equipamento</TableHead>
                <TableHead>Obra</TableHead>
                <TableHead>Previsão</TableHead>
                <TableHead>Devolução</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Dias</TableHead>
                <TableHead className="text-right">Caução</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-numeric font-semibold">{l.numero}</TableCell>
                  <TableCell>{dateBR(l.inicio)}</TableCell>
                  <TableCell className="text-muted-foreground">{nomeFilial(l.filial_id)}</TableCell>
                  <TableCell>{l.clientes?.nome ?? "—"}</TableCell>
                  <TableCell>
                    {l.locacao_equipamentos?.nome ?? "—"}
                    <span className="block text-xs text-muted-foreground">
                      {l.locacao_equipamentos?.codigo ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.obras?.nome ?? "—"}</TableCell>
                  <TableCell
                    className={
                      l.situacao === "em_andamento" &&
                      !!l.previsao_devolucao &&
                      l.previsao_devolucao < hojeISO()
                        ? "font-semibold text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {dateBR(l.previsao_devolucao)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{dateBR(l.devolvido_em)}</TableCell>
                  <TableCell>{SITUACOES[l.situacao] ?? l.situacao}</TableCell>
                  <TableCell className="text-right text-numeric">{l.dias}</TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.caucao ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.locacao_equipamentos?.custo_manutencao ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {brl(Number(l.valor_total ?? 0))}
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

/** O relatório só abre quando o CNAE da empresa libera a locação. */
function RelatorioLocacoesModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.locacao) return <ModuloBloqueado modulo="locacao" />;
  return <RelatorioLocacoes />;
}
