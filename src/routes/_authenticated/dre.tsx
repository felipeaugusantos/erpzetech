import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl } from "@/lib/format";
import { hojeISO } from "@/lib/financeiro";
import { podeGerirCategorias } from "@/lib/categorias-financeiras";
import { montarDre, percentualDe, periodoDoAno, periodoDoMes, type ItemDre } from "@/lib/dre";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
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

export const Route = createFileRoute("/_authenticated/dre")({
  head: () => ({
    meta: [
      { title: "DRE — EZRA ERP" },
      {
        name: "description",
        content: "Demonstrativo de resultado do período por categoria de receita e despesa.",
      },
      { property: "og:title", content: "DRE — EZRA ERP" },
      { property: "og:description", content: "Resultado do período, do faturamento ao lucro." },
    ],
  }),
  component: Dre,
});

function Dre() {
  const { data: sessao } = useSessionData();
  const podeVer = podeGerirCategorias(sessao?.roles ?? []);
  const inicial = periodoDoMes(hojeISO());
  const [de, setDe] = useState(inicial.de);
  const [ate, setAte] = useState(inicial.ate);

  const {
    data: linhas = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["financeiro-dre", de, ate],
    enabled: podeVer && de <= ate,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("financeiro_dre", { p_de: de, p_ate: ate });
      if (error) throw error;
      return data;
    },
  });

  const dre = useMemo(() => montarDre(linhas), [linhas]);
  const base = dre.receitaBruta;

  if (!podeVer) {
    return (
      <div>
        <PageHeader title="DRE" />
        <EmptyState
          title="Acesso restrito"
          description="Só administrador, gestor e financeiro veem o DRE."
        />
      </div>
    );
  }

  const pct = (v: number) => {
    const p = percentualDe(v, base);
    return p === null ? "—" : `${p.toFixed(1).replace(".", ",")}%`;
  };

  const Titulo = ({
    texto,
    valor,
    destaque,
  }: {
    texto: string;
    valor: number;
    destaque?: boolean;
  }) => (
    <TableRow className={destaque ? "bg-secondary/60 font-semibold" : "font-medium"}>
      <TableCell>{texto}</TableCell>
      <TableCell className="text-right text-numeric">{brl(valor)}</TableCell>
      <TableCell className="w-20 text-right text-xs text-muted-foreground">{pct(valor)}</TableCell>
    </TableRow>
  );
  const Itens = ({ itens, sinal }: { itens: ItemDre[]; sinal: "+" | "-" }) => (
    <>
      {itens.map((i) => (
        <TableRow key={`${i.categoriaId ?? "sem"}-${i.nome}`}>
          <TableCell className="pl-8 text-sm text-muted-foreground">
            {sinal === "-" ? "(−) " : ""}
            {i.nome}
            {i.categoriaId === null && (
              <span className="ml-2 text-xs text-warning-foreground">sem categoria</span>
            )}
          </TableCell>
          <TableCell className="text-right text-numeric text-sm">
            {sinal === "-" ? `(${brl(i.valor)})` : brl(i.valor)}
          </TableCell>
          <TableCell className="w-20 text-right text-xs text-muted-foreground">
            {pct(i.valor)}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
  const Linha = ({ texto, valor, sinal }: { texto: string; valor: number; sinal: "+" | "-" }) =>
    valor === 0 ? null : <Itens itens={[{ categoriaId: "x", nome: texto, valor }]} sinal={sinal} />;

  const semCat = dre.semCategoria.receitas + dre.semCategoria.despesas;

  return (
    <div>
      <PageHeader
        title="DRE"
        description="Demonstrativo gerencial: vendas pela data do pedido; demais receitas e despesas pelo vencimento."
        actions={
          <Button asChild variant="outline">
            <Link to="/financeiro-categorias">Categorias</Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <Label>De</Label>
          <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <Label>Até</Label>
          <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        {[
          { texto: "Mês atual", p: periodoDoMes(hojeISO()) },
          { texto: "Mês anterior", p: periodoDoMes(hojeISO(), 1) },
          { texto: "Ano", p: periodoDoAno(hojeISO()) },
        ].map((x) => (
          <Button
            key={x.texto}
            variant="outline"
            size="sm"
            onClick={() => {
              setDe(x.p.de);
              setAte(x.p.ate);
            }}
          >
            {x.texto}
          </Button>
        ))}
      </div>

      {de > ate && <p className="mb-3 text-sm text-destructive">A data inicial passa da final.</p>}
      {error && <p className="mb-3 text-sm text-destructive">{(error as Error).message}</p>}

      {semCat > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            Há {brl(dre.semCategoria.receitas)} de receitas e {brl(dre.semCategoria.despesas)} de
            despesas <strong>sem categoria</strong> no período. Elas entram como “operacional”.
            Classifique em{" "}
            <Link to="/contas-pagar" className="underline">
              Contas a pagar
            </Link>{" "}
            ou{" "}
            <Link to="/contas-receber" className="underline">
              Contas a receber
            </Link>{" "}
            (botão “Categoria”).
          </p>
        </div>
      )}

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Calculando…</p>
      ) : linhas.length === 0 ? (
        <EmptyState
          title="Sem movimento no período"
          description="Não há vendas, receitas nem despesas com vencimento neste período."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Demonstrativo</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-20 text-right">% receita bruta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <Linha texto="Vendas de mercadorias e serviços" valor={dre.vendas} sinal="+" />
              <Itens itens={dre.outrasReceitas} sinal="+" />
              <Titulo texto="Receita bruta" valor={dre.receitaBruta} destaque />
              <Linha texto="Devoluções de vendas" valor={dre.devolucoes} sinal="-" />
              <Itens itens={dre.deducoes} sinal="-" />
              <Titulo texto="Receita líquida" valor={dre.receitaLiquida} destaque />
              <Linha texto="Custo das mercadorias vendidas" valor={dre.cmv} sinal="-" />
              <Itens itens={dre.custosDiretos} sinal="-" />
              <Titulo texto="Lucro bruto" valor={dre.lucroBruto} destaque />
              <Itens itens={dre.despesasOperacionais} sinal="-" />
              <Titulo texto="Resultado operacional" valor={dre.resultadoOperacional} destaque />
              <Itens itens={dre.receitasFinanceiras} sinal="+" />
              <Itens itens={dre.despesasFinanceiras} sinal="-" />
              <Titulo
                texto="Resultado antes dos impostos"
                valor={dre.resultadoAntesImpostos}
                destaque
              />
              <Itens itens={dre.impostosLucro} sinal="-" />
              <Titulo texto="Resultado líquido" valor={dre.resultadoLiquido} destaque />
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Compra de mercadoria para estoque e categorias “fora do DRE” não entram como despesa: o
        custo vem do CMV (custo gravado nos itens vendidos). É um demonstrativo gerencial, não
        substitui a contabilidade.
      </p>
    </div>
  );
}
