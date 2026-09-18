import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { dateBR } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { ClienteCombobox } from "@/components/app/ClienteCombobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/obras")({
  head: () => ({
    meta: [
      { title: "Obras — Ze Obra" },
      { name: "description", content: "Obras vinculadas aos clientes, com responsável e situação." },
      { property: "og:title", content: "Obras — Ze Obra" },
      { property: "og:description", content: "Acompanhe as obras atendidas pela loja." },
    ],
  }),
  component: Obras,
});

const situacoes = [
  { value: "planejamento", label: "Planejamento" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "pausada", label: "Pausada" },
  { value: "concluida", label: "Concluída" },
  { value: "cancelada", label: "Cancelada" },
];

type Form = {
  id?: string;
  cliente_id: string;
  nome: string;
  situacao: string;
  responsavel: string;
  telefone: string;
  cep: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  data_inicio: string;
  previsao_termino: string;
  observacoes: string;
};

const vazio: Form = {
  cliente_id: "",
  nome: "",
  situacao: "planejamento",
  responsavel: "",
  telefone: "",
  cep: "",
  endereco: "",
  numero: "",
  bairro: "",
  cidade: "",
  estado: "",
  data_inicio: "",
  previsao_termino: "",
  observacoes: "",
};

function Obras() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const { data, isLoading } = useQuery({
    queryKey: ["obras"],
    queryFn: async () => {
      const [obras, clientes] = await Promise.all([
        supabase.from("obras").select("*, clientes(nome)").order("nome"),
        supabase.from("clientes").select("id, nome").eq("ativo", true).order("nome"),
      ]);
      return { obras: obras.data ?? [], clientes: clientes.data ?? [] };
    },
  });

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data?.obras ?? []).filter((o) => {
      if (filtro !== "todas" && o.situacao !== filtro) return false;
      if (!termo) return true;
      const cliente = (o.clientes as unknown as { nome: string } | null)?.nome ?? "";
      return [o.nome, cliente, o.cidade, o.responsavel]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo));
    });
  }, [data, busca, filtro]);

  const salvar = useMutation({
    mutationFn: async () => {
      const payload = {
        tenant_id: session?.profile?.tenant_id as string,
        cliente_id: form.cliente_id,
        nome: form.nome,
        situacao: form.situacao as "planejamento",
        responsavel: form.responsavel || null,
        telefone: form.telefone || null,
        cep: form.cep || null,
        endereco: form.endereco || null,
        numero: form.numero || null,
        bairro: form.bairro || null,
        cidade: form.cidade || null,
        estado: form.estado || null,
        data_inicio: form.data_inicio || null,
        previsao_termino: form.previsao_termino || null,
        observacoes: form.observacoes || null,
      };
      const { error } = form.id
        ? await supabase.from("obras").update(payload).eq("id", form.id)
        : await supabase.from("obras").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Obra salva");
      setOpen(false);
      setForm(vazio);
      qc.invalidateQueries({ queryKey: ["obras"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const cores: Record<string, string> = {
    planejamento: "bg-info/15 text-info",
    em_andamento: "bg-success/15 text-success",
    pausada: "bg-warning/20 text-warning-foreground",
    concluida: "bg-secondary text-secondary-foreground",
    cancelada: "bg-destructive/15 text-destructive",
  };

  return (
    <>
      <PageHeader
        title="Obras"
        description="Cada cliente pode ter várias obras; orçamentos e entregas serão vinculados a elas."
        actions={
          <Button
            onClick={() => {
              setForm(vazio);
              setOpen(true);
            }}
          >
            <Plus className="mr-2 size-4" /> Nova obra
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Obra, cliente, responsável…"
            className="pl-8"
          />
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as situações</SelectItem>
            {situacoes.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="panel h-64 animate-pulse" />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhuma obra encontrada."
            description="Cadastre a obra do cliente para vincular entregas e pedidos."
            action={
              <Button
                onClick={() => {
                  setForm(vazio);
                  setOpen(true);
                }}
              >
                <Plus className="mr-2 size-4" /> Nova obra
              </Button>
            }
          />
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Obra</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Endereço</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.nome}</TableCell>
                    <TableCell className="text-sm">
                      {(o.clientes as unknown as { nome: string } | null)?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[o.endereco, o.numero, o.bairro].filter(Boolean).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      <p>{o.responsavel ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{o.telefone ?? ""}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {dateBR(o.data_inicio)} → {dateBR(o.previsao_termino)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-medium capitalize ${cores[o.situacao] ?? "bg-secondary"}`}
                      >
                        {o.situacao.replace(/_/g, " ")}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Editar"
                        onClick={() => {
                          setForm({
                            id: o.id,
                            cliente_id: o.cliente_id,
                            nome: o.nome,
                            situacao: o.situacao,
                            responsavel: o.responsavel ?? "",
                            telefone: o.telefone ?? "",
                            cep: o.cep ?? "",
                            endereco: o.endereco ?? "",
                            numero: o.numero ?? "",
                            bairro: o.bairro ?? "",
                            cidade: o.cidade ?? "",
                            estado: o.estado ?? "",
                            data_inicio: o.data_inicio ?? "",
                            previsao_termino: o.previsao_termino ?? "",
                            observacoes: o.observacoes ?? "",
                          });
                          setOpen(true);
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
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar obra" : "Nova obra"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Cliente (digite o nome)</Label>
                <ClienteCombobox
                  clientes={data?.clientes ?? []}
                  value={form.cliente_id}
                  onChange={(v) => setForm({ ...form, cliente_id: v })}
                />
              </div>
              <div>
                <Label htmlFor="o-nome">Nome da obra</Label>
                <Input
                  id="o-nome"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <Label htmlFor="o-cep">CEP</Label>
                <Input id="o-cep" value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="o-end">Endereço</Label>
                <Input
                  id="o-end"
                  value={form.endereco}
                  onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="o-num">Número</Label>
                <Input
                  id="o-num"
                  value={form.numero}
                  onChange={(e) => setForm({ ...form, numero: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="o-bai">Bairro</Label>
                <Input
                  id="o-bai"
                  value={form.bairro}
                  onChange={(e) => setForm({ ...form, bairro: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="o-cid">Cidade</Label>
                <Input
                  id="o-cid"
                  value={form.cidade}
                  onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="o-uf">Estado</Label>
                <Input
                  id="o-uf"
                  maxLength={2}
                  value={form.estado}
                  onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <Label htmlFor="o-resp">Responsável</Label>
                <Input
                  id="o-resp"
                  value={form.responsavel}
                  onChange={(e) => setForm({ ...form, responsavel: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="o-tel">Telefone</Label>
                <Input
                  id="o-tel"
                  value={form.telefone}
                  onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="o-ini">Início</Label>
                <Input
                  id="o-ini"
                  type="date"
                  value={form.data_inicio}
                  onChange={(e) => setForm({ ...form, data_inicio: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="o-fim">Previsão de término</Label>
                <Input
                  id="o-fim"
                  type="date"
                  value={form.previsao_termino}
                  onChange={(e) => setForm({ ...form, previsao_termino: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Situação</Label>
                <Select value={form.situacao} onValueChange={(v) => setForm({ ...form, situacao: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {situacoes.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="o-obs">Observações</Label>
                <Textarea
                  id="o-obs"
                  value={form.observacoes}
                  onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => salvar.mutate()}
              disabled={!form.nome.trim() || !form.cliente_id || salvar.isPending}
            >
              Salvar obra
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="mt-4 text-xs text-muted-foreground">
        <Badge variant="outline" className="mr-2">
          Fase 2
        </Badge>
        Orçamentos, pedidos e entregas passarão a ser vinculados a estas obras.
      </p>
    </>
  );
}
