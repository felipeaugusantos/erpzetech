import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { precoNaTabela, rotuloAjuste } from "@/lib/tabela-preco";

export const Route = createFileRoute("/_authenticated/tabelas-preco")({
  head: () => ({
    meta: [
      { title: "Tabelas de preço — ERP Ze Tech" },
      {
        name: "description",
        content: "Preços diferentes por cliente: ajuste percentual e preço fixo por produto.",
      },
      { property: "og:title", content: "Tabelas de preço — ERP Ze Tech" },
      { property: "og:description", content: "Preços diferentes por cliente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TabelasPreco,
});

type Tabela = {
  id: string;
  nome: string;
  descricao: string | null;
  ajuste_percentual: number;
  ativa: boolean;
};

type Form = { id: string | null; nome: string; descricao: string; ajuste: string; ativa: boolean };
const FORM_VAZIO: Form = { id: null, nome: "", descricao: "", ajuste: "0", ativa: true };

const paraNumero = (v: string) => Number(v.replace(",", "."));

function TabelasPreco() {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const gestao = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  const [form, setForm] = useState<Form | null>(null);
  const [precosDe, setPrecosDe] = useState<Tabela | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["tabelas-preco"],
    queryFn: async () => {
      const [tabelas, itens, clientes] = await Promise.all([
        supabase.from("tabelas_preco").select("*").order("nome"),
        supabase.from("tabela_preco_itens").select("tabela_id"),
        supabase.from("clientes").select("tabela_preco_id").not("tabela_preco_id", "is", null),
      ]);
      if (tabelas.error) throw tabelas.error;
      const contar = (ids: (string | null)[]) => {
        const m = new Map<string, number>();
        for (const id of ids) if (id) m.set(id, (m.get(id) ?? 0) + 1);
        return m;
      };
      return {
        tabelas: tabelas.data as Tabela[],
        fixos: contar((itens.data ?? []).map((i) => i.tabela_id)),
        clientes: contar((clientes.data ?? []).map((c) => c.tabela_preco_id)),
      };
    },
  });

  const salvar = useMutation({
    mutationFn: async (f: Form) => {
      const ajuste = paraNumero(f.ajuste || "0");
      if (!f.nome.trim()) throw new Error("Informe o nome da tabela");
      if (!Number.isFinite(ajuste) || ajuste < -100 || ajuste > 1000)
        throw new Error("O ajuste fica entre -100% (de graça) e 1000%");
      const dados = {
        nome: f.nome.trim(),
        descricao: f.descricao.trim() || null,
        ajuste_percentual: ajuste,
        ativa: f.ativa,
      };
      const { error } = f.id
        ? await supabase.from("tabelas_preco").update(dados).eq("id", f.id)
        : await supabase.from("tabelas_preco").insert(dados);
      if (error)
        throw new Error(
          error.code === "23505" ? "Já existe uma tabela com esse nome" : error.message,
        );
    },
    onSuccess: () => {
      toast.success("Tabela salva");
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["tabelas-preco"] });
      void qc.invalidateQueries({ queryKey: ["tabelas-preco-ativas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (t: Tabela) => {
      const { error } = await supabase.from("tabelas_preco").delete().eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tabela excluída");
      void qc.invalidateQueries({ queryKey: ["tabelas-preco"] });
      void qc.invalidateQueries({ queryKey: ["tabelas-preco-ativas"] });
      void qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lista = data?.tabelas ?? [];

  return (
    <>
      <PageHeader
        title="Tabelas de preço"
        description="Preços diferentes por cliente. Escolha a tabela no cadastro do cliente e o orçamento e o pedido já usam o preço dela."
        actions={
          gestao ? (
            <Button onClick={() => setForm(FORM_VAZIO)}>
              <Plus className="mr-1 h-4 w-4" /> Nova tabela
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma tabela de preço"
          description="Crie uma tabela (ex.: Atacado, com 10% de desconto) e ligue-a aos clientes."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tabela</TableHead>
                <TableHead>Ajuste</TableHead>
                <TableHead className="text-right">Preços fixos</TableHead>
                <TableHead className="text-right">Clientes</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium">{t.nome}</div>
                    {t.descricao ? (
                      <div className="text-xs text-muted-foreground">{t.descricao}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{rotuloAjuste(Number(t.ajuste_percentual))}</TableCell>
                  <TableCell className="text-right">{data?.fixos.get(t.id) ?? 0}</TableCell>
                  <TableCell className="text-right">{data?.clientes.get(t.id) ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={t.ativa ? "secondary" : "outline"}>
                      {t.ativa ? "Ativa" : "Inativa"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button size="sm" variant="outline" onClick={() => setPrecosDe(t)}>
                      <Tags className="mr-1 h-4 w-4" /> Preços
                    </Button>
                    {gestao ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Editar ${t.nome}`}
                          onClick={() =>
                            setForm({
                              id: t.id,
                              nome: t.nome,
                              descricao: t.descricao ?? "",
                              ajuste: String(t.ajuste_percentual),
                              ativa: t.ativa,
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Excluir ${t.nome}`}
                          onClick={() => {
                            const n = data?.clientes.get(t.id) ?? 0;
                            const aviso =
                              n > 0 ? ` ${n} cliente(s) voltam ao preço normal do produto.` : "";
                            if (window.confirm(`Excluir a tabela "${t.nome}"?${aviso}`))
                              excluir.mutate(t);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar tabela" : "Nova tabela de preço"}</DialogTitle>
          </DialogHeader>
          {form ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="tp-nome">Nome</Label>
                <Input
                  id="tp-nome"
                  className="mt-1"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="tp-desc">Descrição (opcional)</Label>
                <Input
                  id="tp-desc"
                  className="mt-1"
                  value={form.descricao}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="tp-ajuste">Ajuste sobre o preço de venda (%)</Label>
                <Input
                  id="tp-ajuste"
                  className="mt-1"
                  inputMode="decimal"
                  value={form.ajuste}
                  onChange={(e) => setForm({ ...form, ajuste: e.target.value })}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Negativo dá desconto (-10 = 10% mais barato); positivo é acréscimo. Preços fixos
                  de produtos específicos valem mais que o ajuste.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="tp-ativa"
                  checked={form.ativa}
                  onCheckedChange={(v) => setForm({ ...form, ativa: v })}
                />
                <Label htmlFor="tp-ativa">Tabela ativa</Label>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={() => form && salvar.mutate(form)} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {precosDe ? (
        <PrecosDaTabela tabela={precosDe} gestao={gestao} onFechar={() => setPrecosDe(null)} />
      ) : null}
    </>
  );
}

function PrecosDaTabela({
  tabela,
  gestao,
  onFechar,
}: {
  tabela: Tabela;
  gestao: boolean;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [preco, setPreco] = useState("");

  const { data } = useQuery({
    queryKey: ["tabela-preco-itens", tabela.id],
    queryFn: async () => {
      const [itens, produtos] = await Promise.all([
        supabase
          .from("tabela_preco_itens")
          .select("id, produto_id, preco")
          .eq("tabela_id", tabela.id),
        supabase
          .from("produtos")
          .select("id, codigo_interno, descricao, preco_venda")
          .eq("ativo", true)
          .order("descricao"),
      ]);
      if (itens.error) throw itens.error;
      if (produtos.error) throw produtos.error;
      return { itens: itens.data, produtos: produtos.data };
    },
  });

  const porId = useMemo(() => new Map((data?.produtos ?? []).map((p) => [p.id, p])), [data]);
  const usados = useMemo(() => new Set((data?.itens ?? []).map((i) => i.produto_id)), [data]);
  const candidatos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return [];
    return (data?.produtos ?? [])
      .filter(
        (p) =>
          !usados.has(p.id) &&
          (p.descricao.toLowerCase().includes(termo) ||
            (p.codigo_interno ?? "").toLowerCase().includes(termo)),
      )
      .slice(0, 8);
  }, [busca, data, usados]);

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["tabela-preco-itens", tabela.id] });
    void qc.invalidateQueries({ queryKey: ["tabelas-preco"] });
    void qc.invalidateQueries({ queryKey: ["tabela-preco-cliente", tabela.id] });
  };

  const adicionar = useMutation({
    mutationFn: async () => {
      const valor = paraNumero(preco);
      if (!produtoId) throw new Error("Escolha o produto");
      if (!Number.isFinite(valor) || valor < 0) throw new Error("Informe um preço válido");
      const { error } = await supabase
        .from("tabela_preco_itens")
        .insert({ tabela_id: tabela.id, produto_id: produtoId, preco: valor });
      if (error) throw error;
    },
    onSuccess: () => {
      setProdutoId("");
      setPreco("");
      setBusca("");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tabela_preco_itens").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: atualizar,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Preços da tabela {tabela.nome} ({rotuloAjuste(Number(tabela.ajuste_percentual))})
          </DialogTitle>
        </DialogHeader>

        {gestao ? (
          <div className="space-y-2 rounded border p-3">
            <p className="text-sm font-medium">Fixar o preço de um produto</p>
            <Input
              placeholder="Buscar produto por código ou nome…"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setProdutoId("");
              }}
            />
            {candidatos.length > 0 && !produtoId ? (
              <ul className="divide-y rounded border text-sm">
                {candidatos.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-secondary"
                      onClick={() => {
                        setProdutoId(p.id);
                        setBusca(`${p.codigo_interno} — ${p.descricao}`);
                        setPreco(
                          String(precoNaTabela(Number(p.preco_venda ?? 0), tabela)).replace(
                            ".",
                            ",",
                          ),
                        );
                      }}
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.codigo_interno}
                      </span>
                      <span className="flex-1 truncate">{p.descricao}</span>
                      <span className="text-muted-foreground">
                        {brl(Number(p.preco_venda ?? 0))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-end gap-2">
              <div className="w-40">
                <Label htmlFor="tp-preco">Preço nesta tabela</Label>
                <Input
                  id="tp-preco"
                  className="mt-1"
                  inputMode="decimal"
                  value={preco}
                  onChange={(e) => setPreco(e.target.value)}
                />
              </div>
              <Button
                onClick={() => adicionar.mutate()}
                disabled={adicionar.isPending || !produtoId}
              >
                Fixar preço
              </Button>
            </div>
          </div>
        ) : null}

        {(data?.itens ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum preço fixado: todos os produtos usam o ajuste da tabela.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Preço normal</TableHead>
                <TableHead className="text-right">Nesta tabela</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.itens ?? []).map((i) => {
                const p = porId.get(i.produto_id);
                return (
                  <TableRow key={i.id}>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {p?.codigo_interno}
                      </span>{" "}
                      {p?.descricao ?? "Produto inativo"}
                    </TableCell>
                    <TableCell className="text-right">{brl(Number(p?.preco_venda ?? 0))}</TableCell>
                    <TableCell className="text-right font-medium">{brl(Number(i.preco))}</TableCell>
                    <TableCell className="text-right">
                      {gestao ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Remover preço fixo"
                          onClick={() => remover.mutate(i.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
