import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Ruler, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, formatConverted, num } from "@/lib/format";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/produtos")({
  head: () => ({
    meta: [
      { title: "Produtos — Enzova Build" },
      {
        name: "description",
        content: "Cadastro de produtos com unidades de compra e venda, custo, preço e margem.",
      },
      { property: "og:title", content: "Produtos — Enzova Build" },
      { property: "og:description", content: "Catálogo de materiais de construção da loja." },
    ],
  }),
  component: Produtos;
});

type Form = {
  id?: string;
  codigo_interno: string;
  codigo_barras: string;
  descricao: string;
  descricao_resumida: string;
  categoria_id: string;
  marca: string;
  fabricante: string;
  fornecedor_id: string;
  ncm: string;
  unidade: string;
  unidade_compra: string;
  unidade_venda: string;
  fator_conversao: string;
  custo: string;
  preco_venda: string;
  estoque_minimo: string;
  estoque_maximo: string;
  localizacao: string;
  peso: string;
  altura: string;
  largura: string;
  comprimento: string;
  ativo: boolean;
};

const vazio: Form = {
  codigo_interno: "",
  codigo_barras: "",
  descricao: "",
  descricao_resumida: "",
  categoria_id: "",
  marca: "",
  fabricante: "",
  fornecedor_id: "",
  ncm: "",
  unidade: "UN",
  unidade_compra: "",
  unidade_venda: "",
  fator_conversao: "1",
  custo: "0",
  preco_venda: "0",
  estoque_minimo: "0",
  estoque_maximo: "0",
  localizacao: "",
  peso: "",
  altura: "",
  largura: "",
  comprimento: "",
  ativo: true,
};

function Produtos() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const [busca, setBusca] = useState("");
  const [cat, setCat] = useState("todas");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const { data, isLoading } = useQuery({
    queryKey: ["produtos"],
    queryFn: async () => {
      const [prod, cats, forn, est] = await Promise.all([
        supabase.from("produtos").select("*, categorias(nome), fornecedores(nome_fantasia)").order("descricao"),
        supabase.from("categorias").select("id, nome").eq("ativo", true).order("nome"),
        supabase.from("fornecedores").select("id, nome_fantasia, razao_social").order("razao_social"),
        supabase.from("estoques").select("produto_id, quantidade, reservado"),
      ]);
      const saldo = new Map<string, { fisico: number; reservado: number }>();
      for (const e of est.data ?? []) {
        const s = saldo.get(e.produto_id) ?? { fisico: 0, reservado: 0 };
        s.fisico += Number(e.quantidade);
        s.reservado += Number(e.reservado);
        saldo.set(e.produto_id, s);
      }
      return { produtos: prod.data ?? [], categorias: cats.data ?? [], fornecedores: forn.data ?? [], saldo };
    },
  });

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data?.produtos ?? []).filter((p) => {
      if (cat !== "todas" && p.categoria_id !== cat) return false;
      if (!termo) return true;
      return [p.descricao, p.codigo_interno, p.codigo_barras, p.marca]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo));
    });
  }, [data, busca, cat]);

  const salvar = useMutation({
    mutationFn: async () => {
      const payload = {
        tenant_id: session?.profile?.tenant_id as string,
        codigo_interno: form.codigo_interno,
        codigo_barras: form.codigo_barras || null,
        descricao: form.descricao,
        descricao_resumida: form.descricao_resumida || null,
        categoria_id: form.categoria_id || null,
        marca: form.marca || null,
        fabricante: form.fabricante || null,
        fornecedor_id: form.fornecedor_id || null,
        ncm: form.ncm || null,
        unidade: form.unidade || "UN",
        unidade_compra: form.unidade_compra || null,
        unidade_venda: form.unidade_venda || null,
        fator_conversao: Number(form.fator_conversao || 1),
        custo: Number(form.custo || 0),
        preco_venda: Number(form.preco_venda || 0),
        estoque_minimo: Number(form.estoque_minimo || 0),
        estoque_maximo: Number(form.estoque_maximo || 0),
        localizacao: form.localizacao || null,
        peso: form.peso ? Number(form.peso) : null,
        altura: form.altura ? Number(form.altura) : null,
        largura: form.largura ? Number(form.largura) : null,
        comprimento: form.comprimento ? Number(form.comprimento) : null,
        ativo: form.ativo,
      };
      const { error } = form.id
        ? await supabase.from("produtos").update(payload).eq("id", form.id)
        : await supabase.from("produtos").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Produto salvo");
      setOpen(false);
      setForm(vazio);
      qc.invalidateQueries({ queryKey: ["produtos"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const margem = (custo: number, preco: number) =>
    preco > 0 ? ((preco - custo) / preco) * 100 : 0;

  const valorEstoque = (data?.produtos ?? []).reduce(
    (s, p) => s + (data?.saldo.get(p.id)?.fisico ?? 0) * Number(p.custo),
    0,
  );

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Cadastro completo com unidade de compra, unidade de venda e fator de conversão."
        actions={
          <Button
            onClick={() => {
              setForm(vazio);
              setOpen(true);
            }}
          >
            <Plus className="mr-2 size-4" /> Novo produto
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Produtos" value={num(data?.produtos.length ?? 0, 0)} />
        <StatCard label="Categorias" value={num(data?.categorias.length ?? 0, 0)} />
        <StatCard label="Com conversão de unidade" value={num((data?.produtos ?? []).filter((p) => Number(p.fator_conversao) > 1).length, 0)} icon={Ruler} tone="accent" />
        <StatCard label="Valor em estoque (custo)" value={brl(valorEstoque)} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Descrição, código, código de barras…"
            className="pl-8"
          />
        </div>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as categorias</SelectItem>
            {(data?.categorias ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="panel h-64 animate-pulse" />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhum produto encontrado."
            description="Cadastre produtos para controlar preço, margem e estoque."
            action={
              <Button
                onClick={() => {
                  setForm(vazio);
                  setOpen(true);
                }}
              >
                <Plus className="mr-2 size-4" /> Novo produto
              </Button>
            }
          />
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Unidades</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                  <TableHead>Estoque</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((p) => {
                  const s = data?.saldo.get(p.id);
                  const fisico = s?.fisico ?? 0;
                  const disponivel = fisico - (s?.reservado ?? 0);
                  const abaixo = disponivel < Number(p.estoque_minimo);
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <p className="font-medium">{p.descricao}</p>
                        <p className="text-numeric text-xs text-muted-foreground">
                          {p.codigo_interno} • {p.marca ?? "sem marca"}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {(p.categorias as unknown as { nome: string } | null)?.nome ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <p>
                          Estoque: <strong>{p.unidade}</strong>
                        </p>
                        {Number(p.fator_conversao) > 1 && p.unidade_compra && (
                          <p className="text-muted-foreground">
                            1 {p.unidade_compra} = {num(p.fator_conversao)} {p.unidade}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-numeric text-right">{brl(p.custo)}</TableCell>
                      <TableCell className="text-numeric text-right">{brl(p.preco_venda)}</TableCell>
                      <TableCell className="text-numeric text-right">
                        {num(margem(Number(p.custo), Number(p.preco_venda)), 1)}%
                      </TableCell>
                      <TableCell>
                        <p className="text-numeric text-sm">
                          {formatConverted(fisico, p.unidade, p.unidade_compra, Number(p.fator_conversao))}
                        </p>
                        <p className="text-numeric text-xs text-muted-foreground">
                          disponível {num(disponivel)} {p.unidade}
                        </p>
                        {abaixo && (
                          <Badge variant={disponivel <= 0 ? "destructive" : "secondary"} className="mt-1">
                            {disponivel <= 0 ? "Sem estoque" : "Abaixo do mínimo"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Editar"
                          onClick={() => {
                            setForm({
                              id: p.id,
                              codigo_interno: p.codigo_interno,
                              codigo_barras: p.codigo_barras ?? "",
                              descricao: p.descricao,
                              descricao_resumida: p.descricao_resumida ?? "",
                              categoria_id: p.categoria_id ?? "",
                              marca: p.marca ?? "",
                              fabricante: p.fabricante ?? "",
                              fornecedor_id: p.fornecedor_id ?? "",
                              ncm: p.ncm ?? "",
                              unidade: p.unidade,
                              unidade_compra: p.unidade_compra ?? "",
                              unidade_venda: p.unidade_venda ?? "",
                              fator_conversao: String(p.fator_conversao),
                              custo: String(p.custo),
                              preco_venda: String(p.preco_venda),
                              estoque_minimo: String(p.estoque_minimo),
                              estoque_maximo: String(p.estoque_maximo),
                              localizacao: p.localizacao ?? "",
                              peso: p.peso ? String(p.peso) : "",
                              altura: p.altura ? String(p.altura) : "",
                              largura: p.largura ? String(p.largura) : "",
                              comprimento: p.comprimento ? String(p.comprimento) : "",
                              ativo: p.ativo,
                            });
                            setOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar produto" : "Novo produto"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="p-cod">Código interno</Label>
                <Input
                  id="p-cod"
                  value={form.codigo_interno}
                  onChange={(e) => setForm({ ...form, codigo_interno: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-barras">Código de barras</Label>
                <Input
                  id="p-barras"
                  value={form.codigo_barras}
                  onChange={(e) => setForm({ ...form, codigo_barras: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-ncm">NCM</Label>
                <Input
                  id="p-ncm"
                  value={form.ncm}
                  onChange={(e) => setForm({ ...form, ncm: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="p-desc">Descrição</Label>
                <Input
                  id="p-desc"
                  value={form.descricao}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-resumo">Descrição resumida</Label>
                <Input
                  id="p-resumo"
                  value={form.descricao_resumida}
                  onChange={(e) => setForm({ ...form, descricao_resumida: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <Label>Categoria</Label>
                <Select
                  value={form.categoria_id}
                  onValueChange={(v) => setForm({ ...form, categoria_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {(data?.categorias ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fornecedor principal</Label>
                <Select
                  value={form.fornecedor_id}
                  onValueChange={(v) => setForm({ ...form, fornecedor_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {(data?.fornecedores ?? []).map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.nome_fantasia ?? f.razao_social}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="p-marca">Marca</Label>
                <Input
                  id="p-marca"
                  value={form.marca}
                  onChange={(e) => setForm({ ...form, marca: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-fab">Fabricante</Label>
                <Input
                  id="p-fab"
                  value={form.fabricante}
                  onChange={(e) => setForm({ ...form, fabricante: e.target.value })}
                />
              </div>
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="mb-1 text-sm font-semibold">Unidades e conversão</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Exemplo: compra em ROLO, estoque em M, fator 100 → 1 rolo = 100 metros.
              </p>
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <Label htmlFor="p-un">Unidade de estoque</Label>
                  <Input
                    id="p-un"
                    value={form.unidade}
                    onChange={(e) => setForm({ ...form, unidade: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <Label htmlFor="p-unc">Unidade de compra</Label>
                  <Input
                    id="p-unc"
                    value={form.unidade_compra}
                    onChange={(e) => setForm({ ...form, unidade_compra: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <Label htmlFor="p-unv">Unidade de venda</Label>
                  <Input
                    id="p-unv"
                    value={form.unidade_venda}
                    onChange={(e) => setForm({ ...form, unidade_venda: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <Label htmlFor="p-fator">Fator de conversão</Label>
                  <Input
                    id="p-fator"
                    type="number"
                    step="0.0001"
                    value={form.fator_conversao}
                    onChange={(e) => setForm({ ...form, fator_conversao: e.target.value })}
                  />
                </div>
              </div>
              {Number(form.fator_conversao) > 1 && form.unidade_compra && (
                <p className="mt-2 text-xs font-medium text-accent-foreground">
                  1 {form.unidade_compra} = {num(Number(form.fator_conversao))} {form.unidade}
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <Label htmlFor="p-custo">Custo</Label>
                <Input
                  id="p-custo"
                  type="number"
                  step="0.0001"
                  value={form.custo}
                  onChange={(e) => setForm({ ...form, custo: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-preco">Preço de venda</Label>
                <Input
                  id="p-preco"
                  type="number"
                  step="0.0001"
                  value={form.preco_venda}
                  onChange={(e) => setForm({ ...form, preco_venda: e.target.value })}
                />
              </div>
              <div>
                <Label>Margem calculada</Label>
                <Input
                  readOnly
                  value={`${num(margem(Number(form.custo || 0), Number(form.preco_venda || 0)), 1)}%`}
                />
              </div>
              <div>
                <Label htmlFor="p-loc">Localização no depósito</Label>
                <Input
                  id="p-loc"
                  value={form.localizacao}
                  onChange={(e) => setForm({ ...form, localizacao: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <Label htmlFor="p-min">Estoque mínimo</Label>
                <Input
                  id="p-min"
                  type="number"
                  step="0.001"
                  value={form.estoque_minimo}
                  onChange={(e) => setForm({ ...form, estoque_minimo: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-max">Estoque máximo</Label>
                <Input
                  id="p-max"
                  type="number"
                  step="0.001"
                  value={form.estoque_maximo}
                  onChange={(e) => setForm({ ...form, estoque_maximo: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-peso">Peso (kg)</Label>
                <Input
                  id="p-peso"
                  type="number"
                  step="0.001"
                  value={form.peso}
                  onChange={(e) => setForm({ ...form, peso: e.target.value })}
                />
              </div>
              <div className="flex items-end justify-between rounded-md border border-border px-3 py-2">
                <Label htmlFor="p-ativo">Ativo</Label>
                <Switch
                  id="p-ativo"
                  checked={form.ativo}
                  onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="p-alt">Altura (cm)</Label>
                <Input
                  id="p-alt"
                  type="number"
                  step="0.001"
                  value={form.altura}
                  onChange={(e) => setForm({ ...form, altura: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-lar">Largura (cm)</Label>
                <Input
                  id="p-lar"
                  type="number"
                  step="0.001"
                  value={form.largura}
                  onChange={(e) => setForm({ ...form, largura: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="p-com">Comprimento (cm)</Label>
                <Input
                  id="p-com"
                  type="number"
                  step="0.001"
                  value={form.comprimento}
                  onChange={(e) => setForm({ ...form, comprimento: e.target.value })}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => salvar.mutate()}
              disabled={!form.descricao.trim() || !form.codigo_interno.trim() || salvar.isPending}
            >
              Salvar produto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
