import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
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
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import type { Box } from "@/lib/internacao";

export const Route = createFileRoute("/_authenticated/clinica-boxes")({
  head: () => ({
    meta: [
      { title: "Boxes de internação — EZRA ERP" },
      { name: "description", content: "Boxes onde os animais ficam internados na clínica." },
    ],
  }),
  component: BoxesModulo,
});

function BoxesModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Boxes />;
}

type Form = { id?: string; nome: string; ativo: boolean };

function Boxes() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>({ nome: "", ativo: true });

  const { data: boxes = [], isLoading } = useQuery({
    queryKey: ["clinica-boxes"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_boxes");
      if (error) throw error;
      return (data ?? []) as unknown as Box[];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do box.");
      const { error } = await supabase.rpc("pet_box_salvar", {
        p_dados: { ...(form.id ? { id: form.id } : {}), nome: form.nome.trim(), ativo: form.ativo },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.id ? "Box atualizado." : "Box criado.");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["clinica-boxes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Boxes de internação"
        description="Cada box recebe um animal por vez. Box desativado não aceita novas internações."
        actions={
          <Button
            onClick={() => {
              setForm({ nome: "", ativo: true });
              setAberto(true);
            }}
          >
            <Plus className="size-4" /> Novo box
          </Button>
        }
      />

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : boxes.length === 0 ? (
        <EmptyState
          title="Nenhum box cadastrado"
          description="Cadastre os boxes antes de internar o primeiro animal."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Box</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {boxes.map((b) => (
                <TableRow key={b.id} className={b.ativo ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{b.nome}</TableCell>
                  <TableCell>
                    {!b.ativo ? (
                      <Badge variant="outline">Desativado</Badge>
                    ) : b.ocupado ? (
                      <Badge variant="secondary">Ocupado</Badge>
                    ) : (
                      <Badge variant="outline">Livre</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${b.nome}`}
                      onClick={() => {
                        setForm({ id: b.id, nome: b.nome, ativo: b.ativo });
                        setAberto(true);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar box" : "Novo box"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="bx-nome">Nome</Label>
              <Input
                id="bx-nome"
                maxLength={40}
                placeholder="Ex.: Box 1, Gatil A"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="bx-ativo"
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />
              <Label htmlFor="bx-ativo">Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
