import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl } from "@/lib/format";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/fornecedores")({
  head: () => ({
    meta: [
      { title: "Fornecedores — Ze Obra" },
      {
        name: "description",
        content: "Cadastro de fornecedores com contato, prazo de entrega e histórico de compras.",
      },
      { property: "og:title", content: "Fornecedores — Ze Obra" },
      { property: "og:description", content: "Fornecedores da loja de materiais de construção." },
    ],
  }),
  component: Fornecedores,
});

type Form = {
  id?: string;
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  contato: string;
  telefone: string;
  whatsapp: string;
  email: string;
  cidade: string;
  estado: string;
  prazo_entrega_dias: string;
  condicao_pagamento: string;
  ativo: boolean;
};

const vazio: Form = {
  razao_social: "",
  nome_fantasia: "",
  cnpj: "",
  contato: "",
  telefone: "",
  whatsapp: "",
  email: "",
  cidade: "",
  estado: "",
  prazo_entrega_dias: "0",
  condicao_pagamento: "",
  ativo: true,
};

function Fornecedores() {
  const { data: session } = useSessionData();
  const tenantId = session?.profile?.tenant_id ?? null;
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const { data: fornecedores = [], isLoading } = useQuery({
    queryKey: ["fornecedores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fornecedores")
        .select("*")
        .order("razao_social");
      if (error) throw error;
      return data;
    },
  });

  const { data: compras = [] } = useQuery({
    queryKey: ["compras-por-fornecedor"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compras")
        .select("fornecedor_id, total, situacao")
        .neq("situacao", "cancelado");
      if (error) throw error;
      return data;
    },
  });

  const resumo = useMemo(() => {
    const mapa = new Map<string, { qtd: number; total: number }>();
    for (const c of compras) {
      if (!c.fornecedor_id) continue;
      const atual = mapa.get(c.fornecedor_id) ?? { qtd: 0, total: 0 };
      atual.qtd += 1;
      atual.total += Number(c.total ?? 0);
      mapa.set(c.fornecedor_id, atual);
    }
    return mapa;
  }, [compras]);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return fornecedores;
    return fornecedores.filter((f) =>
      [f.razao_social, f.nome_fantasia, f.cnpj, f.cidade, f.contato]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t)),
    );
  }, [fornecedores, busca]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Usuário sem empresa vinculada");
      if (!form.razao_social.trim()) throw new Error("Informe a razão social");
      const payload = {
        tenant_id: tenantId,
        razao_social: form.razao_social.trim(),
        nome_fantasia: form.nome_fantasia || null,
        cnpj: form.cnpj || null,
        contato: form.contato || null,
        telefone: form.telefone || null,
        whatsapp: form.whatsapp || null,
        email: form.email || null,
        cidade: form.cidade || null,
        estado: form.estado || null,
        prazo_entrega_dias: Number(form.prazo_entrega_dias || 0),
        condicao_pagamento: form.condicao_pagamento || null,
        ativo: form.ativo,
      };
      if (form.id) {
        const { error } = await supabase.from("fornecedores").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("fornecedores").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Fornecedor atualizado." : "Fornecedor cadastrado.");
      setAberto(false);
      setForm(vazio);
      void queryClient.invalidateQueries({ queryKey: ["fornecedores"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalCompras = compras.reduce((s, c) => s + Number(c.total ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Fornecedores"
        description="Quem abastece a loja, com contato, prazo e histórico de compras."
        actions={
          <Button
            onClick={() => {
              setForm(vazio);
              setAberto(true);
            }}
          >
            <Plus className="size-4" /> Novo fornecedor
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Fornecedores" value={String(fornecedores.length)} icon={Building2} />
        <StatCard
          label="Ativos"
          value={String(fornecedores.filter((f) => f.ativo).length)}
          tone="success"
        />
        <StatCard label="Total comprado" value={brl(totalCompras)} tone="accent" />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, CNPJ, cidade ou contato"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum fornecedor encontrado."
          description="Cadastre os fornecedores para começar a comprar."
          action={
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo fornecedor
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Cidade</TableHead>
                <TableHead className="text-right">Prazo</TableHead>
                <TableHead className="text-right">Compras</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((f) => {
                const r = resumo.get(f.id);
                return (
                  <TableRow key={f.id}>
                    <TableCell>
                      <p className="font-medium">{f.razao_social}</p>
                      <p className="text-xs text-muted-foreground">
                        {f.nome_fantasia ?? "—"} {f.cnpj ? `· ${f.cnpj}` : ""}
                      </p>
                      {!f.ativo && (
                        <Badge className="mt-1 bg-secondary text-secondary-foreground">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {f.contato ?? "—"}
                      <p className="text-xs text-muted-foreground">{f.telefone ?? f.email ?? ""}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {f.cidade ?? "—"}
                      {f.estado ? `/${f.estado}` : ""}
                    </TableCell>
                    <TableCell className="text-right text-numeric">
                      {f.prazo_entrega_dias ?? 0} d
                    </TableCell>
                    <TableCell className="text-right text-numeric">{r?.qtd ?? 0}</TableCell>
                    <TableCell className="text-right text-numeric">{brl(r?.total ?? 0)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setForm({
                            id: f.id,
                            razao_social: f.razao_social,
                            nome_fantasia: f.nome_fantasia ?? "",
                            cnpj: f.cnpj ?? "",
                            contato: f.contato ?? "",
                            telefone: f.telefone ?? "",
                            whatsapp: f.whatsapp ?? "",
                            email: f.email ?? "",
                            cidade: f.cidade ?? "",
                            estado: f.estado ?? "",
                            prazo_entrega_dias: String(f.prazo_entrega_dias ?? 0),
                            condicao_pagamento: f.condicao_pagamento ?? "",
                            ativo: f.ativo,
                          });
                          setAberto(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Razão social</Label>
              <Input
                value={form.razao_social}
                onChange={(e) => setForm({ ...form, razao_social: e.target.value })}
              />
            </div>
            <div>
              <Label>Nome fantasia</Label>
              <Input
                value={form.nome_fantasia}
                onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })}
              />
            </div>
            <div>
              <Label>CNPJ</Label>
              <Input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} />
            </div>
            <div>
              <Label>Contato</Label>
              <Input
                value={form.contato}
                onChange={(e) => setForm({ ...form, contato: e.target.value })}
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <Label>Cidade</Label>
              <Input
                value={form.cidade}
                onChange={(e) => setForm({ ...form, cidade: e.target.value })}
              />
            </div>
            <div>
              <Label>Estado</Label>
              <Input
                maxLength={2}
                value={form.estado}
                onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <Label>Prazo de entrega (dias)</Label>
              <Input
                inputMode="numeric"
                value={form.prazo_entrega_dias}
                onChange={(e) => setForm({ ...form, prazo_entrega_dias: e.target.value })}
              />
            </div>
            <div>
              <Label>Condição de pagamento</Label>
              <Input
                placeholder="Ex.: 28 dias"
                value={form.condicao_pagamento}
                onChange={(e) => setForm({ ...form, condicao_pagamento: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                id="ativo"
              />
              <Label htmlFor="ativo">Fornecedor ativo</Label>
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
