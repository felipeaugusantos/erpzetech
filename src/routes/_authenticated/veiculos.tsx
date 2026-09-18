import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Truck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { num } from "@/lib/format";
import { tiposVeiculo } from "@/lib/entrega";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/veiculos")({
  head: () => ({
    meta: [
      { title: "Veículos — ERP Ze Tech" },
      {
        name: "description",
        content: "Frota da loja: placa, tipo, capacidade de carga e situação de uso.",
      },
      { property: "og:title", content: "Veículos — ERP Ze Tech" },
      { property: "og:description", content: "Frota usada nas entregas de material." },
    ],
  }),
  component: Veiculos,
});

type Form = {
  id?: string;
  placa: string;
  descricao: string;
  tipo: string;
  capacidade_kg: string;
  capacidade_m3: string;
  observacao: string;
  ativo: boolean;
};

const vazio: Form = {
  placa: "",
  descricao: "",
  tipo: "caminhao",
  capacidade_kg: "",
  capacidade_m3: "",
  observacao: "",
  ativo: true,
};

function Veiculos() {
  const { data: session } = useSessionData();
  const profile = session?.profile;
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const { data: veiculos = [], isLoading } = useQuery({
    queryKey: ["veiculos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("veiculos").select("*").order("descricao");
      if (error) throw error;
      return data;
    },
  });

  const { data: emRota = [] } = useQuery({
    queryKey: ["veiculos-em-rota"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entregas")
        .select("veiculo_id")
        .eq("situacao", "em_rota");
      if (error) throw error;
      return data;
    },
  });

  const rotaPorVeiculo = useMemo(() => {
    const set = new Set<string>();
    for (const e of emRota) if (e.veiculo_id) set.add(e.veiculo_id);
    return set;
  }, [emRota]);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return veiculos;
    return veiculos.filter((v) =>
      [v.placa, v.descricao, v.tipo].filter(Boolean).some((x) => String(x).toLowerCase().includes(t)),
    );
  }, [veiculos, busca]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id || !profile?.empresa_id) throw new Error("Usuário sem empresa vinculada");
      if (!form.placa.trim()) throw new Error("Informe a placa");
      if (!form.descricao.trim()) throw new Error("Informe a descrição do veículo");
      const payload = {
        tenant_id: profile.tenant_id,
        empresa_id: profile.empresa_id,
        filial_id: profile.filial_id ?? null,
        placa: form.placa.trim().toUpperCase(),
        descricao: form.descricao.trim(),
        tipo: form.tipo,
        capacidade_kg: form.capacidade_kg ? Number(form.capacidade_kg) : null,
        capacidade_m3: form.capacidade_m3 ? Number(form.capacidade_m3) : null,
        observacao: form.observacao || null,
        ativo: form.ativo,
      };
      if (form.id) {
        const { error } = await supabase.from("veiculos").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("veiculos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Veículo atualizado." : "Veículo cadastrado.");
      setAberto(false);
      setForm(vazio);
      void queryClient.invalidateQueries({ queryKey: ["veiculos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Veículos"
        description="A frota que faz as entregas, com placa, tipo e capacidade de carga."
        actions={
          <Button
            onClick={() => {
              setForm(vazio);
              setAberto(true);
            }}
          >
            <Plus className="size-4" /> Novo veículo
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Veículos" value={String(veiculos.length)} icon={Truck} />
        <StatCard
          label="Disponíveis"
          value={String(veiculos.filter((v) => v.ativo && !rotaPorVeiculo.has(v.id)).length)}
          tone="success"
        />
        <StatCard label="Em rota agora" value={String(rotaPorVeiculo.size)} tone="accent" />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por placa, descrição ou tipo"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum veículo encontrado."
          description="Cadastre a frota para poder planejar as entregas."
          action={
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo veículo
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Veículo</TableHead>
                <TableHead>Placa</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Capacidade</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.descricao}</TableCell>
                  <TableCell className="text-numeric">{v.placa}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {tiposVeiculo.find((t) => t.value === v.tipo)?.label ?? v.tipo}
                  </TableCell>
                  <TableCell className="text-right text-numeric text-sm">
                    {v.capacidade_kg ? `${num(Number(v.capacidade_kg), 0)} kg` : "—"}
                    {v.capacidade_m3 ? ` · ${num(Number(v.capacidade_m3))} m³` : ""}
                  </TableCell>
                  <TableCell>
                    {!v.ativo ? (
                      <Badge variant="outline">Inativo</Badge>
                    ) : rotaPorVeiculo.has(v.id) ? (
                      <Badge className="bg-primary/15 text-primary">Em rota</Badge>
                    ) : (
                      <Badge className="bg-success/15 text-success">Disponível</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setForm({
                          id: v.id,
                          placa: v.placa,
                          descricao: v.descricao,
                          tipo: v.tipo,
                          capacidade_kg: v.capacidade_kg ? String(v.capacidade_kg) : "",
                          capacidade_m3: v.capacidade_m3 ? String(v.capacidade_m3) : "",
                          observacao: v.observacao ?? "",
                          ativo: v.ativo,
                        });
                        setAberto(true);
                      }}
                    >
                      <Pencil className="size-4" /> Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar veículo" : "Novo veículo"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Descrição</Label>
              <Input
                value={form.descricao}
                placeholder="Caminhão Toco Mercedes 1016"
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              />
            </div>
            <div>
              <Label>Placa</Label>
              <Input
                value={form.placa}
                placeholder="ABC1D23"
                onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tiposVeiculo.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Capacidade (kg)</Label>
              <Input
                value={form.capacidade_kg}
                onChange={(e) => setForm({ ...form, capacidade_kg: e.target.value })}
              />
            </div>
            <div>
              <Label>Capacidade (m³)</Label>
              <Input
                value={form.capacidade_m3}
                onChange={(e) => setForm({ ...form, capacidade_m3: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Observação</Label>
              <Input
                value={form.observacao}
                onChange={(e) => setForm({ ...form, observacao: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />
              <span className="text-sm">Veículo ativo</span>
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
