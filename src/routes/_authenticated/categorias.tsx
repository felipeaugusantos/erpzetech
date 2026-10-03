import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

export const Route = createFileRoute("/_authenticated/categorias")({
  head: () => ({
    meta: [
      { title: "Categorias — ERP Ze Tech" },
      { name: "description", content: "Categorias e subcategorias de produtos da loja." },
      { property: "og:title", content: "Categorias — ERP Ze Tech" },
      { property: "og:description", content: "Organize os produtos por categoria." },
    ],
  }),
  component: Categorias,
});

function Categorias() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [parent, setParent] = useState("none");

  const { data, isLoading } = useQuery({
    queryKey: ["categorias"],
    queryFn: async () => {
      const [cats, prods] = await Promise.all([
        supabase.from("categorias").select("id, nome, parent_id, ativo").order("nome"),
        supabase.from("produtos").select("categoria_id"),
      ]);
      const contagem = new Map<string, number>();
      for (const p of prods.data ?? [])
        if (p.categoria_id) contagem.set(p.categoria_id, (contagem.get(p.categoria_id) ?? 0) + 1);
      return { cats: cats.data ?? [], contagem };
    },
  });

  const criar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("categorias").insert({
        tenant_id: session?.profile?.tenant_id as string,
        nome,
        parent_id: parent === "none" ? null : parent,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Categoria criada");
      setOpen(false);
      setNome("");
      setParent("none");
      qc.invalidateQueries({ queryKey: ["categorias"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const desativar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categorias").update({ ativo: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Categoria desativada");
      qc.invalidateQueries({ queryKey: ["categorias"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Categorias"
        description="Estrutura de categorias e subcategorias dos produtos."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 size-4" /> Nova categoria
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova categoria</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="cat-nome">Nome</Label>
                  <Input id="cat-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
                </div>
                <div>
                  <Label>Categoria pai (opcional)</Label>
                  <Select value={parent} onValueChange={setParent}>
                    <SelectTrigger>
                      <SelectValue placeholder="Nenhuma" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma</SelectItem>
                      {(data?.cats ?? [])
                        .filter((c) => !c.parent_id)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nome}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => criar.mutate()} disabled={!nome.trim() || criar.isPending}>
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <div className="panel h-64 animate-pulse" />
      ) : (data?.cats.length ?? 0) === 0 ? (
        <EmptyState
          title="Nenhuma categoria encontrada."
          description="Crie a primeira categoria para organizar seus produtos."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoria</TableHead>
                <TableHead>Categoria pai</TableHead>
                <TableHead className="text-right">Produtos</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data!.cats.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nome}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {data!.cats.find((x) => x.id === c.parent_id)?.nome ?? "—"}
                  </TableCell>
                  <TableCell className="text-numeric text-right">
                    {data!.contagem.get(c.id) ?? 0}
                  </TableCell>
                  <TableCell>{c.ativo ? "Ativa" : "Inativa"}</TableCell>
                  <TableCell className="text-right">
                    {c.ativo && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => desativar.mutate(c.id)}
                        aria-label="Desativar"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
