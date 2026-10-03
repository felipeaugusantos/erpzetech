import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { tamanhosSugeridos } from "@/lib/ramo";
import { brl } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Grade de tamanhos/cores do produto — só usada no ramo de roupas e calçados. */
export function GradeTamanhos({
  produtoId,
  tenantId,
}: {
  produtoId: string | undefined;
  tenantId: string | null | undefined;
}) {
  const qc = useQueryClient();
  const [tamanho, setTamanho] = useState("");
  const [cor, setCor] = useState("");
  const [barras, setBarras] = useState("");
  const [preco, setPreco] = useState("");

  const { data: variacoes = [] } = useQuery({
    queryKey: ["produto-variacoes", produtoId],
    enabled: Boolean(produtoId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produto_variacoes")
        .select("*")
        .eq("produto_id", produtoId as string)
        .order("tamanho");
      if (error) throw error;
      return data;
    },
  });

  const adicionar = useMutation({
    mutationFn: async () => {
      if (!produtoId) throw new Error("Salve o produto antes de cadastrar a grade.");
      if (!tenantId) throw new Error("Usuário sem empresa vinculada.");
      if (!tamanho.trim()) throw new Error("Informe o tamanho.");
      const { error } = await supabase.from("produto_variacoes").insert({
        tenant_id: tenantId,
        produto_id: produtoId,
        tamanho: tamanho.trim().toUpperCase(),
        cor: cor.trim() || null,
        codigo_barras: barras.trim() || null,
        preco_venda: preco ? Number(preco.replace(",", ".")) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTamanho("");
      setCor("");
      setBarras("");
      setPreco("");
      toast.success("Tamanho adicionado");
      void qc.invalidateQueries({ queryKey: ["produto-variacoes", produtoId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("produto_variacoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tamanho removido");
      void qc.invalidateQueries({ queryKey: ["produto-variacoes", produtoId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-1 text-sm font-semibold">Grade de tamanhos</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Disponível porque o ramo da empresa é roupas e calçados. Cadastre cada tamanho (e cor, se
        houver) com código de barras próprio.
      </p>

      {!produtoId ? (
        <p className="text-sm text-muted-foreground">
          Salve o produto primeiro para cadastrar a grade de tamanhos.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-5">
            <div>
              <Label htmlFor="v-tam">Tamanho</Label>
              <Input
                id="v-tam"
                list="tamanhos-sugeridos"
                value={tamanho}
                onChange={(e) => setTamanho(e.target.value)}
                placeholder="M, 38…"
              />
              <datalist id="tamanhos-sugeridos">
                {tamanhosSugeridos.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <Label htmlFor="v-cor">Cor</Label>
              <Input id="v-cor" value={cor} onChange={(e) => setCor(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="v-bar">Código de barras</Label>
              <Input id="v-bar" value={barras} onChange={(e) => setBarras(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="v-preco">Preço (opcional)</Label>
              <Input id="v-preco" value={preco} onChange={(e) => setPreco(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => adicionar.mutate()}
                disabled={adicionar.isPending}
              >
                <Plus className="mr-2 size-4" /> Adicionar
              </Button>
            </div>
          </div>

          {variacoes.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tamanho</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead>Código de barras</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variacoes.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell>
                        <Badge variant="secondary">{v.tamanho}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{v.cor ?? "—"}</TableCell>
                      <TableCell className="text-numeric text-sm">
                        {v.codigo_barras ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {v.preco_venda ? brl(Number(v.preco_venda)) : "preço do produto"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remover ${v.tamanho}`}
                          onClick={() => remover.mutate(v.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
