import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardHat, Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR, num } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/tecnicos")({
  head: () => ({
    meta: [
      { title: "Cadastro de técnicos — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Cadastro dos técnicos da assistência: nome, cargo, especialidade, contato, loja, valor da hora, comissão e situação.",
      },
      { property: "og:title", content: "Cadastro de técnicos — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Técnicos da assistência técnica com contato, valor da hora e comissão.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TecnicosModulo,
});

type Form = {
  id?: string;
  nome: string;
  cargo: string;
  especialidade: string;
  telefone: string;
  email: string;
  documento: string;
  filial_id: string;
  custo_hora: string;
  comissao_percentual: string;
  admissao: string;
  demissao: string;
  ativo: boolean;
  observacoes: string;
};

const vazio: Form = {
  nome: "",
  cargo: "Técnico",
  especialidade: "",
  telefone: "",
  email: "",
  documento: "",
  filial_id: "",
  custo_hora: "0",
  comissao_percentual: "0",
  admissao: "",
  demissao: "",
  ativo: true,
  observacoes: "",
};

const dec = (v: string) => Number((v || "0").replace(",", ".")) || 0;

function Tecnicos() {
  const { data: session } = useSessionData();
  const profile = session?.profile;
  const filiais = session?.filiais ?? [];
  const podeEditar = (session?.roles ?? []).some((r) => ["administrador", "gestor"].includes(r));
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const { data: tecnicos = [], isLoading } = useQuery({
    queryKey: ["tecnicos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tecnicos")
        .select("*, filiais(nome)")
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return tecnicos;
    return tecnicos.filter((x) =>
      [x.nome, x.cargo, x.especialidade, x.telefone, x.email]
        .filter(Boolean)
        .some((c) => String(c).toLowerCase().includes(t)),
    );
  }, [tecnicos, busca]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id) throw new Error("Usuário sem empresa vinculada");
      if (!form.nome.trim()) throw new Error("Informe o nome do técnico");
      const payload = {
        tenant_id: profile.tenant_id,
        empresa_id: profile.empresa_id ?? null,
        filial_id: form.filial_id || profile.filial_id || null,
        nome: form.nome.trim(),
        cargo: form.cargo || null,
        especialidade: form.especialidade || null,
        telefone: form.telefone || null,
        email: form.email || null,
        documento: form.documento || null,
        custo_hora: dec(form.custo_hora),
        comissao_percentual: dec(form.comissao_percentual),
        admissao: form.admissao || null,
        demissao: form.demissao || null,
        ativo: form.ativo,
        observacoes: form.observacoes || null,
      };
      if (form.id) {
        const { error } = await supabase.from("tecnicos").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("tecnicos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Técnico atualizado." : "Técnico cadastrado.");
      setAberto(false);
      setForm(vazio);
      void queryClient.invalidateQueries({ queryKey: ["tecnicos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ativos = tecnicos.filter((t) => t.ativo);

  return (
    <div>
      <PageHeader
        title="Técnicos"
        description="Quem atende as ordens de serviço: cargo, especialidade, contato, loja, valor da hora e comissão."
        actions={
          podeEditar ? (
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo técnico
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Técnicos ativos" value={String(ativos.length)} icon={HardHat} />
        <StatCard label="Inativos" value={String(tecnicos.length - ativos.length)} tone="warning" />
        <StatCard
          label="Valor médio da hora"
          value={brl(
            ativos.length
              ? ativos.reduce((s, t) => s + Number(t.custo_hora ?? 0), 0) / ativos.length
              : 0,
          )}
          tone="accent"
        />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, cargo, especialidade ou contato"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum técnico cadastrado."
          description="Cadastre os técnicos para apontar quem fez cada reparo nas ordens de serviço."
          action={
            podeEditar ? (
              <Button
                onClick={() => {
                  setForm(vazio);
                  setAberto(true);
                }}
              >
                <Plus className="size-4" /> Novo técnico
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Técnico</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Especialidade</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead className="text-right">Hora</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
                <TableHead>Admissão</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{t.cargo ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{t.especialidade ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{t.filiais?.nome ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {[t.telefone, t.email].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(t.custo_hora ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {num(Number(t.comissao_percentual ?? 0), 2)}%
                  </TableCell>
                  <TableCell className="text-muted-foreground">{dateBR(t.admissao)}</TableCell>
                  <TableCell>
                    {t.ativo ? (
                      <Badge className="bg-success/15 text-success">Ativo</Badge>
                    ) : (
                      <Badge variant="outline">Inativo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {podeEditar && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setForm({
                            id: t.id,
                            nome: t.nome,
                            cargo: t.cargo ?? "",
                            especialidade: t.especialidade ?? "",
                            telefone: t.telefone ?? "",
                            email: t.email ?? "",
                            documento: t.documento ?? "",
                            filial_id: t.filial_id ?? "",
                            custo_hora: String(t.custo_hora ?? 0),
                            comissao_percentual: String(t.comissao_percentual ?? 0),
                            admissao: t.admissao ?? "",
                            demissao: t.demissao ?? "",
                            ativo: t.ativo,
                            observacoes: t.observacoes ?? "",
                          });
                          setAberto(true);
                        }}
                      >
                        <Pencil className="size-4" /> Editar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar técnico" : "Novo técnico"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Nome</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div>
              <Label>Cargo</Label>
              <Input
                value={form.cargo}
                placeholder="Técnico, auxiliar, eletricista"
                onChange={(e) => setForm({ ...form, cargo: e.target.value })}
              />
            </div>
            <div>
              <Label>Especialidade</Label>
              <Input
                value={form.especialidade}
                placeholder="Ferramentas elétricas"
                onChange={(e) => setForm({ ...form, especialidade: e.target.value })}
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
              <Label>E-mail</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <Label>CPF ou documento</Label>
              <Input
                value={form.documento}
                onChange={(e) => setForm({ ...form, documento: e.target.value })}
              />
            </div>
            <div>
              <Label>Loja</Label>
              <Select
                value={form.filial_id || "sem"}
                onValueChange={(v) => setForm({ ...form, filial_id: v === "sem" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sem">Sem loja definida</SelectItem>
                  {filiais.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor da hora</Label>
              <Input
                value={form.custo_hora}
                onChange={(e) => setForm({ ...form, custo_hora: e.target.value })}
              />
            </div>
            <div>
              <Label>Comissão (%)</Label>
              <Input
                value={form.comissao_percentual}
                onChange={(e) => setForm({ ...form, comissao_percentual: e.target.value })}
              />
            </div>
            <div>
              <Label>Admissão</Label>
              <Input
                type="date"
                value={form.admissao}
                onChange={(e) => setForm({ ...form, admissao: e.target.value })}
              />
            </div>
            <div>
              <Label>Saída</Label>
              <Input
                type="date"
                value={form.demissao}
                onChange={(e) => setForm({ ...form, demissao: e.target.value })}
              />
            </div>
            <div>
              <Label>Situação</Label>
              <Select
                value={form.ativo ? "ativo" : "inativo"}
                onValueChange={(v) => setForm({ ...form, ativo: v === "ativo" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Observações</Label>
              <Textarea
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** O módulo só abre quando o CNAE da empresa permite. */
function TecnicosModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.assistencia) return <ModuloBloqueado modulo="assistencia" />;
  return <Tecnicos />;
}
