import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, num } from "@/lib/format";
import { sugerirCompra, type Sugestao } from "@/lib/sugestao-compra";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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

export const Route = createFileRoute("/_authenticated/sugestao-compra")({
  head: () => ({
    meta: [
      { title: "Sugestão de reposição — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Quanto comprar de cada produto pelas vendas, reservas, estoque mínimo/máximo e prazo do fornecedor, com revisão antes do pedido.",
      },
      { property: "og:title", content: "Sugestão de reposição — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Revise a sugestão de compra por fornecedor e aprove antes de criar o pedido.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SugestaoCompra,
});

type Linha = {
  produtoId: string;
  descricao: string;
  codigo: string;
  unidade: string;
  unidadeCompra: string | null;
  fator: number;
  custo: number;
  fornecedorId: string | null;
  s: Sugestao;
};

const SEM_FORNECEDOR = "sem";

function SugestaoCompra() {
  const [depositoId, setDepositoId] = useState("");
  const [janela, setJanela] = useState("60");
  const [cobertura, setCobertura] = useState("30");
  const [qtd, setQtd] = useState<Record<string, string>>({});
  const [marcado, setMarcado] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();
  const qc = useQueryClient();
  const dias = Number(janela);

  const { data: depositos = [] } = useQuery({
    queryKey: ["depositos-ativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("depositos")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
  const dep = depositoId || depositos[0]?.id || "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sugestao-compra", dep, janela],
    enabled: !!dep,
    queryFn: async () => {
      const desde = new Date(Date.now() - dias * 86400000).toISOString();
      const [prod, forn, vendas, est, compras] = await Promise.all([
        supabase
          .from("produtos")
          .select(
            "id, descricao, codigo_interno, unidade, unidade_compra, fator_conversao, custo, estoque_minimo, estoque_maximo, fornecedor_id",
          )
          .eq("ativo", true)
          .is("deleted_at", null)
          .order("descricao"),
        supabase.from("fornecedores").select("id, razao_social, prazo_entrega_dias"),
        supabase
          .from("pedido_itens")
          .select("produto_id, quantidade, pedidos!inner(created_at, situacao, deposito_id)")
          .gte("pedidos.created_at", desde)
          .neq("pedidos.situacao", "cancelado")
          .eq("pedidos.deposito_id", dep),
        supabase
          .from("estoques")
          .select("produto_id, quantidade, reservado")
          .eq("deposito_id", dep),
        supabase
          .from("compra_itens")
          .select(
            "produto_id, quantidade, quantidade_recebida, compras!inner(situacao, deposito_id)",
          )
          .eq("compras.deposito_id", dep)
          .not("compras.situacao", "in", "(recebido,cancelado)"),
      ]);
      for (const r of [prod, forn, vendas, est, compras]) if (r.error) throw r.error;
      return {
        produtos: prod.data ?? [],
        fornecedores: forn.data ?? [],
        vendas: vendas.data ?? [],
        estoques: est.data ?? [],
        compras: compras.data ?? [],
      };
    },
  });

  const fornecedores = useMemo(
    () => new Map((data?.fornecedores ?? []).map((f) => [f.id, f])),
    [data?.fornecedores],
  );

  const linhas = useMemo<Linha[]>(() => {
    if (!data) return [];
    const vendido = new Map<string, number>();
    for (const v of data.vendas)
      vendido.set(v.produto_id, (vendido.get(v.produto_id) ?? 0) + Number(v.quantidade));
    const saldo = new Map(data.estoques.map((e) => [e.produto_id, e]));
    const emCompra = new Map<string, number>();
    for (const c of data.compras)
      emCompra.set(
        c.produto_id,
        (emCompra.get(c.produto_id) ?? 0) +
          Math.max(Number(c.quantidade) - Number(c.quantidade_recebida ?? 0), 0),
      );
    return data.produtos
      .map((p) => {
        const e = saldo.get(p.id);
        const f = p.fornecedor_id ? fornecedores.get(p.fornecedor_id) : undefined;
        const s = sugerirCompra({
          vendidoNaJanela: vendido.get(p.id) ?? 0,
          diasJanela: dias,
          fisico: Number(e?.quantidade ?? 0),
          reservado: Number(e?.reservado ?? 0),
          emCompra: emCompra.get(p.id) ?? 0,
          minimo: Number(p.estoque_minimo ?? 0),
          maximo: Number(p.estoque_maximo ?? 0),
          prazoFornecedorDias: Number(f?.prazo_entrega_dias ?? 0),
          coberturaDias: Number(cobertura),
          fatorCompra: Number(p.fator_conversao ?? 1),
        });
        return {
          produtoId: p.id,
          descricao: p.descricao,
          codigo: p.codigo_interno ?? "",
          unidade: p.unidade ?? "",
          unidadeCompra: p.unidade_compra,
          fator: Number(p.fator_conversao ?? 1) || 1,
          custo: Number(p.custo ?? 0),
          fornecedorId: p.fornecedor_id,
          s,
        };
      })
      .filter((l) => l.s.quantidade > 0)
      .sort((a, b) => b.s.quantidade * b.custo - a.s.quantidade * a.custo);
  }, [data, fornecedores, dias, cobertura]);

  const grupos = useMemo(() => {
    const m = new Map<string, Linha[]>();
    for (const l of linhas) {
      const k = l.fornecedorId ?? SEM_FORNECEDOR;
      m.set(k, [...(m.get(k) ?? []), l]);
    }
    return [...m.entries()];
  }, [linhas]);

  const quantidadeDe = (l: Linha) => {
    const v = qtd[l.produtoId];
    return v === undefined ? l.s.quantidade : Number(v.replace(",", ".")) || 0;
  };
  const marcadoDe = (l: Linha) => marcado[l.produtoId] ?? true;

  const criar = useMutation({
    mutationFn: async ({ fornecedor, itens }: { fornecedor: string; itens: Linha[] }) => {
      const payload = itens
        .filter(marcadoDe)
        .map((l) => ({ produto_id: l.produtoId, quantidade: quantidadeDe(l) }))
        .filter((x) => x.quantidade > 0);
      if (payload.length === 0) throw new Error("Marque ao menos um produto com quantidade");
      const { data: id, error } = await supabase.rpc("compra_criar_de_sugestao", {
        p_deposito_id: dep,
        p_fornecedor_id: fornecedor === SEM_FORNECEDOR ? (null as never) : fornecedor,
        p_itens: payload as never,
      });
      if (error) throw error;
      return id as string;
    },
    onSuccess: (id) => {
      toast.success("Pedido de compra criado em rascunho para conferência");
      qc.invalidateQueries({ queryKey: ["compras"] });
      qc.invalidateQueries({ queryKey: ["sugestao-compra"] });
      navigate({ to: "/compras/$id", params: { id } });
    },
    onError: (e: Error) =>
      toast.error("Não foi possível criar a compra", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Sugestão de reposição"
        description="Calculada pelas vendas do período, disponível (físico − reservado), o que já está pedido, estoque mínimo/máximo e prazo do fornecedor. Nada é comprado sem a sua aprovação."
      />

      <div className="panel mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <Label>Depósito</Label>
          <Select value={dep} onValueChange={setDepositoId}>
            <SelectTrigger>
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              {depositos.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Vendas consideradas</Label>
          <Select value={janela} onValueChange={setJanela}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="60">Últimos 60 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Comprar para quantos dias de venda</Label>
          <Select value={cobertura} onValueChange={setCobertura}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">15 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="60">60 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-3">
          Método: média diária de venda do período × (prazo do fornecedor + dias escolhidos), no
          mínimo o estoque mínimo e no máximo o estoque máximo, descontando o disponível e o que já
          foi pedido. É uma estimativa pelas vendas passadas, não uma previsão garantida.
        </p>
      </div>

      {isLoading && <div className="panel h-64 animate-pulse" />}
      {isError && (
        <div className="panel p-6 text-sm text-destructive">
          Não foi possível calcular a sugestão. Verifique a conexão e tente de novo.
        </div>
      )}
      {!isLoading && !isError && dep && grupos.length === 0 && (
        <EmptyState
          title="Nada para repor"
          description="Com as vendas e o estoque deste depósito, nenhum produto precisa de compra agora."
        />
      )}

      <div className="space-y-4">
        {grupos.map(([fid, itens]) => {
          const f = fid === SEM_FORNECEDOR ? null : fornecedores.get(fid);
          const total = itens.filter(marcadoDe).reduce((s, l) => s + quantidadeDe(l) * l.custo, 0);
          return (
            <div key={fid} className="panel overflow-x-auto">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
                <div>
                  <p className="font-display font-semibold">
                    {f ? f.razao_social : "Produtos sem fornecedor definido"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {f?.prazo_entrega_dias
                      ? `Prazo de entrega: ${f.prazo_entrega_dias} dias`
                      : "Prazo de entrega não informado (considerado 0)"}{" "}
                    · Total estimado {brl(total)}
                  </p>
                </div>
                <Button
                  onClick={() => criar.mutate({ fornecedor: fid, itens })}
                  disabled={criar.isPending}
                >
                  <ShoppingCart className="mr-2 size-4" /> Aprovar e criar pedido de compra
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Disponível</TableHead>
                    <TableHead className="text-right">Média/dia</TableHead>
                    <TableHead className="w-32">Comprar</TableHead>
                    <TableHead>Por quê</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((l) => (
                    <TableRow key={l.produtoId}>
                      <TableCell>
                        <Checkbox
                          checked={marcadoDe(l)}
                          onCheckedChange={(v) =>
                            setMarcado((m) => ({ ...m, [l.produtoId]: v === true }))
                          }
                          aria-label={`Incluir ${l.descricao}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm">
                        {l.descricao}
                        <span className="block text-xs text-muted-foreground">{l.codigo}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        {num(l.s.disponivel, 3)} {l.unidade}
                      </TableCell>
                      <TableCell className="text-right">{num(l.s.mediaDia, 3)}</TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          value={qtd[l.produtoId] ?? String(l.s.quantidade)}
                          onChange={(e) => setQtd((q) => ({ ...q, [l.produtoId]: e.target.value }))}
                        />
                        <span className="text-xs text-muted-foreground">
                          {l.unidade}
                          {l.fator !== 1 && l.unidadeCompra
                            ? ` · ${num(quantidadeDe(l) / l.fator, 3)} ${l.unidadeCompra}`
                            : ""}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">
                        {l.s.fatores.join(" · ")}
                      </TableCell>
                      <TableCell className="text-right">{brl(quantidadeDe(l) * l.custo)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        })}
      </div>
    </>
  );
}
