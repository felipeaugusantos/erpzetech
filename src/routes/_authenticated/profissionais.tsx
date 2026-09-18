import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, HardHat, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR, num } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/profissionais")({
  head: () => ({
    meta: [
      { title: "Profissionais e premiações — Ze Obra" },
      {
        name: "description",
        content:
          "Cadastre pedreiros, engenheiros e arquitetos que indicam a loja e pague a premiação por porcentagem das vendas indicadas.",
      },
      { property: "og:title", content: "Profissionais e premiações — Ze Obra" },
      {
        property: "og:description",
        content: "Programa de indicação com percentual de premiação por venda.",
      },
    ],
  }),
  component: Profissionais,
});

const TIPOS = [
  "pedreiro",
  "engenheiro",
  "arquiteto",
  "mestre_de_obras",
  "eletricista",
  "encanador",
  "pintor",
  "outro",
];

const SIT_PREMIO: Record<string, string> = {
  a_aprovar: "A aprovar",
  aprovada: "Aprovada",
  paga: "Paga",
  cancelada: "Cancelada",
};

function Profissionais() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const tenantId = session?.profile?.tenant_id ?? null;
  const empresaId = session?.profile?.empresa_id ?? session?.empresa?.id ?? null;
  const podeAprovar =
    session?.roles.some((r) => ["administrador", "gestor"].includes(r)) ?? false;

  const { data, isLoading } = useQuery({
    queryKey: ["profissionais"],
    queryFn: async () => {
      const [profRes, premRes, cliRes] = await Promise.all([
        supabase.from("profissionais").select("*").order("nome"),
        supabase
          .from("premiacoes")
          .select("*, profissionais(nome), clientes(nome), pedidos(numero)")
          .order("created_at", { ascending: false }),
        supabase.from("clientes").select("id, nome, profissional_id").order("nome"),
      ]);
      return {
        profissionais: profRes.data ?? [],
        premiacoes: premRes.data ?? [],
        clientes: cliRes.data ?? [],
      };
    },
  });

  const profissionais = data?.profissionais ?? [];
  const premiacoes = data?.premiacoes ?? [];
  const clientes = data?.clientes ?? [];

  const resumo = useMemo(() => {
    let aPagar = 0;
    let pago = 0;
    for (const p of premiacoes) {
      if (p.situacao === "paga") pago += Number(p.valor);
      else if (p.situacao !== "cancelada") aPagar += Number(p.valor);
    }
    return { aPagar, pago };
  }, [premiacoes]);

  const indicacoesPorProf = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const c of clientes) {
      if (!c.profissional_id) continue;
      mapa.set(c.profissional_id, (mapa.get(c.profissional_id) ?? 0) + 1);
    }
    return mapa;
  }, [clientes]);

  /** Saldo de cada profissional: a receber (a aprovar + aprovada) e já pago. */
  const saldoPorProf = useMemo(() => {
    const mapa = new Map<string, { aReceber: number; pago: number; vendas: number }>();
    for (const p of premiacoes) {
      if (!p.profissional_id) continue;
      const atual = mapa.get(p.profissional_id) ?? { aReceber: 0, pago: 0, vendas: 0 };
      if (p.situacao === "paga") atual.pago += Number(p.valor);
      else if (p.situacao !== "cancelada") atual.aReceber += Number(p.valor);
      if (p.situacao !== "cancelada") atual.vendas += Number(p.valor_base);
      mapa.set(p.profissional_id, atual);
    }
    return mapa;
  }, [premiacoes]);

  /* ---------- cadastro ---------- */
  const vazio = {
    nome: "",
    tipo: "pedreiro",
    cpf: "",
    telefone: "",
    whatsapp: "",
    email: "",
    chave_pix: "",
    percentual_premio: "2",
  };
  const [aberto, setAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState(vazio);

  function novo() {
    setEditandoId(null);
    setForm(vazio);
    setAberto(true);
  }

  function editar(p: (typeof profissionais)[number]) {
    setEditandoId(p.id);
    setForm({
      nome: p.nome,
      tipo: p.tipo,
      cpf: p.cpf ?? "",
      telefone: p.telefone ?? "",
      whatsapp: p.whatsapp ?? "",
      email: p.email ?? "",
      chave_pix: p.chave_pix ?? "",
      percentual_premio: String(p.percentual_premio),
    });
    setAberto(true);
  }

  const salvar = useMutation({
    mutationFn: async () => {
      if (form.nome.trim().length < 2) throw new Error("Informe o nome do profissional");
      const perc = Number(form.percentual_premio.replace(",", "."));
      if (!Number.isFinite(perc) || perc < 0 || perc > 100)
        throw new Error("Percentual de premiação inválido");
      const valores = {
        nome: form.nome.trim(),
        tipo: form.tipo,
        cpf: form.cpf.trim() || null,
        telefone: form.telefone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        email: form.email.trim() || null,
        chave_pix: form.chave_pix.trim() || null,
        percentual_premio: perc,
      };
      if (editandoId) {
        const { error } = await supabase.from("profissionais").update(valores).eq("id", editandoId);
        if (error) throw error;
      } else {
        if (!tenantId) throw new Error("Empresa não identificada");
        const { error } = await supabase
          .from("profissionais")
          .insert({ tenant_id: tenantId, empresa_id: empresaId, ...valores });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Profissional salvo");
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["profissionais"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const gerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("gerar_premiacoes");
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (qtd) => {
      toast.success(
        qtd > 0 ? `${qtd} premiação(ões) gerada(s)` : "Nenhuma nova venda indicada para premiar",
      );
      qc.invalidateQueries({ queryKey: ["profissionais"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const mudarSituacao = useMutation({
    mutationFn: async ({ id, situacao }: { id: string; situacao: string }) => {
      const { error } = await supabase
        .from("premiacoes")
        .update({
          situacao,
          ...(situacao === "paga" ? { pago_em: new Date().toISOString().slice(0, 10) } : {}),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Premiação atualizada");
      qc.invalidateQueries({ queryKey: ["profissionais"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Profissionais e premiações"
        description="Profissionais que indicam a loja recebem um percentual das vendas dos clientes indicados."
        actions={
          <>
            <Button variant="outline" onClick={() => gerar.mutate()} disabled={gerar.isPending}>
              <RefreshCw className="mr-2 size-4" /> Gerar premiações
            </Button>
            <Button onClick={novo}>Novo profissional</Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Profissionais"
          value={String(profissionais.length)}
          hint={`${profissionais.filter((p) => p.ativo).length} ativos`}
          icon={HardHat}
          tone="accent"
        />
        <StatCard
          label="Clientes indicados"
          value={String(clientes.filter((c) => c.profissional_id).length)}
          hint="Clientes vinculados a um profissional"
          icon={Users}
        />
        <StatCard
          label="Premiações a pagar"
          value={brl(resumo.aPagar)}
          hint="A aprovar e aprovadas"
          icon={Award}
          tone="warning"
        />
        <StatCard
          label="Já pago"
          value={brl(resumo.pago)}
          hint="Premiações quitadas"
          icon={Award}
          tone="success"
        />
      </div>

      <Tabs defaultValue="premiacoes">
        <TabsList>
          <TabsTrigger value="premiacoes">Premiações</TabsTrigger>
          <TabsTrigger value="cadastro">Profissionais</TabsTrigger>
        </TabsList>

        <TabsContent value="premiacoes" className="mt-4">
          {isLoading ? (
            <div className="panel h-40 animate-pulse" />
          ) : premiacoes.length === 0 ? (
            <EmptyState
              title="Nenhuma premiação ainda."
              description="Vincule o profissional ao cliente no cadastro de clientes e clique em Gerar premiações depois da entrega do pedido."
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profissional</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Pedido</TableHead>
                    <TableHead className="text-right">Venda</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Prêmio</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {premiacoes.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm font-medium">
                        {p.profissionais?.nome ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">{p.clientes?.nome ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {p.pedidos?.numero ? `nº ${p.pedidos.numero}` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(Number(p.valor_base))}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {num(Number(p.percentual), 1)}%
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(Number(p.valor))}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            p.situacao === "paga"
                              ? "default"
                              : p.situacao === "cancelada"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {SIT_PREMIO[p.situacao] ?? p.situacao}
                        </Badge>
                        {p.pago_em && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {dateBR(p.pago_em)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {podeAprovar && p.situacao === "a_aprovar" && (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                mudarSituacao.mutate({ id: p.id, situacao: "aprovada" })
                              }
                            >
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                mudarSituacao.mutate({ id: p.id, situacao: "cancelada" })
                              }
                            >
                              Recusar
                            </Button>
                          </div>
                        )}
                        {podeAprovar && p.situacao === "aprovada" && (
                          <Button
                            size="sm"
                            onClick={() => mudarSituacao.mutate({ id: p.id, situacao: "paga" })}
                          >
                            Marcar como paga
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="cadastro" className="mt-4">
          {profissionais.length === 0 ? (
            <EmptyState
              title="Nenhum profissional cadastrado."
              description="Cadastre o pedreiro, engenheiro ou arquiteto e o percentual de premiação dele."
              action={<Button onClick={novo}>Novo profissional</Button>}
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profissional</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>PIX</TableHead>
                    <TableHead className="text-right">Premiação</TableHead>
                    <TableHead className="text-right">Indicações</TableHead>
                    <TableHead className="text-right">Vendas indicadas</TableHead>
                    <TableHead className="text-right">Saldo a receber</TableHead>
                    <TableHead className="text-right">Já pago</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profissionais.map((p) => {
                    const saldo = saldoPorProf.get(p.id) ?? { aReceber: 0, pago: 0, vendas: 0 };
                    return (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm font-medium">{p.nome}</TableCell>
                      <TableCell className="text-sm capitalize">
                        {p.tipo.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[p.whatsapp || p.telefone, p.email].filter(Boolean).join(" · ") || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.chave_pix || "—"}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {num(Number(p.percentual_premio), 1)}%
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {indicacoesPorProf.get(p.id) ?? 0}
                      </TableCell>
                      <TableCell className="text-right text-numeric">{brl(saldo.vendas)}</TableCell>
                      <TableCell className="text-right text-numeric font-semibold">
                        {brl(saldo.aReceber)}
                      </TableCell>
                      <TableCell className="text-right text-numeric text-muted-foreground">
                        {brl(saldo.pago)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => editar(p)}>
                          Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editandoId ? "Editar profissional" : "Novo profissional"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Nome</Label>
              <Input
                className="mt-1"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Premiação (% da venda)</Label>
              <Input
                className="mt-1"
                inputMode="decimal"
                value={form.percentual_premio}
                onChange={(e) => setForm({ ...form, percentual_premio: e.target.value })}
              />
            </div>
            <div>
              <Label>CPF</Label>
              <Input
                className="mt-1"
                value={form.cpf}
                onChange={(e) => setForm({ ...form, cpf: e.target.value })}
              />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input
                className="mt-1"
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                className="mt-1"
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input
                className="mt-1"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Chave PIX para pagar a premiação</Label>
              <Input
                className="mt-1"
                value={form.chave_pix}
                onChange={(e) => setForm({ ...form, chave_pix: e.target.value })}
              />
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
    </>
  );
}
