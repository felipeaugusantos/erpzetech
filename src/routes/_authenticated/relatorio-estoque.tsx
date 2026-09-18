import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Coins,
  Gauge,
  Search,
  Warehouse,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, num } from "@/lib/format";
import { usePeriodo } from "@/lib/periodo";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/relatorio-estoque")({
  head: () => ({
    meta: [
      { title: "Relatório de estoque por depósito — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Entradas, saídas, transferências e saldo valorizado de cada depósito no período, ligado ao giro de compra.",
      },
      { property: "og:title", content: "Relatório de estoque por depósito — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Entradas, saídas e saldo por depósito e por produto, com as transferências do período.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RelatorioEstoque,
});

const tiposEntrada = ["entrada", "transferencia_entrada", "inventario"];
const tiposSaida = ["saida", "transferencia_saida"];

type Acumulado = {
  entQtd: number;
  entValor: number;
  saiQtd: number;
  saiValor: number;
  transfEntQtd: number;
  transfSaiQtd: number;
  ajusteQtd: number;
  movimentos: number;
};

const vazio = (): Acumulado => ({
  entQtd: 0,
  entValor: 0,
  saiQtd: 0,
  saiValor: 0,
  transfEntQtd: 0,
  transfSaiQtd: 0,
  ajusteQtd: 0,
  movimentos: 0,
});

function RelatorioEstoque() {
  const { periodo, setDe, setAte } = usePeriodo();
  const [depositoId, setDepositoId] = useState("todos");
  const [busca, setBusca] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["relatorio-estoque", periodo.de, periodo.ate],
    queryFn: async () => {
      const [depRes, movRes, estRes, transfRes] = await Promise.all([
        supabase.from("depositos").select("id, nome, filiais(nome)").order("nome"),
        supabase
          .from("estoque_movimentacoes")
          .select(
            "id, tipo, deposito_id, produto_id, quantidade, custo_unitario, valor_total, created_at, produtos(descricao, codigo_interno, unidade)",
          )
          .gte("created_at", `${periodo.de}T00:00:00`)
          .lte("created_at", `${periodo.ate}T23:59:59`)
          .order("created_at", { ascending: false })
          .limit(3000),
        supabase
          .from("estoques")
          .select("deposito_id, produto_id, quantidade, reservado, custo_medio, produtos(custo)"),
        supabase
          .from("transferencias")
          .select(
            "id, numero, situacao, created_at, valor_total, origem:depositos!transferencias_deposito_origem_id_fkey(nome), destino:depositos!transferencias_deposito_destino_id_fkey(nome)",
          )
          .gte("created_at", `${periodo.de}T00:00:00`)
          .lte("created_at", `${periodo.ate}T23:59:59`)
          .order("created_at", { ascending: false }),
      ]);
      if (depRes.error) throw depRes.error;
      if (movRes.error) throw movRes.error;
      if (estRes.error) throw estRes.error;
      return {
        depositos: depRes.data ?? [],
        movs: movRes.data ?? [],
        estoques: estRes.data ?? [],
        transferencias: transfRes.error ? [] : (transfRes.data ?? []),
      };
    },
  });

  const depositos = data?.depositos ?? [];

  /** Custo de referência: custo médio do depósito, ou o custo do cadastro. */
  const custoRef = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const e of data?.estoques ?? []) {
      const p = e.produtos as { custo: number | null } | null;
      const custo = Number(e.custo_medio) > 0 ? Number(e.custo_medio) : Number(p?.custo ?? 0);
      mapa.set(`${e.deposito_id}|${e.produto_id}`, custo);
    }
    return mapa;
  }, [data?.estoques]);

  const movsFiltradas = useMemo(
    () =>
      (data?.movs ?? []).filter((m) => depositoId === "todos" || m.deposito_id === depositoId),
    [data?.movs, depositoId],
  );

  function somar(alvo: Acumulado, m: (typeof movsFiltradas)[number]) {
    const qtd = Math.abs(Number(m.quantidade));
    const custo =
      Number(m.custo_unitario) > 0
        ? Number(m.custo_unitario)
        : (custoRef.get(`${m.deposito_id}|${m.produto_id}`) ?? 0);
    const valor = Number(m.valor_total) > 0 ? Number(m.valor_total) : qtd * custo;
    alvo.movimentos += 1;
    if (tiposEntrada.includes(m.tipo)) {
      alvo.entQtd += qtd;
      alvo.entValor += valor;
      if (m.tipo === "transferencia_entrada") alvo.transfEntQtd += qtd;
      if (m.tipo === "inventario") alvo.ajusteQtd += qtd;
    } else if (tiposSaida.includes(m.tipo)) {
      alvo.saiQtd += qtd;
      alvo.saiValor += valor;
      if (m.tipo === "transferencia_saida") alvo.transfSaiQtd += qtd;
    } else if (m.tipo === "ajuste") {
      alvo.ajusteQtd += qtd;
    }
  }

  /** Saldo valorizado atual de cada depósito. */
  const saldoPorDeposito = useMemo(() => {
    const mapa = new Map<string, { qtd: number; valor: number; itens: number }>();
    for (const e of data?.estoques ?? []) {
      const p = e.produtos as { custo: number | null } | null;
      const custo = Number(e.custo_medio) > 0 ? Number(e.custo_medio) : Number(p?.custo ?? 0);
      const atual = mapa.get(e.deposito_id) ?? { qtd: 0, valor: 0, itens: 0 };
      atual.qtd += Number(e.quantidade);
      atual.valor += Number(e.quantidade) * custo;
      if (Number(e.quantidade) !== 0) atual.itens += 1;
      mapa.set(e.deposito_id, atual);
    }
    return mapa;
  }, [data?.estoques]);

  const porDeposito = useMemo(() => {
    const mapa = new Map<string, Acumulado>();
    for (const m of movsFiltradas) {
      const chave = m.deposito_id;
      const atual = mapa.get(chave) ?? vazio();
      somar(atual, m);
      mapa.set(chave, atual);
    }
    return depositos
      .filter((d) => depositoId === "todos" || d.id === depositoId)
      .map((d) => {
        const saldo = saldoPorDeposito.get(d.id) ?? { qtd: 0, valor: 0, itens: 0 };
        return {
          id: d.id,
          nome: d.nome,
          loja: (d.filiais as { nome: string } | null)?.nome ?? "—",
          acc: mapa.get(d.id) ?? vazio(),
          saldo,
        };
      })
      .sort((a, b) => b.saldo.valor - a.saldo.valor);
  }, [movsFiltradas, depositos, depositoId, saldoPorDeposito, custoRef]);

  const porProduto = useMemo(() => {
    type Item = Acumulado & { descricao: string; codigo: string; unidade: string; produto_id: string };
    const mapa = new Map<string, Item>();
    for (const m of movsFiltradas) {
      const p = m.produtos as { descricao: string; codigo_interno: string; unidade: string } | null;
      if (!p) continue;
      const atual =
        mapa.get(m.produto_id) ??
        ({
          ...vazio(),
          descricao: p.descricao,
          codigo: p.codigo_interno,
          unidade: p.unidade,
          produto_id: m.produto_id,
        } as Item);
      somar(atual, m);
      mapa.set(m.produto_id, atual);
    }
    const saldoProd = new Map<string, number>();
    for (const e of data?.estoques ?? []) {
      if (depositoId !== "todos" && e.deposito_id !== depositoId) continue;
      saldoProd.set(e.produto_id, (saldoProd.get(e.produto_id) ?? 0) + Number(e.quantidade));
    }
    const termo = busca.trim().toLowerCase();
    return [...mapa.values()]
      .map((i) => ({ ...i, saldo: saldoProd.get(i.produto_id) ?? 0 }))
      .filter(
        (i) =>
          !termo ||
          `${i.descricao} ${i.codigo}`.toLowerCase().includes(termo),
      )
      .sort((a, b) => b.saiValor - a.saiValor);
  }, [movsFiltradas, data?.estoques, depositoId, busca, custoRef]);

  const totais = useMemo(() => {
    const acc = vazio();
    for (const m of movsFiltradas) somar(acc, m);
    let saldoValor = 0;
    for (const d of porDeposito) saldoValor += d.saldo.valor;
    return { acc, saldoValor };
  }, [movsFiltradas, porDeposito, custoRef]);

  const transferencias = useMemo(() => data?.transferencias ?? [], [data?.transferencias]);

  return (
    <div>
      <PageHeader
        title="Relatório de estoque por depósito"
        description="Entradas, saídas, transferências e saldo valorizado de cada depósito no período escolhido."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/giro-estoque">
                <Gauge className="size-4" /> Giro e sugestão de compra
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/transferencias">
                <ArrowLeftRight className="size-4" /> Transferências
              </Link>
            </Button>
          </div>
        }
      />

      <div className="panel mb-5 flex flex-wrap items-end gap-3 p-4">
        <div>
          <Label>De</Label>
          <Input type="date" value={periodo.de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <Label>Até</Label>
          <Input type="date" value={periodo.ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <div className="min-w-52">
          <Label>Depósito</Label>
          <Select value={depositoId} onValueChange={setDepositoId}>
            <SelectTrigger>
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
        <div className="relative min-w-56 flex-1">
          <Label>Produto</Label>
          <Search className="pointer-events-none absolute bottom-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar produto ou código"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Entradas no período"
          value={brl(totais.acc.entValor)}
          hint={`${num(totais.acc.entQtd)} em quantidade`}
          tone="success"
          icon={ArrowDownCircle}
        />
        <StatCard
          label="Saídas no período"
          value={brl(totais.acc.saiValor)}
          hint={`${num(totais.acc.saiQtd)} em quantidade`}
          tone="warning"
          icon={ArrowUpCircle}
        />
        <StatCard
          label="Saldo em estoque"
          value={brl(totais.saldoValor)}
          hint="Custo de aquisição atual"
          icon={Coins}
        />
        <StatCard
          label="Transferências"
          value={`${num(totais.acc.transfEntQtd + totais.acc.transfSaiQtd)}`}
          hint={`${transferencias.length} transferência(s) no período`}
          icon={ArrowLeftRight}
        />
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <Tabs defaultValue="depositos">
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="depositos">Por depósito</TabsTrigger>
            <TabsTrigger value="produtos">Por produto</TabsTrigger>
            <TabsTrigger value="transferencias">Transferências</TabsTrigger>
          </TabsList>

          <TabsContent value="depositos">
            {porDeposito.length === 0 ? (
              <EmptyState
                title="Nenhum depósito cadastrado."
                description="Cadastre um depósito para acompanhar entradas, saídas e saldo."
              />
            ) : (
              <div className="panel overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Depósito</TableHead>
                      <TableHead>Loja</TableHead>
                      <TableHead className="text-right">Entradas (qtd)</TableHead>
                      <TableHead className="text-right">Entradas (R$)</TableHead>
                      <TableHead className="text-right">Saídas (qtd)</TableHead>
                      <TableHead className="text-right">Saídas (R$)</TableHead>
                      <TableHead className="text-right">Transf. entrada</TableHead>
                      <TableHead className="text-right">Transf. saída</TableHead>
                      <TableHead className="text-right">Itens com saldo</TableHead>
                      <TableHead className="text-right">Saldo (R$)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {porDeposito.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">
                          <Link to="/depositos/$id" params={{ id: d.id }} className="hover:underline">
                            {d.nome}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{d.loja}</TableCell>
                        <TableCell className="text-right text-numeric">{num(d.acc.entQtd)}</TableCell>
                        <TableCell className="text-right text-numeric text-success-foreground">
                          {brl(d.acc.entValor)}
                        </TableCell>
                        <TableCell className="text-right text-numeric">{num(d.acc.saiQtd)}</TableCell>
                        <TableCell className="text-right text-numeric">{brl(d.acc.saiValor)}</TableCell>
                        <TableCell className="text-right text-numeric">
                          {num(d.acc.transfEntQtd)}
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {num(d.acc.transfSaiQtd)}
                        </TableCell>
                        <TableCell className="text-right text-numeric">{d.saldo.itens}</TableCell>
                        <TableCell className="text-right text-numeric font-medium">
                          {brl(d.saldo.valor)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="produtos">
            {porProduto.length === 0 ? (
              <EmptyState
                title="Sem movimentação no período."
                description="Escolha outro período ou registre entradas e saídas de estoque."
              />
            ) : (
              <div className="panel overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead className="text-right">Entradas</TableHead>
                      <TableHead className="text-right">Entradas (R$)</TableHead>
                      <TableHead className="text-right">Saídas</TableHead>
                      <TableHead className="text-right">Saídas (R$)</TableHead>
                      <TableHead className="text-right">Transferências</TableHead>
                      <TableHead className="text-right">Ajustes</TableHead>
                      <TableHead className="text-right">Saldo atual</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {porProduto.map((i) => (
                      <TableRow key={i.produto_id}>
                        <TableCell className="font-medium">{i.descricao}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{i.codigo}</TableCell>
                        <TableCell className="text-right text-numeric">
                          {num(i.entQtd)} {i.unidade}
                        </TableCell>
                        <TableCell className="text-right text-numeric text-success-foreground">
                          {brl(i.entValor)}
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {num(i.saiQtd)} {i.unidade}
                        </TableCell>
                        <TableCell className="text-right text-numeric">{brl(i.saiValor)}</TableCell>
                        <TableCell className="text-right text-numeric">
                          {num(i.transfEntQtd + i.transfSaiQtd)}
                        </TableCell>
                        <TableCell className="text-right text-numeric">{num(i.ajusteQtd)}</TableCell>
                        <TableCell className="text-right text-numeric font-medium">
                          {num(i.saldo)} {i.unidade}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="transferencias">
            {transferencias.length === 0 ? (
              <EmptyState
                title="Nenhuma transferência no período."
                description="As transferências entre lojas aparecem aqui com origem, destino e valor."
                action={
                  <Button asChild>
                    <Link to="/transferencias">
                      <ArrowLeftRight className="size-4" /> Abrir transferências
                    </Link>
                  </Button>
                }
              />
            ) : (
              <div className="panel overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nº</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Origem</TableHead>
                      <TableHead>Destino</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transferencias.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-numeric">{t.numero}</TableCell>
                        <TableCell className="text-sm">{dateBR(String(t.created_at).slice(0, 10))}</TableCell>
                        <TableCell className="text-sm">
                          {(t.origem as { nome: string } | null)?.nome ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {(t.destino as { nome: string } | null)?.nome ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{String(t.situacao).replace("_", " ")}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {brl(Number(t.valor_total ?? 0))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Warehouse className="size-3.5" /> O valor usa o custo de aquisição do depósito; movimentos
        antigos sem custo gravado usam o custo atual do produto.
      </p>
    </div>
  );
}
