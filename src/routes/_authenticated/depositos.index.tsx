import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Warehouse } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, num } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_authenticated/depositos/")({
  head: () => ({
    meta: [
      { title: "Depósitos — ERP Ze Tech" },
      { name: "description", content: "Depósitos da filial com saldo e valor de estoque." },
      { property: "og:title", content: "Depósitos — ERP Ze Tech" },
      { property: "og:description", content: "Controle de múltiplos depósitos por filial." },
    ],
  }),
  component: Depositos,
});

function Depositos() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    tipo: "proprio",
    endereco: "",
    filial_id: "",
    permite_negativo: false,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["depositos"],
    queryFn: async () => {
      const [dep, est] = await Promise.all([
        supabase.from("depositos").select("*, filiais(nome)").order("nome"),
        supabase.from("estoques").select("deposito_id, quantidade, reservado, produtos(custo)"),
      ]);
      const resumo = new Map<
        string,
        { itens: number; qtd: number; valor: number; reservado: number }
      >();
      for (const e of est.data ?? []) {
        const r = resumo.get(e.deposito_id) ?? { itens: 0, qtd: 0, valor: 0, reservado: 0 };
        const custo = Number((e.produtos as unknown as { custo: number } | null)?.custo ?? 0);
        r.itens += Number(e.quantidade) > 0 ? 1 : 0;
        r.qtd += Number(e.quantidade);
        r.reservado += Number(e.reservado);
        r.valor += Number(e.quantidade) * custo;
        resumo.set(e.deposito_id, r);
      }
      return { depositos: dep.data ?? [], resumo };
    },
  });

  const criar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("depositos").insert({
        tenant_id: session?.profile?.tenant_id as string,
        filial_id: form.filial_id || session?.profile?.filial_id || null,
        nome: form.nome,
        tipo: form.tipo,
        endereco: form.endereco || null,
        permite_negativo: form.permite_negativo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Depósito criado");
      setOpen(false);
      setForm({ nome: "", tipo: "proprio", endereco: "", filial_id: "", permite_negativo: false });
      qc.invalidateQueries({ queryKey: ["depositos"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Depósitos"
        description="Cada depósito tem saldo próprio e permite transferências internas."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 size-4" /> Novo depósito
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo depósito</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="dep-nome">Nome</Label>
                  <Input
                    id="dep-nome"
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Tipo</Label>
                    <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="proprio">Próprio</SelectItem>
                        <SelectItem value="loja">Loja</SelectItem>
                        <SelectItem value="externo">Externo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Filial</Label>
                    <Select
                      value={form.filial_id || session?.profile?.filial_id || ""}
                      onValueChange={(v) => setForm({ ...form, filial_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {(session?.filiais ?? []).map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label htmlFor="dep-end">Endereço</Label>
                  <Input
                    id="dep-end"
                    value={form.endereco}
                    onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">Permitir estoque negativo</p>
                    <p className="text-xs text-muted-foreground">
                      Mantenha desligado para bloquear saídas acima do disponível.
                    </p>
                  </div>
                  <Switch
                    checked={form.permite_negativo}
                    onCheckedChange={(v) => setForm({ ...form, permite_negativo: v })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => criar.mutate()}
                  disabled={!form.nome.trim() || criar.isPending}
                >
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="panel h-40 animate-pulse" />
          ))}
        </div>
      ) : (data?.depositos.length ?? 0) === 0 ? (
        <EmptyState
          title="Nenhum depósito encontrado."
          description="Cadastre o primeiro depósito."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data!.depositos.map((d) => {
            const r = data!.resumo.get(d.id);
            return (
              <div key={d.id} className="panel p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-base font-semibold">{d.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {(d.filiais as unknown as { nome: string } | null)?.nome ?? "Sem filial"}
                    </p>
                  </div>
                  <span className="grid size-8 place-items-center rounded-md bg-secondary">
                    <Warehouse className="size-4" />
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="capitalize">
                    {d.tipo}
                  </Badge>
                  {d.permite_negativo ? (
                    <Badge variant="destructive">Permite negativo</Badge>
                  ) : (
                    <Badge variant="outline">Bloqueia negativo</Badge>
                  )}
                  {!d.ativo && <Badge variant="outline">Inativo</Badge>}
                </div>
                <dl className="mt-4 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Itens com saldo</dt>
                    <dd className="text-numeric">{num(r?.itens ?? 0, 0)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Quantidade total</dt>
                    <dd className="text-numeric">{num(r?.qtd ?? 0)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Reservado</dt>
                    <dd className="text-numeric">{num(r?.reservado ?? 0)}</dd>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <dt>Valor (custo)</dt>
                    <dd className="text-numeric">{brl(r?.valor ?? 0)}</dd>
                  </div>
                </dl>
                <Button asChild variant="outline" size="sm" className="mt-4 w-full">
                  <Link to="/depositos/$id" params={{ id: d.id }}>
                    Ver estoque do depósito
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
