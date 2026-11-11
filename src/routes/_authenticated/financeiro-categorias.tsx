import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import {
  gruposDoTipo,
  labelGrupo,
  podeGerirCategorias,
  type TipoCategoria,
} from "@/lib/categorias-financeiras";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/financeiro-categorias")({
  head: () => ({
    meta: [
      { title: "Categorias financeiras — EZRA ERP" },
      {
        name: "description",
        content: "Categorias de receitas e despesas que alimentam o DRE.",
      },
      { property: "og:title", content: "Categorias financeiras — EZRA ERP" },
      { property: "og:description", content: "Organize receitas e despesas para o DRE." },
    ],
  }),
  component: CategoriasFinanceiras,
});

type Categoria = { id: string; nome: string; tipo: string; grupo: string; ativa: boolean };

function CategoriasFinanceiras() {
  const { data: sessao } = useSessionData();
  const podeGerir = podeGerirCategorias(sessao?.roles ?? []);
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<Partial<Categoria> | null>(null);

  const { data: categorias = [], isLoading } = useQuery({
    queryKey: ["financeiro-categorias-todas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financeiro_categorias")
        .select("id, nome, tipo, grupo, ativa")
        .order("tipo", { ascending: false })
        .order("nome");
      if (error) throw error;
      return data as Categoria[];
    },
  });

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: ["financeiro-categorias-todas"] });
    void queryClient.invalidateQueries({ queryKey: ["financeiro-categorias"] });
  };

  const salvar = useMutation({
    mutationFn: async (c: Partial<Categoria>) => {
      const { error } = await supabase.rpc("financeiro_categoria_salvar", {
        p_id: c.id ?? null,
        p_nome: (c.nome ?? "").trim(),
        p_tipo: c.tipo ?? "despesa",
        p_grupo: c.grupo ?? "operacional",
        p_ativa: c.ativa ?? true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Categoria salva.");
      setEditando(null);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const padrao = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("financeiro_categorias_padrao");
      if (error) throw error;
      return data;
    },
    onSuccess: (n) => {
      toast.success(`${n} categorias criadas. Ajuste o que for diferente na sua empresa.`);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("financeiro_categorias_importar_texto");
      if (error) throw error;
      return data as { categorias_criadas: number; titulos_ligados: number };
    },
    onSuccess: (r) => {
      toast.success(
        r.titulos_ligados === 0
          ? "Nenhum lançamento antigo com categoria em texto para ligar."
          : `${r.categorias_criadas} categoria(s) criada(s) e ${r.titulos_ligados} lançamento(s) ligado(s).`,
      );
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!podeGerir) {
    return (
      <div>
        <PageHeader title="Categorias financeiras" />
        <EmptyState
          title="Acesso restrito"
          description="Só administrador, gestor e financeiro cadastram categorias."
        />
      </div>
    );
  }

  const porTipo = (tipo: TipoCategoria) => categorias.filter((c) => c.tipo === tipo);

  return (
    <div>
      <PageHeader
        title="Categorias financeiras"
        description="Classificam receitas e despesas e decidem onde cada lançamento aparece no DRE."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={importar.isPending}
              onClick={() => importar.mutate()}
              title="Cria categorias a partir do texto livre dos lançamentos de contas a pagar antigos"
            >
              Importar dos lançamentos antigos
            </Button>
            <Button
              onClick={() =>
                setEditando({ tipo: "despesa", grupo: "operacional", ativa: true, nome: "" })
              }
            >
              <Plus className="size-4" /> Nova categoria
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : categorias.length === 0 ? (
        <EmptyState
          title="Nenhuma categoria ainda"
          description="Comece pelo conjunto padrão (aluguel, salários, impostos…) e ajuste depois, ou crie as suas."
          action={
            <Button disabled={padrao.isPending} onClick={() => padrao.mutate()}>
              Criar categorias padrão
            </Button>
          }
        />
      ) : (
        (["receita", "despesa"] as const).map((tipo) => (
          <section key={tipo} className="mb-8">
            <h2 className="mb-2 font-display text-lg font-semibold">
              {tipo === "receita" ? "Receitas" : "Despesas"}
            </h2>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Grupo no DRE</TableHead>
                    <TableHead className="w-24">Situação</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porTipo(tipo).map((c) => (
                    <TableRow key={c.id} className={c.ativa ? "" : "opacity-60"}>
                      <TableCell className="font-medium">{c.nome}</TableCell>
                      <TableCell className="text-sm">
                        {labelGrupo(tipo, c.grupo)}
                        {c.grupo === "fora_dre" && (
                          <Badge variant="outline" className="ml-2">
                            não entra no DRE
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.ativa ? "secondary" : "outline"}>
                          {c.ativa ? "Ativa" : "Inativa"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditando(c)}>
                          Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {porTipo(tipo).length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-4 text-center text-sm text-muted-foreground"
                      >
                        Nenhuma categoria de {tipo === "receita" ? "receita" : "despesa"}.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        ))
      )}

      <Dialog open={Boolean(editando)} onOpenChange={(aberto) => !aberto && setEditando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar categoria" : "Nova categoria"}</DialogTitle>
            <DialogDescription>
              O grupo decide em que linha do DRE a categoria entra. “Fora do DRE” serve para compra
              de estoque, investimento e retirada de sócios.
            </DialogDescription>
          </DialogHeader>
          {editando && (
            <div className="grid gap-3">
              <div>
                <Label>Nome</Label>
                <Input
                  value={editando.nome ?? ""}
                  onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Tipo</Label>
                  <Select
                    value={editando.tipo ?? "despesa"}
                    disabled={Boolean(editando.id)}
                    onValueChange={(v) =>
                      setEditando({ ...editando, tipo: v, grupo: "operacional" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="receita">Receita</SelectItem>
                      <SelectItem value="despesa">Despesa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Situação</Label>
                  <Select
                    value={editando.ativa === false ? "inativa" : "ativa"}
                    onValueChange={(v) => setEditando({ ...editando, ativa: v === "ativa" })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativa">Ativa</SelectItem>
                      <SelectItem value="inativa">Inativa (não aparece nas listas)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Grupo no DRE</Label>
                <Select
                  value={editando.grupo ?? "operacional"}
                  onValueChange={(v) => setEditando({ ...editando, grupo: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {gruposDoTipo((editando.tipo as TipoCategoria) ?? "despesa").map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditando(null)}>
                  Voltar
                </Button>
                <Button
                  disabled={salvar.isPending || (editando.nome ?? "").trim().length < 2}
                  onClick={() => salvar.mutate(editando)}
                >
                  {salvar.isPending ? "Salvando…" : "Salvar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
