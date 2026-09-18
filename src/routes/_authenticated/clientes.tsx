import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, num } from "@/lib/format";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes — Ze Obra" },
      {
        name: "description",
        content: "Cadastro de clientes pessoa física e jurídica com limite de crédito e obras.",
      },
      { property: "og:title", content: "Clientes — Ze Obra" },
      { property: "og:description", content: "Gestão de clientes da loja de materiais." },
    ],
  }),
  component: Clientes,
});

type FormState = {
  id?: string;
  tipo: "PF" | "PJ";
  nome: string;
  nome_fantasia: string;
  cpf: string;
  cnpj: string;
  inscricao_estadual: string;
  telefone: string;
  whatsapp: string;
  email: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  limite_credito: string;
  saldo_utilizado: string;
  prazo_padrao_dias: string;
  desconto_maximo: string;
  observacoes: string;
};

const vazio: FormState = {
  tipo: "PF",
  nome: "",
  nome_fantasia: "",
  cpf: "",
  cnpj: "",
  inscricao_estadual: "",
  telefone: "",
  whatsapp: "",
  email: "",
  cep: "",
  endereco: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  estado: "",
  limite_credito: "0",
  saldo_utilizado: "0",
  prazo_padrao_dias: "0",
  desconto_maximo: "0",
  observacoes: "",
};

function Clientes() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(vazio);

  const { data, isLoading } = useQuery({
    queryKey: ["clientes"],
    queryFn: async () => {
      const [cli, obras] = await Promise.all([
        supabase.from("clientes").select("*").eq("ativo", true).order("nome"),
        supabase.from("obras").select("id, cliente_id"),
      ]);
      const obrasPorCliente = new Map<string, number>();
      for (const o of obras.data ?? [])
        obrasPorCliente.set(o.cliente_id, (obrasPorCliente.get(o.cliente_id) ?? 0) + 1);
      return { clientes: cli.data ?? [], obrasPorCliente };
    },
  });

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data?.clientes ?? []).filter((c) => {
      if (filtro !== "todos" && c.tipo !== filtro) return false;
      if (!termo) return true;
      return [c.nome, c.nome_fantasia, c.cpf, c.cnpj, c.telefone, c.email, c.cidade]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo));
    });
  }, [data, busca, filtro]);

  const salvar = useMutation({
    mutationFn: async () => {
      const payload = {
        tenant_id: session?.profile?.tenant_id as string,
        empresa_id: session?.profile?.empresa_id ?? null,
        filial_id: session?.profile?.filial_id ?? null,
        tipo: form.tipo,
        nome: form.nome,
        nome_fantasia: form.nome_fantasia || null,
        cpf: form.cpf || null,
        cnpj: form.cnpj || null,
        inscricao_estadual: form.inscricao_estadual || null,
        telefone: form.telefone || null,
        whatsapp: form.whatsapp || null,
        email: form.email || null,
        cep: form.cep || null,
        endereco: form.endereco || null,
        numero: form.numero || null,
        complemento: form.complemento || null,
        bairro: form.bairro || null,
        cidade: form.cidade || null,
        estado: form.estado || null,
        limite_credito: Number(form.limite_credito || 0),
        saldo_utilizado: Number(form.saldo_utilizado || 0),
        prazo_padrao_dias: Number(form.prazo_padrao_dias || 0),
        desconto_maximo: Number(form.desconto_maximo || 0),
        observacoes: form.observacoes || null,
      };
      const { error } = form.id
        ? await supabase.from("clientes").update(payload).eq("id", form.id)
        : await supabase.from("clientes").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente salvo");
      setOpen(false);
      setForm(vazio);
      qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  function editar(c: Record<string, unknown>) {
    setForm({
      id: c["id"] as string,
      tipo: c["tipo"] as "PF" | "PJ",
      nome: (c["nome"] as string) ?? "",
      nome_fantasia: (c["nome_fantasia"] as string) ?? "",
      cpf: (c["cpf"] as string) ?? "",
      cnpj: (c["cnpj"] as string) ?? "",
      inscricao_estadual: (c["inscricao_estadual"] as string) ?? "",
      telefone: (c["telefone"] as string) ?? "",
      whatsapp: (c["whatsapp"] as string) ?? "",
      email: (c["email"] as string) ?? "",
      cep: (c["cep"] as string) ?? "",
      endereco: (c["endereco"] as string) ?? "",
      numero: (c["numero"] as string) ?? "",
      complemento: (c["complemento"] as string) ?? "",
      bairro: (c["bairro"] as string) ?? "",
      cidade: (c["cidade"] as string) ?? "",
      estado: (c["estado"] as string) ?? "",
      limite_credito: String(c["limite_credito"] ?? 0),
      saldo_utilizado: String(c["saldo_utilizado"] ?? 0),
      prazo_padrao_dias: String(c["prazo_padrao_dias"] ?? 0),
      desconto_maximo: String(c["desconto_maximo"] ?? 0),
      observacoes: (c["observacoes"] as string) ?? "",
    });
    setOpen(true);
  }

  const totalLimite = (data?.clientes ?? []).reduce((s, c) => s + Number(c.limite_credito), 0);
  const totalUsado = (data?.clientes ?? []).reduce((s, c) => s + Number(c.saldo_utilizado), 0);
  const acimaLimite = (data?.clientes ?? []).filter(
    (c) => Number(c.limite_credito) > 0 && Number(c.saldo_utilizado) >= Number(c.limite_credito),
  ).length;

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Pessoa física e jurídica, com controle de crédito, prazo e desconto máximo."
        actions={
          <Button
            onClick={() => {
              setForm(vazio);
              setOpen(true);
            }}
          >
            <Plus className="mr-2 size-4" /> Novo cliente
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Clientes ativos" value={num(data?.clientes.length ?? 0, 0)} />
        <StatCard label="Limite concedido" value={brl(totalLimite)} />
        <StatCard label="Crédito utilizado" value={brl(totalUsado)} tone="warning" />
        <StatCard label="No limite" value={num(acimaLimite, 0)} tone="danger" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, CPF, CNPJ, telefone…"
            className="pl-8"
          />
        </div>
        <Tabs value={filtro} onValueChange={setFiltro}>
          <TabsList>
            <TabsTrigger value="todos">Todos</TabsTrigger>
            <TabsTrigger value="PF">Pessoa física</TabsTrigger>
            <TabsTrigger value="PJ">Pessoa jurídica</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="panel h-64 animate-pulse" />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhum cliente encontrado."
            description="Cadastre um cliente para iniciar orçamentos e pedidos."
            action={
              <Button
                onClick={() => {
                  setForm(vazio);
                  setOpen(true);
                }}
              >
                <Plus className="mr-2 size-4" /> Novo cliente
              </Button>
            }
          />
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead className="min-w-40">Crédito</TableHead>
                  <TableHead className="text-right">Obras</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((c) => {
                  const limite = Number(c.limite_credito);
                  const usado = Number(c.saldo_utilizado);
                  const pct = limite > 0 ? Math.min(100, (usado / limite) * 100) : 0;
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <p className="font-medium">{c.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.nome_fantasia ?? (c.tipo === "PF" ? "Pessoa física" : "Pessoa jurídica")}
                        </p>
                      </TableCell>
                      <TableCell className="text-numeric text-sm">{c.cpf || c.cnpj || "—"}</TableCell>
                      <TableCell className="text-sm">
                        <p>{c.telefone ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{c.email ?? ""}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.cidade ? `${c.cidade}/${c.estado ?? ""}` : "—"}
                      </TableCell>
                      <TableCell>
                        {limite > 0 ? (
                          <div className="space-y-1">
                            <Progress value={pct} className="h-1.5" />
                            <p className="text-numeric text-xs text-muted-foreground">
                              {brl(usado)} de {brl(limite)} • disponível {brl(limite - usado)}
                            </p>
                          </div>
                        ) : (
                          <Badge variant="outline">Sem limite</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-numeric text-right">
                        {data?.obrasPorCliente.get(c.id) ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => editar(c)} aria-label="Editar">
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
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Tipo</Label>
                <Select
                  value={form.tipo}
                  onValueChange={(v) => setForm({ ...form, tipo: v as "PF" | "PJ" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PF">Pessoa física</SelectItem>
                    <SelectItem value="PJ">Pessoa jurídica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="c-nome">{form.tipo === "PF" ? "Nome completo" : "Razão social"}</Label>
                <Input
                  id="c-nome"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {form.tipo === "PJ" && (
                <div>
                  <Label htmlFor="c-fant">Nome fantasia</Label>
                  <Input
                    id="c-fant"
                    value={form.nome_fantasia}
                    onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })}
                  />
                </div>
              )}
              {form.tipo === "PF" ? (
                <div>
                  <Label htmlFor="c-cpf">CPF</Label>
                  <Input
                    id="c-cpf"
                    value={form.cpf}
                    onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                  />
                </div>
              ) : (
                <>
                  <div>
                    <Label htmlFor="c-cnpj">CNPJ</Label>
                    <Input
                      id="c-cnpj"
                      value={form.cnpj}
                      onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="c-ie">Inscrição estadual</Label>
                    <Input
                      id="c-ie"
                      value={form.inscricao_estadual}
                      onChange={(e) => setForm({ ...form, inscricao_estadual: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="c-tel">Telefone</Label>
                <Input
                  id="c-tel"
                  value={form.telefone}
                  onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="c-wpp">WhatsApp</Label>
                <Input
                  id="c-wpp"
                  value={form.whatsapp}
                  onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="c-mail">E-mail</Label>
                <Input
                  id="c-mail"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <Label htmlFor="c-cep">CEP</Label>
                <Input
                  id="c-cep"
                  value={form.cep}
                  onChange={(e) => setForm({ ...form, cep: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="c-end">Endereço</Label>
                <Input
                  id="c-end"
                  value={form.endereco}
                  onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="c-num">Número</Label>
                <Input
                  id="c-num"
                  value={form.numero}
                  onChange={(e) => setForm({ ...form, numero: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="c-comp">Complemento</Label>
                <Input
                  id="c-comp"
                  value={form.complemento}
                  onChange={(e) => setForm({ ...form, complemento: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="c-bai">Bairro</Label>
                <Input
                  id="c-bai"
                  value={form.bairro}
                  onChange={(e) => setForm({ ...form, bairro: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="c-cid">Cidade</Label>
                <Input
                  id="c-cid"
                  value={form.cidade}
                  onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="c-uf">Estado</Label>
                <Input
                  id="c-uf"
                  maxLength={2}
                  value={form.estado}
                  onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })}
                />
              </div>
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="mb-3 text-sm font-semibold">Situação financeira</p>
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <Label htmlFor="c-lim">Limite de crédito</Label>
                  <Input
                    id="c-lim"
                    type="number"
                    step="0.01"
                    value={form.limite_credito}
                    onChange={(e) => setForm({ ...form, limite_credito: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="c-uso">Saldo utilizado</Label>
                  <Input
                    id="c-uso"
                    type="number"
                    step="0.01"
                    value={form.saldo_utilizado}
                    onChange={(e) => setForm({ ...form, saldo_utilizado: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="c-prazo">Prazo padrão (dias)</Label>
                  <Input
                    id="c-prazo"
                    type="number"
                    value={form.prazo_padrao_dias}
                    onChange={(e) => setForm({ ...form, prazo_padrao_dias: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="c-desc">Desconto máx. (%)</Label>
                  <Input
                    id="c-desc"
                    type="number"
                    step="0.01"
                    value={form.desconto_maximo}
                    onChange={(e) => setForm({ ...form, desconto_maximo: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-numeric mt-2 text-xs text-muted-foreground">
                Disponível:{" "}
                {brl(Number(form.limite_credito || 0) - Number(form.saldo_utilizado || 0))}
              </p>
            </div>

            <div>
              <Label htmlFor="c-obs">Observações</Label>
              <Textarea
                id="c-obs"
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={!form.nome.trim() || salvar.isPending}>
              Salvar cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
