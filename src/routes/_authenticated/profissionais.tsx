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
      { title: "Profissionais e premiações — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Cadastre pedreiros, engenheiros e arquitetos que indicam a loja e pague a premiação por porcentagem das vendas indicadas.",
      },
      { property: "og:title", content: "Profissionais e premiações — ERP Ze Tech" },
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
      const [profRes, premRes, cliRes, abatRes, contasRes] = await Promise.all([
        supabase.from("profissionais").select("*").order("nome"),
        supabase
          .from("premiacoes")
          .select("*, profissionais(nome), clientes(nome), pedidos(numero)")
          .order("created_at", { ascending: false }),
        supabase.from("clientes").select("id, nome, profissional_id").order("nome"),
        supabase
          .from("premiacao_abatimentos")
          .select("*, profissionais(nome), contas_receber(numero, descricao, clientes(nome))")
          .order("created_at", { ascending: false }),
        supabase
          .from("contas_receber")
          .select("id, numero, descricao, valor, valor_recebido, vencimento, cliente_id, clientes(nome)")
          .in("situacao", ["aberto", "parcial"])
          .order("vencimento"),
      ]);
      return {
        profissionais: profRes.data ?? [],
        premiacoes: premRes.data ?? [],
        clientes: cliRes.data ?? [],
        abatimentos: abatRes.data ?? [],
        contas: contasRes.data ?? [],
      };
    },
  });

  const profissionais = data?.profissionais ?? [];
  const premiacoes = data?.premiacoes ?? [];
  const clientes = data?.clientes ?? [];
  const abatimentos = data?.abatimentos ?? [];
  const contasAbertas = data?.contas ?? [];

  const resumo = useMemo(() => {
    let aPagar = 0;
    let pago = 0;
    for (const p of premiacoes) {
      if (p.situacao === "paga") pago += Number(p.valor);
      else if (p.situacao !== "cancelada") aPagar += Number(p.valor);
    }
    const usado = abatimentos.reduce((s, a) => s + Number(a.valor), 0);
    return { aPagar: Math.max(0, aPagar - usado), pago, usado };
  }, [premiacoes, abatimentos]);

  const indicacoesPorProf = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const c of clientes) {
      if (!c.profissional_id) continue;
      mapa.set(c.profissional_id, (mapa.get(c.profissional_id) ?? 0) + 1);
    }
    return mapa;
  }, [clientes]);

  /** Saldo de cada profissional: crédito a receber, já usado em contas e já pago. */
  const saldoPorProf = useMemo(() => {
    const mapa = new Map<
      string,
      { aReceber: number; pago: number; vendas: number; usado: number }
    >();
    for (const p of premiacoes) {
      if (!p.profissional_id) continue;
      const atual =
        mapa.get(p.profissional_id) ?? { aReceber: 0, pago: 0, vendas: 0, usado: 0 };
      if (p.situacao === "paga") atual.pago += Number(p.valor);
      else if (p.situacao !== "cancelada") atual.aReceber += Number(p.valor);
      if (p.situacao !== "cancelada") atual.vendas += Number(p.valor_base);
      mapa.set(p.profissional_id, atual);
    }
    for (const a of abatimentos) {
      const atual = mapa.get(a.profissional_id) ?? {
        aReceber: 0,
        pago: 0,
        vendas: 0,
        usado: 0,
      };
      atual.usado += Number(a.valor);
      atual.aReceber = Math.max(0, atual.aReceber - Number(a.valor));
      mapa.set(a.profissional_id, atual);
    }
    return mapa;
  }, [premiacoes, abatimentos]);

  /* ---------- cadastro ---------- */
  const vazio = {
    nome: "",
    codigo: "",
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
      codigo: p.codigo ?? "",
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
        codigo: form.codigo.trim() || null,
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

  /* ---------- converter em cliente ---------- */
  const converterCliente = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("profissional_converter_em_cliente", {
        p_profissional_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profissional também cadastrado como cliente");
      qc.invalidateQueries({ queryKey: ["profissionais"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["clientes-obras"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const desvincularCliente = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("profissionais")
        .update({ cliente_id: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mantido somente como profissional");
      qc.invalidateQueries({ queryKey: ["profissionais"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  /* ---------- usar crédito na conta a receber ---------- */
  const [creditoAberto, setCreditoAberto] = useState(false);
  const [credProf, setCredProf] = useState("");
  const [credConta, setCredConta] = useState("");
  const [credValor, setCredValor] = useState("");
  const [credObs, setCredObs] = useState("");

  const saldoCredProf = credProf ? (saldoPorProf.get(credProf)?.aReceber ?? 0) : 0;
  const contasDoProf = useMemo(() => {
    if (!credProf) return contasAbertas;
    const prof = profissionais.find((p) => p.id === credProf);
    const idsCliente = new Set(
      clientes.filter((c) => c.profissional_id === credProf).map((c) => c.id),
    );
    if (prof?.cliente_id) idsCliente.add(prof.cliente_id);
    const doProf = contasAbertas.filter((c) => c.cliente_id && idsCliente.has(c.cliente_id));
    return doProf.length > 0 ? doProf : contasAbertas;
  }, [credProf, contasAbertas, clientes, profissionais]);

  const contaEscolhida = contasAbertas.find((c) => c.id === credConta) ?? null;
  const saldoContaEscolhida = contaEscolhida
    ? Number(contaEscolhida.valor) - Number(contaEscolhida.valor_recebido ?? 0)
    : 0;

  function abrirCredito(profId?: string) {
    setCredProf(profId ?? "");
    setCredConta("");
    setCredValor("");
    setCredObs("");
    setCreditoAberto(true);
  }

  const usarCredito = useMutation({
    mutationFn: async () => {
      if (!credProf) throw new Error("Escolha o profissional");
      if (!credConta) throw new Error("Escolha a conta a receber");
      const v = Number(credValor.replace(",", "."));
      if (!Number.isFinite(v) || v <= 0) throw new Error("Informe um valor maior que zero");
      const { error } = await supabase.rpc("premiacao_abater_conta", {
        p_profissional_id: credProf,
        p_conta_id: credConta,
        p_valor: v,
        ...(credObs.trim() ? { p_observacao: credObs.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Crédito usado na conta a receber");
      setCreditoAberto(false);
      qc.invalidateQueries({ queryKey: ["profissionais"] });
      qc.invalidateQueries({ queryKey: ["contas-receber"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });



  return (
    <>
      <PageHeader
        title="Profissionais e premiações"
        description="O prêmio é lançado sozinho quando o pedido do cliente indicado é entregue. O botão abaixo só serve para pedidos antigos."
        actions={
          <>
            <Button variant="outline" onClick={() => gerar.mutate()} disabled={gerar.isPending}>
              <RefreshCw className="mr-2 size-4" /> Gerar premiações
            </Button>
            <Button variant="outline" onClick={() => abrirCredito()}>
              Usar crédito em conta
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
          label="Crédito disponível"
          value={brl(resumo.aPagar)}
          hint="Pode ser pago ou usado em conta"
          icon={Award}
          tone="warning"
        />
        <StatCard
          label="Usado em contas"
          value={brl(resumo.usado)}
          hint={`Já pago em dinheiro: ${brl(resumo.pago)}`}
          icon={Award}
          tone="success"
        />
      </div>

      <Tabs defaultValue="premiacoes">
        <TabsList>
          <TabsTrigger value="premiacoes">Premiações</TabsTrigger>
          <TabsTrigger value="cadastro">Profissionais</TabsTrigger>
          <TabsTrigger value="credito">Crédito usado</TabsTrigger>
        </TabsList>

        <TabsContent value="credito" className="mt-4">
          {abatimentos.length === 0 ? (
            <EmptyState
              title="Nenhum crédito usado ainda."
              description="Use o botão “Usar crédito em conta” para abater a premiação do profissional em uma conta a receber."
              action={<Button onClick={() => abrirCredito()}>Usar crédito em conta</Button>}
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Profissional</TableHead>
                    <TableHead>Conta</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Valor abatido</TableHead>
                    <TableHead>Observação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {abatimentos.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm">{dateBR(a.data)}</TableCell>
                      <TableCell className="text-sm font-medium">
                        {a.profissionais?.nome ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {a.contas_receber?.numero ? `nº ${a.contas_receber.numero}` : "—"}
                        {a.contas_receber?.descricao ? ` · ${a.contas_receber.descricao}` : ""}
                      </TableCell>
                      <TableCell className="text-sm">
                        {a.contas_receber?.clientes?.nome ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-numeric font-semibold">
                        {brl(Number(a.valor))}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {a.observacao ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>


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
                    <TableHead className="text-right">Crédito disponível</TableHead>
                    <TableHead className="text-right">Usado em conta</TableHead>
                    <TableHead>Também é cliente</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profissionais.map((p) => {
                    const saldo =
                      saldoPorProf.get(p.id) ?? { aReceber: 0, pago: 0, vendas: 0, usado: 0 };
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
                        {brl(saldo.usado)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {p.cliente_id ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="default">Sim</Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => desvincularCliente.mutate(p.id)}
                            >
                              Só profissional
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={converterCliente.isPending}
                            onClick={() => converterCliente.mutate(p.id)}
                          >
                            Converter em cliente
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {saldo.aReceber > 0 && (
                            <Button size="sm" onClick={() => abrirCredito(p.id)}>
                              Usar crédito
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => editar(p)}>
                            Editar
                          </Button>
                        </div>
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
            <div>
              <Label>Nome</Label>
              <Input
                className="mt-1"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div>
              <Label>Código (usado no orçamento e no pedido)</Label>
              <Input
                className="mt-1 font-mono"
                placeholder="Ex.: 001"
                value={form.codigo}
                onChange={(e) => setForm({ ...form, codigo: e.target.value })}
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
            {editandoId && (
              <div className="panel sm:col-span-2 flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium">Também é cliente da loja?</p>
                  <p className="text-xs text-muted-foreground">
                    Como cliente ele pode comprar, ter obras e receber notas; como profissional ele
                    só indica e recebe premiação.
                  </p>
                </div>
                {profissionais.find((p) => p.id === editandoId)?.cliente_id ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="default">Cliente vinculado</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => desvincularCliente.mutate(editandoId)}
                    >
                      Manter só como profissional
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={converterCliente.isPending}
                    onClick={() => converterCliente.mutate(editandoId)}
                  >
                    Converter em cliente
                  </Button>
                )}
              </div>
            )}
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

      <Dialog open={creditoAberto} onOpenChange={setCreditoAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Usar crédito do profissional em conta a receber</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Profissional</Label>
              <Select value={credProf} onValueChange={setCredProf}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Escolha o profissional" />
                </SelectTrigger>
                <SelectContent>
                  {profissionais.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome} — {brl(saldoPorProf.get(p.id)?.aReceber ?? 0)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {credProf && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Crédito disponível: <strong>{brl(saldoCredProf)}</strong>
                </p>
              )}
            </div>
            <div>
              <Label>Conta a receber</Label>
              <Select value={credConta} onValueChange={setCredConta}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Escolha a conta em aberto" />
                </SelectTrigger>
                <SelectContent>
                  {contasDoProf.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      nº {c.numero} · {c.clientes?.nome ?? "Sem cliente"} ·{" "}
                      {brl(Number(c.valor) - Number(c.valor_recebido ?? 0))} · vence{" "}
                      {dateBR(c.vencimento)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {contaEscolhida && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Saldo da conta: <strong>{brl(saldoContaEscolhida)}</strong>
                </p>
              )}
            </div>
            <div>
              <Label>Valor a abater</Label>
              <Input
                className="mt-1"
                inputMode="decimal"
                placeholder="0,00"
                value={credValor}
                onChange={(e) => setCredValor(e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setCredValor(
                      String(Math.min(saldoCredProf, saldoContaEscolhida || saldoCredProf).toFixed(2)),
                    )
                  }
                  disabled={!credProf || !credConta}
                >
                  Usar o máximo possível
                </Button>
              </div>
            </div>
            <div>
              <Label>Observação</Label>
              <Input
                className="mt-1"
                placeholder="Abatimento com crédito de premiação"
                value={credObs}
                onChange={(e) => setCredObs(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditoAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => usarCredito.mutate()} disabled={usarCredito.isPending}>
              Abater na conta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
