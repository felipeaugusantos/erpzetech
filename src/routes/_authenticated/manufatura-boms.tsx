import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ManufaturaBloqueada } from "@/components/app/ManufaturaBloqueada";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useManufatura } from "@/hooks/useManufatura";
import {
  PERFIS_GESTAO_MANUFATURA,
  SITUACAO_BOM,
  erroDoItem,
  formatarQuantidadeMf,
  itensParaBanco,
  type LinhaItemForm,
} from "@/lib/manufatura";

export const Route = createFileRoute("/_authenticated/manufatura-boms")({
  head: () => ({
    meta: [
      { title: "Listas de materiais — EZRA ERP" },
      {
        name: "description",
        content: "Receita de cada produto: insumos, quantidades e perda de corte, com versões.",
      },
    ],
  }),
  component: BomsModulo,
});

function BomsModulo() {
  const m = useManufatura();
  if (m.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!m.liberada) return <ManufaturaBloqueada motivo="modulo" />;
  if (!m.temPerfil(PERFIS_GESTAO_MANUFATURA)) return <ManufaturaBloqueada motivo="perfil" />;
  return <Boms />;
}

type FormBom = {
  id: string | null;
  produto_id: string;
  rotulo: string;
  rendimento: string;
  itens: LinhaItemForm[];
};

const linhaVazia = (): LinhaItemForm => ({ insumo_id: "", quantidade: "", perda_percentual: "0" });
const formVazio = (): FormBom => ({
  id: null,
  produto_id: "",
  rotulo: "",
  rendimento: "1",
  itens: [linhaVazia()],
});

function Boms() {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormBom | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["mf-boms"],
    queryFn: async () => {
      const [boms, itens, produtos] = await Promise.all([
        supabase.from("mf_boms").select("*").order("created_at", { ascending: false }),
        supabase.from("mf_bom_itens").select("*"),
        supabase
          .from("produtos")
          .select("id, descricao, unidade")
          .eq("ativo", true)
          .order("descricao")
          .limit(2000),
      ]);
      for (const r of [boms, itens, produtos]) if (r.error) throw r.error;
      return { boms: boms.data ?? [], itens: itens.data ?? [], produtos: produtos.data ?? [] };
    },
  });
  const produto = (id: string) => data?.produtos.find((p) => p.id === id);
  const atualizar = () => void qc.invalidateQueries({ queryKey: ["mf-boms"] });

  const salvar = useMutation({
    mutationFn: async (f: FormBom) => {
      if (!f.produto_id) throw new Error("Escolha o produto acabado.");
      const rend = Number(f.rendimento.replace(",", "."));
      if (!Number.isFinite(rend) || rend <= 0)
        throw new Error("O rendimento precisa ser maior que zero.");
      if (f.itens.length === 0) throw new Error("Inclua ao menos um item.");
      for (const l of f.itens) {
        const e = erroDoItem(l);
        if (e) throw new Error(e);
      }
      const { error } = await supabase.rpc("mf_bom_salvar", {
        p_dados: {
          ...(f.id ? { id: f.id } : {}),
          produto_id: f.produto_id,
          rotulo: f.rotulo,
          rendimento: rend,
          itens: itensParaBanco(f.itens),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lista de materiais salva.");
      setForm(null);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ativar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mf_bom_ativar", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lista ativada. A versão anterior ficou obsoleta.");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Abre o formulário com os itens de uma lista: rascunho edita a mesma, as demais viram uma nova versão. */
  function abrir(bomId: string, comoNova: boolean) {
    const b = data?.boms.find((x) => x.id === bomId);
    if (!b) return;
    setForm({
      id: comoNova ? null : b.id,
      produto_id: b.produto_id,
      rotulo: b.rotulo ?? "",
      rendimento: String(b.rendimento),
      itens: (data?.itens ?? [])
        .filter((i) => i.bom_id === b.id)
        .map((i) => ({
          insumo_id: i.insumo_id,
          quantidade: String(i.quantidade),
          perda_percentual: String(i.perda_percentual),
        })),
    });
  }

  const alterarLinha = (idx: number, parte: Partial<LinhaItemForm>) =>
    setForm((f) =>
      f ? { ...f, itens: f.itens.map((l, i) => (i === idx ? { ...l, ...parte } : l)) } : f,
    );

  return (
    <div>
      <PageHeader
        title="Listas de materiais"
        description="A receita de cada produto: insumos, quantidades e perda de corte. Cada mudança vira uma nova versão."
        actions={
          <Button onClick={() => setForm(formVazio())}>
            <Plus className="mr-2 size-4" /> Nova lista
          </Button>
        }
      />

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : (data?.boms.length ?? 0) === 0 ? (
        <EmptyState
          title="Nenhuma lista de materiais ainda"
          description="Cadastre a receita de um produto para usá-la nas ordens de produção."
        />
      ) : (
        <div className="space-y-3">
          {data!.boms.map((b) => {
            const itens = data!.itens.filter((i) => i.bom_id === b.id);
            return (
              <div key={b.id} className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-base font-semibold">
                      {produto(b.produto_id)?.descricao ?? "Produto"}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        · versão {b.versao}
                        {b.rotulo ? ` · ${b.rotulo}` : ""}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Rendimento: {formatarQuantidadeMf(Number(b.rendimento))} por receita
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={b.situacao === "ativa" ? "default" : "secondary"}
                      className="gap-1"
                    >
                      {b.situacao === "ativa" && <CheckCircle2 className="size-3" />}
                      {SITUACAO_BOM[b.situacao] ?? b.situacao}
                    </Badge>
                    {b.situacao === "rascunho" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => abrir(b.id, false)}>
                          <Pencil className="mr-1.5 size-3.5" /> Editar
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => ativar.mutate(b.id)}
                          disabled={ativar.isPending}
                        >
                          Ativar
                        </Button>
                      </>
                    )}
                    {b.situacao !== "rascunho" && (
                      <Button size="sm" variant="outline" onClick={() => abrir(b.id, true)}>
                        <Copy className="mr-1.5 size-3.5" /> Nova versão
                      </Button>
                    )}
                  </div>
                </div>
                <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {itens.map((i) => (
                    <li
                      key={i.id}
                      className="flex items-center justify-between gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {produto(i.insumo_id)?.descricao ?? "Insumo"}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatarQuantidadeMf(Number(i.quantidade))}{" "}
                        {produto(i.insumo_id)?.unidade ?? ""}
                        {Number(i.perda_percentual) > 0
                          ? ` · perda ${formatarQuantidadeMf(Number(i.perda_percentual))}%`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar rascunho" : "Nova lista de materiais"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="mf-produto">Produto acabado</Label>
                <Select
                  value={form.produto_id}
                  onValueChange={(v) => setForm({ ...form, produto_id: v })}
                  disabled={form.id !== null}
                >
                  <SelectTrigger id="mf-produto">
                    <SelectValue placeholder="Escolha o produto" />
                  </SelectTrigger>
                  <SelectContent>
                    {(data?.produtos ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.descricao}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="mf-rotulo">Nome da versão (opcional)</Label>
                  <Input
                    id="mf-rotulo"
                    value={form.rotulo}
                    onChange={(e) => setForm({ ...form, rotulo: e.target.value })}
                    placeholder="Ex.: Armário 2 portas"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mf-rend">Rendimento (peças por receita)</Label>
                  <Input
                    id="mf-rend"
                    inputMode="decimal"
                    value={form.rendimento}
                    onChange={(e) => setForm({ ...form, rendimento: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Itens (quantidade por receita)</Label>
                {form.itens.map((l, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_5.5rem_5.5rem_auto] items-end gap-2 max-sm:grid-cols-2"
                  >
                    <div className="max-sm:col-span-2">
                      <Select
                        value={l.insumo_id}
                        onValueChange={(v) => alterarLinha(idx, { insumo_id: v })}
                      >
                        <SelectTrigger aria-label={`Insumo ${idx + 1}`}>
                          <SelectValue placeholder="Insumo" />
                        </SelectTrigger>
                        <SelectContent>
                          {(data?.produtos ?? []).map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.descricao}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      aria-label={`Quantidade ${idx + 1}`}
                      inputMode="decimal"
                      placeholder="Qtd."
                      value={l.quantidade}
                      onChange={(e) => alterarLinha(idx, { quantidade: e.target.value })}
                    />
                    <Input
                      aria-label={`Perda % ${idx + 1}`}
                      inputMode="decimal"
                      placeholder="Perda %"
                      value={l.perda_percentual}
                      onChange={(e) => alterarLinha(idx, { perda_percentual: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover item ${idx + 1}`}
                      onClick={() =>
                        setForm({ ...form, itens: form.itens.filter((_, i) => i !== idx) })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => setForm({ ...form, itens: [...form.itens, linhaVazia()] })}
                >
                  <Plus className="mr-1.5 size-3.5" /> Adicionar item
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={() => form && salvar.mutate(form)} disabled={salvar.isPending}>
              Salvar rascunho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
