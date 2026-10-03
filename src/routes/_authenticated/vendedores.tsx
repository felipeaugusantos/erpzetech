import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Store, UserCog } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { dateBR, initials, num } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/vendedores")({
  head: () => ({
    meta: [
      { title: "Cadastro de vendedores — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Dados pessoais, cargo, admissão, demissão, percentual de comissão e permissão de venda entre lojas.",
      },
      { property: "og:title", content: "Cadastro de vendedores — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Equipe de vendas com comissão e permissões por loja.",
      },
    ],
  }),
  component: Vendedores,
});

type Form = {
  nome: string;
  codigo: string;
  cargo: string;
  telefone: string;
  filial_id: string;
  data_admissao: string;
  data_demissao: string;
  ativo: boolean;
  vender_outras_lojas: boolean;
  percentual: string;
  base: string;
  venda_minima: string;
  regra_ativa: boolean;
};

const vazio: Form = {
  nome: "",
  codigo: "",
  cargo: "Vendedor",
  telefone: "",
  filial_id: "",
  data_admissao: "",
  data_demissao: "",
  ativo: true,
  vender_outras_lojas: false,
  percentual: "2",
  base: "venda",
  venda_minima: "0",
  regra_ativa: true,
};

function Vendedores() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const podeEditar =
    (session?.roles.includes("administrador") || session?.roles.includes("gestor")) ?? false;

  const [aberto, setAberto] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(vazio);
  const [somenteAtivos, setSomenteAtivos] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ["vendedores"],
    queryFn: async () => {
      const [pRes, rRes, regrasRes] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, nome, codigo, email, telefone, cargo, ativo, filial_id, data_admissao, data_demissao, vender_outras_lojas",
          )
          .order("nome"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("vendedor_comissao_regras").select("*"),
      ]);
      if (pRes.error) throw pRes.error;
      return {
        pessoas: pRes.data ?? [],
        roles: rRes.data ?? [],
        regras: regrasRes.data ?? [],
      };
    },
  });

  const vendedores = useMemo(() => {
    const pessoas = data?.pessoas ?? [];
    const ids = new Set(
      (data?.roles ?? [])
        .filter((r) => r.role === "vendedor" || r.role === "gestor" || r.role === "administrador")
        .map((r) => r.user_id),
    );
    return pessoas.filter((p) => ids.has(p.id)).filter((p) => (somenteAtivos ? p.ativo : true));
  }, [data, somenteAtivos]);

  function regraDe(id: string) {
    return (data?.regras ?? []).find((r) => r.vendedor_id === id);
  }

  function editar(id: string) {
    const p = (data?.pessoas ?? []).find((x) => x.id === id);
    if (!p) return;
    const r = regraDe(id);
    setEditId(id);
    setForm({
      nome: p.nome ?? "",
      codigo: p.codigo ?? "",
      cargo: p.cargo ?? "Vendedor",
      telefone: p.telefone ?? "",
      filial_id: p.filial_id ?? "",
      data_admissao: p.data_admissao ?? "",
      data_demissao: p.data_demissao ?? "",
      ativo: p.ativo,
      vender_outras_lojas: p.vender_outras_lojas ?? false,
      percentual: r ? String(r.percentual) : "2",
      base: r?.base ?? "venda",
      venda_minima: r ? String(r.venda_minima) : "0",
      regra_ativa: r?.ativo ?? true,
    });
    setAberto(true);
  }

  const salvar = useMutation({
    mutationFn: async () => {
      if (!editId) throw new Error("Selecione um vendedor");
      const perc = Number(form.percentual.replace(",", "."));
      if (!Number.isFinite(perc) || perc < 0 || perc > 100) {
        throw new Error("O percentual de comissão deve ficar entre 0 e 100");
      }
      const minimo = Number(form.venda_minima.replace(",", ".")) || 0;

      const { error: e1 } = await supabase
        .from("profiles")
        .update({
          nome: form.nome.trim(),
          codigo: form.codigo.trim() || null,
          cargo: form.cargo.trim() || null,
          telefone: form.telefone.trim() || null,
          filial_id: form.filial_id || null,
          data_admissao: form.data_admissao || null,
          data_demissao: form.data_demissao || null,
          ativo: form.data_demissao ? false : form.ativo,
          vender_outras_lojas: form.vender_outras_lojas,
        })
        .eq("id", editId);
      if (e1) throw e1;

      const existente = regraDe(editId);
      if (existente) {
        const { error } = await supabase
          .from("vendedor_comissao_regras")
          .update({
            percentual: perc,
            base: form.base,
            venda_minima: minimo,
            ativo: form.regra_ativa,
          })
          .eq("id", existente.id);
        if (error) throw error;
      } else if (perc > 0) {
        const tenant = session?.profile?.tenant_id;
        if (!tenant) throw new Error("Usuário sem empresa vinculada");
        const { error } = await supabase.from("vendedor_comissao_regras").insert({
          tenant_id: tenant,
          vendedor_id: editId,
          percentual: perc,
          base: form.base,
          venda_minima: minimo,
          ativo: form.regra_ativa,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Cadastro do vendedor salvo");
      qc.invalidateQueries({ queryKey: ["vendedores"] });
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      qc.invalidateQueries({ queryKey: ["comissoes"] });
      setAberto(false);
      setEditId(null);
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Cadastro de vendedores"
        description="Dados pessoais, cargo, admissão e demissão, percentual de comissão e permissão de vender produtos de outras lojas."
      />

      <div className="mb-4 flex items-center gap-3">
        <Switch
          id="somente-ativos"
          checked={somenteAtivos}
          onCheckedChange={(v) => setSomenteAtivos(Boolean(v))}
        />
        <Label htmlFor="somente-ativos" className="text-sm">
          Mostrar somente vendedores ativos
        </Label>
      </div>

      {isLoading ? (
        <div className="panel h-60 animate-pulse" />
      ) : vendedores.length === 0 ? (
        <EmptyState
          title="Nenhum vendedor encontrado."
          description="Em Usuários e perfis, dê o perfil de vendedor à pessoa; ela aparece aqui para você completar o cadastro."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendedor</TableHead>
                <TableHead className="w-20">Código</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
                <TableHead>Outras lojas</TableHead>
                <TableHead>Admissão</TableHead>
                <TableHead>Demissão</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendedores.map((v) => {
                const r = regraDe(v.id);
                return (
                  <TableRow key={v.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="size-8">
                          <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                            {initials(v.nome)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{v.nome || "Sem nome"}</p>
                          <p className="text-xs text-muted-foreground">{v.email ?? "—"}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{v.codigo ?? "—"}</TableCell>
                    <TableCell className="text-sm">{v.cargo ?? "—"}</TableCell>
                    <TableCell className="text-sm">{v.telefone ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {session?.filiais.find((f) => f.id === v.filial_id)?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-numeric text-right">
                      {r && r.ativo ? (
                        <span>
                          {num(r.percentual, 2)}%{" "}
                          <span className="text-xs text-muted-foreground">
                            {r.base === "lucro" ? "do lucro" : "da venda"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {v.vender_outras_lojas ? (
                        <Badge variant="secondary">
                          <Store className="mr-1 size-3" /> Liberado
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">Só a própria</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {v.data_admissao ? dateBR(v.data_admissao) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {v.data_demissao ? dateBR(v.data_demissao) : "—"}
                    </TableCell>
                    <TableCell>
                      {v.ativo && !v.data_demissao ? (
                        <span className="inline-flex items-center gap-1 text-sm text-success">
                          <Check className="size-3.5" /> Ativo
                        </span>
                      ) : (
                        <Badge variant="outline">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!podeEditar}
                        onClick={() => editar(v.id)}
                      >
                        <Pencil className="mr-1 size-4" /> Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {!podeEditar && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <UserCog className="size-4" /> Somente administrador ou gestor altera o cadastro do
          vendedor.
        </p>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cadastro do vendedor</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label>Nome</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              />
            </div>
            <div>
              <Label>Código (usado no orçamento e no pedido)</Label>
              <Input
                className="font-mono"
                placeholder="001"
                value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
              />
            </div>
            <div>
              <Label>Cargo</Label>
              <Input
                placeholder="Vendedor interno, balcão, externo..."
                value={form.cargo}
                onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))}
              />
            </div>
            <div>
              <Label>Telefone de contato</Label>
              <Input
                inputMode="tel"
                placeholder="(16) 90000-0000"
                value={form.telefone}
                onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
              />
            </div>
            <div>
              <Label>Loja</Label>
              <Select
                value={form.filial_id || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, filial_id: v === "none" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a loja" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem loja definida</SelectItem>
                  {(session?.filiais ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Data de admissão</Label>
              <Input
                type="date"
                value={form.data_admissao}
                onChange={(e) => setForm((f) => ({ ...f, data_admissao: e.target.value }))}
              />
            </div>
            <div>
              <Label>Data de demissão (deixe vazio se está na equipe)</Label>
              <Input
                type="date"
                value={form.data_demissao}
                onChange={(e) => setForm((f) => ({ ...f, data_demissao: e.target.value }))}
              />
            </div>

            <div>
              <Label>Comissão (%)</Label>
              <Input
                inputMode="decimal"
                value={form.percentual}
                onChange={(e) => setForm((f) => ({ ...f, percentual: e.target.value }))}
              />
            </div>
            <div>
              <Label>Comissão calculada sobre</Label>
              <Select value={form.base} onValueChange={(v) => setForm((f) => ({ ...f, base: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="venda">Valor da venda</SelectItem>
                  <SelectItem value="lucro">Lucro da venda</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Venda mínima para comissionar (R$)</Label>
              <Input
                inputMode="decimal"
                value={form.venda_minima}
                onChange={(e) => setForm((f) => ({ ...f, venda_minima: e.target.value }))}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3 md:col-span-2">
              <div>
                <p className="text-sm font-medium">Pode vender produtos de outras lojas</p>
                <p className="text-xs text-muted-foreground">
                  Libera a venda com saída pelo depósito de outra loja da rede.
                </p>
              </div>
              <Switch
                checked={form.vender_outras_lojas}
                onCheckedChange={(v) => setForm((f) => ({ ...f, vender_outras_lojas: Boolean(v) }))}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <Label>Vendedor ativo</Label>
              <Switch
                checked={form.ativo && !form.data_demissao}
                disabled={Boolean(form.data_demissao)}
                onCheckedChange={(v) => setForm((f) => ({ ...f, ativo: Boolean(v) }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <Label>Regra de comissão ativa</Label>
              <Switch
                checked={form.regra_ativa}
                onCheckedChange={(v) => setForm((f) => ({ ...f, regra_ativa: Boolean(v) }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar cadastro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
