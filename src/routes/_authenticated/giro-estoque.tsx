import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Gauge, Layers, ShoppingCart } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, num } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/giro-estoque")({
  head: () => ({
    meta: [
      { title: "Giro de estoque e sugestão de compra — Ze Obra" },
      {
        name: "description",
        content:
          "Curva ABC pelo giro de venda, cobertura em dias e quanto comprar de cada produto para 15, 30 ou 60 dias.",
      },
      { property: "og:title", content: "Giro de estoque e sugestão de compra — Ze Obra" },
      {
        property: "og:description",
        content: "Veja o giro de cada produto e a quantidade sugerida de compra para 15, 30 e 60 dias.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GiroEstoque,
});

/** Folga de segurança por classe: item de giro alto merece um pouco mais de estoque. */
const folgaPorClasse: Record<"A" | "B" | "C", number> = { A: 1.25, B: 1.1, C: 1 };

type Linha = {
  produto_id: string;
  descricao: string;
  codigo: string;
  unidade: string;
  unidadeCompra: string | null;
  fator: number;
  custo: number;
  vendido: number;
  receita: number;
  disponivel: number;
  mediaDia: number;
  cobertura: number;
  classe: "A" | "B" | "C";
  participacao: number;
  acumulado: number;
  comprar15: number;
  comprar30: number;
  comprar60: number;
};

function GiroEstoque() {
  const [janela, setJanela] = useState("90");
  const [depositoId, setDepositoId] = useState("todos");
  const [classe, setClasse] = useState("todas");
  const [busca, setBusca] = useState("");
  const [horizonte, setHorizonte] = useState<"15" | "30" | "60">("30");

  const dias = Number(janela);
  const desde = useMemo(
    () => new Date(Date.now() - dias * 86400000).toISOString(),
    [dias],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["giro-estoque", janela],
    queryFn: async () => {
      const [depRes, prodRes, itensRes, estRes] = await Promise.all([
        supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome"),
        supabase
          .from("produtos")
          .select(
            "id, descricao, codigo_interno, unidade, unidade_compra, fator_conversao, custo, estoque_minimo",
          )
          .eq("ativo", true)
          .order("descricao"),
        supabase
          .from("pedido_itens")
          .select(
            "produto_id, quantidade, total, pedidos!inner(id, created_at, situacao, deposito_id)",
          )
          .gte("pedidos.created_at", desde)
          .neq("pedidos.situacao", "cancelado"),
        supabase
          .from("estoques")
          .select("produto_id, quantidade, reservado, custo_medio, deposito_id"),
      ]);
      if (itensRes.error) throw itensRes.error;
      if (estRes.error) throw estRes.error;
      return {
        depositos: depRes.data ?? [],
        produtos: prodRes.data ?? [],
        itens: itensRes.data ?? [],
        estoques: estRes.data ?? [],
      };
    },
  });

  const depositos = data?.depositos ?? [];

  const linhas = useMemo<Linha[]>(() => {
    const produtos = data?.produtos ?? [];
    const vendas = new Map<string, { qtd: number; receita: number }>();
    for (const i of data?.itens ?? []) {
      const atual = vendas.get(i.produto_id) ?? { qtd: 0, receita: 0 };
      atual.qtd += Number(i.quantidade ?? 0);
      atual.receita += Number(i.total ?? 0);
      vendas.set(i.produto_id, atual);
    }

    const saldo = new Map<string, { disponivel: number; custo: number }>();
    for (const e of data?.estoques ?? []) {
      const atual = saldo.get(e.produto_id) ?? { disponivel: 0, custo: 0 };
      atual.disponivel += Number(e.quantidade ?? 0) - Number(e.reservado ?? 0);
      atual.custo = Math.max(atual.custo, Number(e.custo_medio ?? 0));
      saldo.set(e.produto_id, atual);
    }

    const receitaTotal = [...vendas.values()].reduce((s, v) => s + v.receita, 0);

    /** Curva ABC clássica: A até 80% do faturamento, B até 95%, C o resto. */
    const ordenados = produtos
      .map((p) => {
        const v = vendas.get(p.id) ?? { qtd: 0, receita: 0 };
        const s = saldo.get(p.id) ?? { disponivel: 0, custo: 0 };
        return {
          p,
          vendido: v.qtd,
          receita: v.receita,
          disponivel: s.disponivel,
          custo: s.custo > 0 ? s.custo : Number(p.custo ?? 0),
        };
      })
      .sort((a, b) => b.receita - a.receita);

    let acumuladoValor = 0;
    return ordenados.map((r) => {
      const participacao = receitaTotal > 0 ? (r.receita / receitaTotal) * 100 : 0;
      acumuladoValor += participacao;
      const classeItem: "A" | "B" | "C" =
        r.receita <= 0 ? "C" : acumuladoValor <= 80 ? "A" : acumuladoValor <= 95 ? "B" : "C";
      const mediaDia = r.vendido / dias;
      const folga = folgaPorClasse[classeItem];
      const minimo = Number(r.p.estoque_minimo ?? 0);
      const necessidade = (d: number) =>
        Math.max(Math.max(mediaDia * d * folga, minimo) - r.disponivel, 0);
      return {
        produto_id: r.p.id,
        descricao: r.p.descricao,
        codigo: r.p.codigo_interno ?? "",
        unidade: r.p.unidade ?? "UN",
        unidadeCompra: r.p.unidade_compra ?? null,
        fator: Number(r.p.fator_conversao ?? 1) || 1,
        custo: r.custo,
        vendido: r.vendido,
        receita: r.receita,
        disponivel: r.disponivel,
        mediaDia,
        cobertura: mediaDia > 0 ? r.disponivel / mediaDia : Infinity,
        classe: classeItem,
        participacao,
        acumulado: acumuladoValor,
        comprar15: necessidade(15),
        comprar30: necessidade(30),
        comprar60: necessidade(60),
      };
    });
  }, [data, dias]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (classe !== "todas" && l.classe !== classe) return false;
      if (t && !`${l.descricao} ${l.codigo}`.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [linhas, classe, busca]);

  const comprarDoHorizonte = (l: Linha) =>
    horizonte === "15" ? l.comprar15 : horizonte === "30" ? l.comprar30 : l.comprar60;

  const resumo = useMemo(() => {
    const porClasse = { A: 0, B: 0, C: 0 } as Record<"A" | "B" | "C", number>;
    for (const l of linhas) if (l.vendido > 0) porClasse[l.classe] += 1;
    const investimento = visiveis.reduce((s, l) => s + comprarDoHorizonte(l) * l.custo, 0);
    const aComprar = visiveis.filter((l) => comprarDoHorizonte(l) > 0).length;
    const emFalta = linhas.filter((l) => l.mediaDia > 0 && l.cobertura < Number(horizonte)).length;
    return { porClasse, investimento, aComprar, emFalta };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, visiveis, horizonte]);

  return (
    <>
      <PageHeader
        title="Giro de estoque e sugestão de compra"
        description="O sistema olha as vendas do período, classifica cada produto na curva ABC pelo giro e calcula quanto comprar para 15, 30 ou 60 dias de venda."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/estoque">
                <Boxes className="mr-2 size-4" /> Estoque
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/compras">
                <ShoppingCart className="mr-2 size-4" /> Pedidos de compra
              </Link>
            </Button>
          </>
        }
      />

      <div className="panel mb-6 grid gap-4 p-4 md:grid-cols-4">
        <div>
          <Label>Período analisado</Label>
          <Select value={janela} onValueChange={setJanela}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="60">Últimos 60 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="180">Últimos 180 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Depósito</Label>
          <Select value={depositoId} onValueChange={setDepositoId}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os depósitos</SelectItem>
              {depositos.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Classe do giro</Label>
          <Select value={classe} onValueChange={setClasse}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as classes</SelectItem>
              <SelectItem value="A">A — giro alto</SelectItem>
              <SelectItem value="B">B — giro médio</SelectItem>
              <SelectItem value="C">C — giro baixo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Buscar produto</Label>
          <Input
            className="mt-1"
            placeholder="Nome ou código"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Comprar para:</span>
        {(["15", "30", "60"] as const).map((d) => (
          <Button
            key={d}
            size="sm"
            variant={horizonte === d ? "default" : "outline"}
            onClick={() => setHorizonte(d)}
          >
            {d} dias
          </Button>
        ))}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Produtos por classe"
          value={`A ${resumo.porClasse.A} · B ${resumo.porClasse.B} · C ${resumo.porClasse.C}`}
          hint="Classificados pelo faturamento do período"
          icon={Layers}
        />
        <StatCard
          label={`Itens a comprar (${horizonte} dias)`}
          value={String(resumo.aComprar)}
          hint="Produtos com saldo abaixo do necessário"
          icon={ShoppingCart}
          tone="warning"
        />
        <StatCard
          label="Investimento estimado"
          value={brl(resumo.investimento)}
          hint="Quantidade sugerida × custo de aquisição"
          icon={ShoppingCart}
          tone="accent"
        />
        <StatCard
          label="Cobertura insuficiente"
          value={String(resumo.emFalta)}
          hint={`Estoque atual dura menos de ${horizonte} dias`}
          icon={Gauge}
          tone="danger"
        />
      </div>

      {isLoading ? (
        <div className="panel h-72 animate-pulse" />
      ) : visiveis.length === 0 ? (
        <EmptyState
          title="Nenhum produto neste filtro."
          description="Amplie o período analisado ou troque a classe do giro para ver as sugestões de compra."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-center">Classe</TableHead>
                <TableHead className="text-right">Vendas no período</TableHead>
                <TableHead className="text-right">Média por dia</TableHead>
                <TableHead className="text-right">Disponível</TableHead>
                <TableHead className="text-right">Cobertura</TableHead>
                <TableHead className="text-right">15 dias</TableHead>
                <TableHead className="text-right">30 dias</TableHead>
                <TableHead className="text-right">60 dias</TableHead>
                <TableHead className="text-right">Custo ({horizonte} dias)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((l) => {
                const comprar = comprarDoHorizonte(l);
                const emCompra = (valor: number) => (
                  <span className={valor > 0 ? "font-semibold" : "text-muted-foreground"}>
                    {num(valor, 2)}
                  </span>
                );
                return (
                  <TableRow key={l.produto_id}>
                    <TableCell className="text-sm">
                      <span className="font-medium">{l.descricao}</span>
                      <span className="block text-xs text-muted-foreground">
                        {l.codigo || "sem código"} · {l.unidade}
                        {l.unidadeCompra && l.fator > 1 && (
                          <> · compra em {l.unidadeCompra} de {num(l.fator, 2)} {l.unidade}</>
                        )}
                        {" · "}
                        {num(l.participacao, 1)}% do faturamento
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={
                          l.classe === "A" ? "default" : l.classe === "B" ? "secondary" : "outline"
                        }
                      >
                        {l.classe}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-numeric">
                      {num(l.vendido, 2)} {l.unidade}
                      <span className="block text-xs text-muted-foreground">{brl(l.receita)}</span>
                    </TableCell>
                    <TableCell className="text-right text-numeric">{num(l.mediaDia, 2)}</TableCell>
                    <TableCell className="text-right text-numeric">{num(l.disponivel, 2)}</TableCell>
                    <TableCell className="text-right text-numeric">
                      {l.mediaDia <= 0 ? (
                        <span className="text-muted-foreground">sem giro</span>
                      ) : (
                        <span
                          className={
                            l.cobertura < Number(horizonte) ? "font-semibold text-destructive" : ""
                          }
                        >
                          {num(l.cobertura, 0)} dias
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-numeric">{emCompra(l.comprar15)}</TableCell>
                    <TableCell className="text-right text-numeric">{emCompra(l.comprar30)}</TableCell>
                    <TableCell className="text-right text-numeric">{emCompra(l.comprar60)}</TableCell>
                    <TableCell className="text-right text-numeric">{brl(comprar * l.custo)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Como o cálculo é feito: média de venda por dia no período escolhido, multiplicada pelos dias
        de cobertura desejados, com folga de 25% nos itens da classe A e 10% na classe B. Do total
        necessário é descontado o saldo disponível do depósito, e o estoque mínimo do produto é
        sempre respeitado. O custo usa o custo médio do depósito, quando existe.
      </p>
    </>
  );
}
