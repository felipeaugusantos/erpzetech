import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Percent, Save, Search, Tag } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, num } from "@/lib/format";
import { PageHeader, StatCard, EmptyState } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/precos")({
  head: () => ({
    meta: [
      { title: "Preços e margens — Ze Obra" },
      {
        name: "description",
        content: "Atualize o custo de aquisição, o preço de venda e a margem de todos os produtos.",
      },
      { property: "og:title", content: "Preços e margens — Ze Obra" },
      { property: "og:description", content: "Edição em massa de custo, preço e margem." },
    ],
  }),
  component: Precos,
});

type Edicao = { custo: string; preco: string };

const margemPct = (custo: number, preco: number) => (preco > 0 ? ((preco - custo) / preco) * 100 : 0);

function Precos() {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [margemAlvo, setMargemAlvo] = useState("35");
  const [edicoes, setEdicoes] = useState<Record<string, Edicao>>({});

  const { data: produtos = [], isLoading } = useQuery({
    queryKey: ["precos-produtos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, codigo_interno, descricao, unidade, custo, preco_venda, ativo, categorias(nome)")
        .order("descricao");
      if (error) throw error;
      return data;
    },
  });

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return produtos;
    return produtos.filter((p) =>
      [p.descricao, p.codigo_interno].filter(Boolean).some((x) => String(x).toLowerCase().includes(t)),
    );
  }, [produtos, busca]);

  const valorDe = (id: string, campo: keyof Edicao, original: number) => {
    const e = edicoes[id];
    if (e && e[campo] !== undefined) return e[campo];
    return String(original);
  };

  const setValor = (id: string, campo: keyof Edicao, valor: string, p: { custo: number; preco: number }) => {
    setEdicoes((atual) => {
      const base = atual[id] ?? { custo: String(p.custo), preco: String(p.preco) };
      return { ...atual, [id]: { ...base, [campo]: valor } };
    });
  };

  const alterados = useMemo(
    () =>
      produtos.filter((p) => {
        const e = edicoes[p.id];
        if (!e) return false;
        return (
          Number(e.custo || 0) !== Number(p.custo) || Number(e.preco || 0) !== Number(p.preco_venda)
        );
      }),
    [produtos, edicoes],
  );

  const aplicarMargem = () => {
    const m = Number(margemAlvo || 0) / 100;
    if (m <= 0 || m >= 1) {
      toast.error("Informe uma margem entre 1% e 99%.");
      return;
    }
    const alvo = lista.length > 0 ? lista : produtos;
    setEdicoes((atual) => {
      const novo = { ...atual };
      for (const p of alvo) {
        const custo = Number(novo[p.id]?.custo ?? p.custo);
        if (custo <= 0) continue;
        novo[p.id] = { custo: String(custo), preco: (custo / (1 - m)).toFixed(2) };
      }
      return novo;
    });
    toast.success(`Preço sugerido com margem de ${margemAlvo}% em ${alvo.length} produtos.`);
  };

  const salvar = useMutation({
    mutationFn: async () => {
      if (alterados.length === 0) throw new Error("Nenhum preço alterado");
      for (const p of alterados) {
        const e = edicoes[p.id]!;
        const custo = Number(e.custo || 0);
        const preco = Number(e.preco || 0);
        if (custo < 0 || preco < 0) throw new Error(`Valor inválido em ${p.descricao}`);
        const { error } = await supabase
          .from("produtos")
          .update({ custo, preco_venda: preco })
          .eq("id", p.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Preços e custos atualizados.");
      setEdicoes({});
      void queryClient.invalidateQueries({ queryKey: ["precos-produtos"] });
      void queryClient.invalidateQueries({ queryKey: ["produtos"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const semPreco = produtos.filter((p) => Number(p.preco_venda) <= 0).length;
  const semCusto = produtos.filter((p) => Number(p.custo) <= 0).length;
  const margemMedia =
    produtos.length > 0
      ? produtos.reduce((s, p) => s + margemPct(Number(p.custo), Number(p.preco_venda)), 0) /
        produtos.length
      : 0;

  return (
    <div>
      <PageHeader
        title="Preços e margens"
        description="Coloque aqui o custo de aquisição e o preço de venda reais da sua loja. O custo alimenta o fluxo de caixa e a cotação de compras."
        actions={
          <Button onClick={() => salvar.mutate()} disabled={alterados.length === 0 || salvar.isPending}>
            <Save className="size-4" /> Salvar {alterados.length > 0 ? `(${alterados.length})` : ""}
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Produtos" value={String(produtos.length)} icon={Tag} />
        <StatCard label="Margem média" value={`${num(margemMedia, 1)}%`} icon={Percent} tone="accent" />
        <StatCard label="Sem custo informado" value={String(semCusto)} tone={semCusto > 0 ? "warning" : "default"} />
        <StatCard label="Sem preço de venda" value={String(semPreco)} tone={semPreco > 0 ? "danger" : "default"} />
      </div>

      <div className="panel mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="relative min-w-56 flex-1">
          <Label>Buscar produto</Label>
          <Search className="pointer-events-none absolute left-3 top-[2.15rem] size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Descrição ou código"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="w-32">
          <Label>Margem alvo (%)</Label>
          <Input value={margemAlvo} onChange={(e) => setMargemAlvo(e.target.value)} />
        </div>
        <Button variant="outline" onClick={aplicarMargem}>
          <Percent className="size-4" /> Sugerir preço pela margem
        </Button>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState title="Nenhum produto encontrado." description="Cadastre produtos para definir preços." />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="w-32 text-right">Custo</TableHead>
                <TableHead className="w-32 text-right">Preço de venda</TableHead>
                <TableHead className="text-right">Margem</TableHead>
                <TableHead className="text-right">Lucro por unidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((p) => {
                const custoOriginal = Number(p.custo);
                const precoOriginal = Number(p.preco_venda);
                const custo = Number(valorDe(p.id, "custo", custoOriginal) || 0);
                const preco = Number(valorDe(p.id, "preco", precoOriginal) || 0);
                const m = margemPct(custo, preco);
                const mudou = custo !== custoOriginal || preco !== precoOriginal;
                return (
                  <TableRow key={p.id} className={mudou ? "bg-accent/10" : undefined}>
                    <TableCell>
                      <p className="font-medium">{p.descricao}</p>
                      <p className="text-numeric text-xs text-muted-foreground">
                        {p.codigo_interno} · {p.unidade}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(p.categorias as unknown as { nome: string } | null)?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        className="w-28 text-right"
                        value={valorDe(p.id, "custo", custoOriginal)}
                        onChange={(e) =>
                          setValor(p.id, "custo", e.target.value, {
                            custo: custoOriginal,
                            preco: precoOriginal,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        className="w-28 text-right"
                        value={valorDe(p.id, "preco", precoOriginal)}
                        onChange={(e) =>
                          setValor(p.id, "preco", e.target.value, {
                            custo: custoOriginal,
                            preco: precoOriginal,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        className={
                          m <= 0
                            ? "bg-destructive/15 text-destructive"
                            : m < 15
                              ? "bg-warning/20 text-warning-foreground"
                              : "bg-success/15 text-success"
                        }
                      >
                        {num(m, 1)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-numeric text-right">{brl(preco - custo)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
