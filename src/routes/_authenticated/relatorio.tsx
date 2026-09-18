import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Coins,
  HandCoins,
  LineChart as LineChartIcon,
  Percent,
  Printer,
  Save,
  Target,
  Users,
} from "lucide-react";
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
import { brl, num } from "@/lib/format";
import { PageHeader, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/relatorio")({
  head: () => ({
    meta: [
      { title: "Relatório do sócio — Ze Obra" },
      {
        name: "description",
        content:
          "Resumo executivo da operação e o modelo de negócio do Ze Obra com os valores reais.",
      },
      { property: "og:title", content: "Relatório do sócio — Ze Obra" },
      { property: "og:description", content: "Resumo executivo e modelo de negócio do Ze Obra." },
    ],
  }),
  component: Relatorio,
});

type Modelo = {
  preco_mensal_loja: number;
  preco_filial_extra: number;
  preco_implantacao: number;
  meta_clientes_ano1: number;
  meta_clientes_ano2: number;
  custo_infra_mensal: number;
  custo_equipe_mensal: number;
  custo_marketing_mensal: number;
  investimento_realizado: number;
  observacoes: string | null;
};

const modeloVazio: Modelo = {
  preco_mensal_loja: 0,
  preco_filial_extra: 0,
  preco_implantacao: 0,
  meta_clientes_ano1: 0,
  meta_clientes_ano2: 0,
  custo_infra_mensal: 0,
  custo_equipe_mensal: 0,
  custo_marketing_mensal: 0,
  investimento_realizado: 0,
  observacoes: "",
};

function Relatorio() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Modelo>(modeloVazio);

  const { data: modelo } = useQuery({
    queryKey: ["modelo-negocio"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_negocio")
        .select(
          "preco_mensal_loja, preco_filial_extra, preco_implantacao, meta_clientes_ano1, meta_clientes_ano2, custo_infra_mensal, custo_equipe_mensal, custo_marketing_mensal, investimento_realizado, observacoes",
        )
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Modelo | null;
    },
  });

  useEffect(() => {
    if (modelo) setForm({ ...modelo, observacoes: modelo.observacoes ?? "" });
  }, [modelo]);

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("modelo_negocio")
        .upsert({ ...form, observacoes: form.observacoes || null }, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Modelo de negócio salvo");
      qc.invalidateQueries({ queryKey: ["modelo-negocio"] });
    },
    onError: (e: Error) =>
      toast.error("Não foi possível salvar", { description: e.message }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["relatorio-socio"],
    queryFn: async () => {
      const [pedidos, itens, orcamentos, estoques, clientes, obras, receber, pagar, produtos] =
        await Promise.all([
          supabase.from("pedidos").select("id, total, situacao, created_at"),
          supabase.from("pedido_itens").select("quantidade, preco_unitario, custo_unitario, total"),
          supabase.from("orcamentos").select("id, situacao, total").is("deleted_at", null),
          supabase.from("estoques").select("quantidade, custo_medio, produto_id"),
          supabase.from("clientes").select("id, ativo"),
          supabase.from("obras").select("id, situacao"),
          supabase.from("contas_receber").select("valor, valor_recebido, situacao"),
          supabase.from("contas_pagar").select("valor, valor_pago, situacao"),
          supabase.from("produtos").select("id, preco_venda", { count: "exact", head: false }),
        ]);
      return {
        pedidos: pedidos.data ?? [],
        itens: itens.data ?? [],
        orcamentos: orcamentos.data ?? [],
        estoques: estoques.data ?? [],
        clientes: clientes.data ?? [],
        obras: obras.data ?? [],
        receber: receber.data ?? [],
        pagar: pagar.data ?? [],
        produtos: produtos.data ?? [],
      };
    },
  });

  const op = useMemo(() => {
    const pedidos = data?.pedidos ?? [];
    const itens = data?.itens ?? [];
    const faturamento = pedidos
      .filter((p) => p.situacao !== "cancelado")
      .reduce((s, p) => s + Number(p.total), 0);
    const custoVendido = itens.reduce(
      (s, i) => s + Number(i.quantidade) * Number(i.custo_unitario),
      0,
    );
    const receitaItens = itens.reduce((s, i) => s + Number(i.total), 0);
    const lucroBruto = receitaItens - custoVendido;
    const margem = receitaItens > 0 ? (lucroBruto / receitaItens) * 100 : 0;
    const orc = data?.orcamentos ?? [];
    const aprovados = orc.filter((o) => o.situacao === "aprovado").length;
    const conversao = orc.length > 0 ? (aprovados / orc.length) * 100 : 0;
    const estoqueCusto = (data?.estoques ?? []).reduce(
      (s, e) => s + Number(e.quantidade) * Number(e.custo_medio),
      0,
    );
    const aReceber = (data?.receber ?? [])
      .filter((c) => c.situacao === "aberto" || c.situacao === "parcial")
      .reduce((s, c) => s + Number(c.valor) - Number(c.valor_recebido), 0);
    const aPagar = (data?.pagar ?? [])
      .filter((c) => c.situacao === "aberto" || c.situacao === "parcial")
      .reduce((s, c) => s + Number(c.valor) - Number(c.valor_pago), 0);
    return {
      faturamento,
      lucroBruto,
      margem,
      conversao,
      orcamentos: orc.length,
      pedidos: pedidos.length,
      estoqueCusto,
      aReceber,
      aPagar,
      clientes: (data?.clientes ?? []).length,
      obras: (data?.obras ?? []).length,
      produtos: (data?.produtos ?? []).length,
    };
  }, [data]);

  const custoMensal =
    Number(form.custo_infra_mensal) +
    Number(form.custo_equipe_mensal) +
    Number(form.custo_marketing_mensal);

  const projecao = useMemo(() => {
    const preco = Number(form.preco_mensal_loja);
    const anos = [
      { nome: "Ano 1", clientes: Number(form.meta_clientes_ano1) },
      { nome: "Ano 2", clientes: Number(form.meta_clientes_ano2) },
    ];
    return anos.map((a) => {
      const receita = a.clientes * preco * 12 + a.clientes * Number(form.preco_implantacao);
      const custo = custoMensal * 12;
      return { nome: a.nome, receita: Math.round(receita), custo: Math.round(custo), resultado: Math.round(receita - custo) };
    });
  }, [form, custoMensal]);

  const mrrAno1 = Number(form.meta_clientes_ano1) * Number(form.preco_mensal_loja);
  const mrrAno2 = Number(form.meta_clientes_ano2) * Number(form.preco_mensal_loja);
  const clientesEquilibrio =
    Number(form.preco_mensal_loja) > 0 ? Math.ceil(custoMensal / Number(form.preco_mensal_loja)) : 0;
  const mesesRetorno =
    mrrAno1 - custoMensal > 0
      ? Math.ceil(Number(form.investimento_realizado) / (mrrAno1 - custoMensal))
      : 0;

  const campo = (
    label: string,
    chave: keyof Modelo,
    dica?: string,
  ) => (
    <div>
      <Label>{label}</Label>
      <Input
        inputMode="decimal"
        value={String(form[chave] ?? "")}
        onChange={(e) =>
          setForm((f) => ({ ...f, [chave]: Number(e.target.value.replace(",", ".")) || 0 }))
        }
      />
      {dica && <p className="mt-1 text-xs text-muted-foreground">{dica}</p>}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Relatório do sócio"
        description="Resumo executivo da operação e o modelo de negócio com os valores que você informar."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-2 size-4" />
              Imprimir / PDF
            </Button>
            <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              <Save className="mr-2 size-4" />
              Salvar modelo
            </Button>
          </div>
        }
      />

      <h2 className="mb-3 font-display text-lg font-semibold">O que o sistema já entrega</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Faturamento em pedidos"
          value={isLoading ? "—" : brl(op.faturamento)}
          icon={Coins}
          tone="accent"
          hint={`${num(op.pedidos, 0)} pedidos registrados`}
        />
        <StatCard
          label="Lucro bruto dos pedidos"
          value={isLoading ? "—" : brl(op.lucroBruto)}
          icon={HandCoins}
          tone="success"
          hint={`Margem de ${num(op.margem, 1)}% sobre o custo do depósito`}
        />
        <StatCard
          label="Conversão de orçamentos"
          value={`${num(op.conversao, 1)}%`}
          icon={Percent}
          hint={`${num(op.orcamentos, 0)} orçamentos emitidos`}
        />
        <StatCard
          label="Estoque a custo"
          value={isLoading ? "—" : brl(op.estoqueCusto)}
          icon={Boxes}
          hint={`${num(op.produtos, 0)} produtos cadastrados`}
        />
        <StatCard label="A receber em aberto" value={brl(op.aReceber)} icon={LineChartIcon} />
        <StatCard label="A pagar em aberto" value={brl(op.aPagar)} icon={LineChartIcon} tone="warning" />
        <StatCard label="Clientes" value={num(op.clientes, 0)} icon={Users} />
        <StatCard label="Obras acompanhadas" value={num(op.obras, 0)} icon={Target} />
      </div>

      <div className="panel mt-6 p-4">
        <h2 className="font-display text-lg font-semibold">Modelo de negócio</h2>
        <p className="text-sm text-muted-foreground">
          Preencha com os seus valores reais. Tudo abaixo é calculado a partir deles — nada é
          estimado por mim.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {campo("Mensalidade por loja (R$)", "preco_mensal_loja")}
          {campo("Mensalidade por filial extra (R$)", "preco_filial_extra")}
          {campo("Implantação / setup (R$)", "preco_implantacao", "Cobrança única na entrada")}
          {campo("Meta de clientes — ano 1", "meta_clientes_ano1")}
          {campo("Meta de clientes — ano 2", "meta_clientes_ano2")}
          {campo("Investimento já feito (R$)", "investimento_realizado")}
          {campo("Infraestrutura por mês (R$)", "custo_infra_mensal")}
          {campo("Equipe por mês (R$)", "custo_equipe_mensal")}
          {campo("Marketing por mês (R$)", "custo_marketing_mensal")}
        </div>
        <div className="mt-4">
          <Label>Observações para o sócio</Label>
          <Textarea
            rows={3}
            value={form.observacoes ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
            placeholder="Premissas, riscos, próximos passos…"
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Receita recorrente — ano 1" value={brl(mrrAno1)} hint="por mês" icon={Coins} />
        <StatCard label="Receita recorrente — ano 2" value={brl(mrrAno2)} hint="por mês" icon={Coins} tone="accent" />
        <StatCard
          label="Custo mensal do negócio"
          value={brl(custoMensal)}
          hint="Infra + equipe + marketing"
          icon={HandCoins}
          tone="warning"
        />
        <StatCard
          label="Clientes para o equilíbrio"
          value={num(clientesEquilibrio, 0)}
          hint={
            mesesRetorno > 0
              ? `Investimento retorna em ~${num(mesesRetorno, 0)} meses`
              : "Informe preço e custos para calcular"
          }
          icon={Target}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <h2 className="mb-3 font-display text-sm font-semibold">Receita x custo por ano</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projecao}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => brl(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="receita" name="Receita" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="custo" name="Custo" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="mb-3 font-display text-sm font-semibold">Projeção</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Clientes</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projecao.map((l, i) => (
                <TableRow key={l.nome}>
                  <TableCell>{l.nome}</TableCell>
                  <TableCell className="text-numeric text-right">
                    {num(i === 0 ? form.meta_clientes_ano1 : form.meta_clientes_ano2, 0)}
                  </TableCell>
                  <TableCell className="text-numeric text-right">{brl(l.receita)}</TableCell>
                  <TableCell className="text-numeric text-right">{brl(l.custo)}</TableCell>
                  <TableCell
                    className={`text-numeric text-right font-semibold ${
                      l.resultado >= 0 ? "text-success" : "text-destructive"
                    }`}
                  >
                    {brl(l.resultado)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {form.observacoes && (
            <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">
              {form.observacoes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
