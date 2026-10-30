import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Wand2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useManufatura } from "@/hooks/useManufatura";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { PERFIS_GESTAO_MANUFATURA } from "@/lib/manufatura";

export const Route = createFileRoute("/_authenticated/manufatura-etapas")({
  head: () => ({
    meta: [
      { title: "Roteiro e custo por hora — EZRA ERP" },
      {
        name: "description",
        content:
          "Etapas da produção (corte, montagem, acabamento…) e o custo da hora de cada uma, para a mão de obra entrar no custo da ordem.",
      },
    ],
  }),
  component: EtapasModulo,
});

function EtapasModulo() {
  const m = useManufatura();
  if (m.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!m.liberada) return <ManufaturaBloqueada motivo="modulo" />;
  if (!m.temPerfil(PERFIS_GESTAO_MANUFATURA)) return <ManufaturaBloqueada motivo="perfil" />;
  return <Etapas />;
}

type FormEtapa = {
  id: string | null;
  nome: string;
  ordem: string;
  custo_hora: string;
  ativo: boolean;
};

const numero = (t: string) => Number((t || "0").replace(",", "."));

function Etapas() {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormEtapa | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["mf-etapas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mf_etapas")
        .select("*")
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
  const atualizar = () => void qc.invalidateQueries({ queryKey: ["mf-etapas"] });

  const salvar = useMutation({
    mutationFn: async (f: FormEtapa) => {
      if (!f.nome.trim()) throw new Error("Informe o nome da etapa.");
      const custo = numero(f.custo_hora);
      if (!(custo >= 0)) throw new Error("O custo por hora não pode ser negativo.");
      const { error } = await supabase.rpc("mf_etapa_salvar", {
        p_dados: {
          ...(f.id ? { id: f.id } : {}),
          nome: f.nome,
          ordem: Math.round(numero(f.ordem)),
          custo_hora: custo,
          ativo: f.ativo,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Etapa salva.");
      setForm(null);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const iniciais = useMutation({
    mutationFn: async () => {
      const { data: n, error } = await supabase.rpc("mf_etapas_iniciais");
      if (error) throw error;
      return n;
    },
    onSuccess: (n) => {
      toast.success(
        n
          ? `${n} etapas de marcenaria criadas. Informe o custo por hora de cada uma.`
          : "A empresa já tem etapas.",
      );
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Roteiro e custo por hora"
        description="Etapas da produção e o custo da hora de cada uma. Ao liberar uma ordem, o roteiro é copiado com o custo daquele momento."
        actions={
          <Button
            onClick={() =>
              setForm({
                id: null,
                nome: "",
                ordem: String((data?.length ?? 0) * 10 + 10),
                custo_hora: "0",
                ativo: true,
              })
            }
          >
            <Plus className="mr-2 size-4" /> Nova etapa
          </Button>
        }
      />

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState
          title="Nenhuma etapa cadastrada"
          description="Comece pelo roteiro de marcenaria (corte, furação e usinagem, montagem, pintura ou acabamento e embalagem) e ajuste depois."
          action={
            <Button onClick={() => iniciais.mutate()} disabled={iniciais.isPending}>
              <Wand2 className="mr-2 size-4" /> Criar etapas de marcenaria
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Ordem</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead className="text-right">Custo por hora</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data!.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-numeric">{e.ordem}</TableCell>
                  <TableCell className="font-medium">{e.nome}</TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(e.custo_hora))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={e.ativo ? "default" : "secondary"}>
                      {e.ativo ? "Ativa" : "Inativa"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setForm({
                          id: e.id,
                          nome: e.nome,
                          ordem: String(e.ordem),
                          custo_hora: String(e.custo_hora),
                          ativo: e.ativo,
                        })
                      }
                    >
                      <Pencil className="mr-1.5 size-3.5" /> Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar etapa" : "Nova etapa"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="et-nome">Nome</Label>
                <Input
                  id="et-nome"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex.: Corte"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="et-ordem">Ordem</Label>
                  <Input
                    id="et-ordem"
                    inputMode="numeric"
                    value={form.ordem}
                    onChange={(e) => setForm({ ...form, ordem: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="et-custo">Custo por hora (R$)</Label>
                  <Input
                    id="et-custo"
                    inputMode="decimal"
                    value={form.custo_hora}
                    onChange={(e) => setForm({ ...form, custo_hora: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <Label htmlFor="et-ativo">Etapa ativa (entra nas próximas ordens)</Label>
                <Switch
                  id="et-ativo"
                  checked={form.ativo}
                  onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={() => form && salvar.mutate(form)} disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
