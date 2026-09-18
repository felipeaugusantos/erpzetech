import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgePercent, Plus, Search, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR } from "@/lib/format";
import {
  corConta,
  estaVencida,
  formasPagamento,
  hojeISO,
  labelConta,
  labelForma,
  situacoesConta,
  somaDias,
} from "@/lib/financeiro";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { HistoricoTitulo, type TituloHistorico } from "@/components/app/HistoricoTitulo";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/contas-receber")({
  head: () => ({
    meta: [
      { title: "Contas a receber — ERP Ze Tech" },
      {
        name: "description",
        content: "Recebimentos de clientes, parcelas, vencimentos e baixas no caixa.",
      },
      { property: "og:title", content: "Contas a receber — ERP Ze Tech" },
      { property: "og:description", content: "Controle do que a loja tem para receber." },
    ],
  }),
  component: ContasReceber,
});

function ContasReceber() {
  const { data: session } = useSessionData();
  const profile = session?.profile ?? null;
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState("aberto");
  const [busca, setBusca] = useState("");
  const [novaAberta, setNovaAberta] = useState(false);
  const [baixaAberta, setBaixaAberta] = useState(false);
  const [contaId, setContaId] = useState("");
  const [saldoConta, setSaldoConta] = useState(0);
  const [valorBaixa, setValorBaixa] = useState("");
  const [formaBaixa, setFormaBaixa] = useState("pix");
  const [dataBaixa, setDataBaixa] = useState(hojeISO());
  const [obsBaixa, setObsBaixa] = useState("");
  const [usarCaixa, setUsarCaixa] = useState("nao");

  const [clienteId, setClienteId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [venc, setVenc] = useState(somaDias(hojeISO(), 30));
  const [parcelas, setParcelas] = useState("1");
  const [forma, setForma] = useState("boleto");

  const [creditoAberta, setCreditoAberta] = useState(false);
  const [credProf, setCredProf] = useState("");
  const [credValor, setCredValor] = useState("");
  const [credObs, setCredObs] = useState("");
  const [historico, setHistorico] = useState<TituloHistorico | null>(null);

  const { data: contas = [], isLoading } = useQuery({
    queryKey: ["contas-receber"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contas_receber")
        .select("*, clientes(nome, profissional_id), pedidos(numero)")
        .order("vencimento");
      if (error) throw error;
      return data;
    },
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes-lista"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  /** Crédito de premiação disponível de cada profissional, para abater nas contas. */
  const { data: creditos = [] } = useQuery({
    queryKey: ["creditos-profissionais"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profissionais")
        .select("id, nome, cliente_id")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      const lista = data ?? [];
      const saldos = await Promise.all(
        lista.map(async (p) => {
          const { data: saldo } = await supabase.rpc("profissional_saldo_credito", {
            p_profissional_id: p.id,
          });
          return { ...p, saldo: Number(saldo ?? 0) };
        }),
      );
      return saldos.filter((p) => p.saldo > 0);
    },
  });

  const { data: caixaAberto } = useQuery({
    queryKey: ["caixa-aberto"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("caixas")
        .select("id, numero")
        .eq("situacao", "aberto")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });


  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return contas.filter((c) => {
      if (filtro === "vencidas" && !estaVencida(c.situacao, c.vencimento)) return false;
      if (filtro !== "todas" && filtro !== "vencidas" && c.situacao !== filtro) return false;
      if (!t) return true;
      const cli = (c.clientes as { nome: string } | null)?.nome ?? "";
      return `${c.numero} ${cli} ${c.descricao}`.toLowerCase().includes(t);
    });
  }, [contas, filtro, busca]);

  const abertas = contas.filter((c) => ["aberto", "parcial"].includes(c.situacao));
  const saldoAberto = abertas.reduce(
    (s, c) => s + (Number(c.valor) - Number(c.valor_recebido)),
    0,
  );
  const vencidas = abertas.filter((c) => estaVencida(c.situacao, c.vencimento));
  const venceHoje = abertas.filter((c) => c.vencimento === hojeISO());
  const proximos7 = abertas.filter(
    (c) => c.vencimento > hojeISO() && c.vencimento <= somaDias(hojeISO(), 7),
  );
  const recebidoMes = contas.reduce(
    (s, c) =>
      (c.updated_at ?? "").slice(0, 7) === new Date().toISOString().slice(0, 7)
        ? s + Number(c.valor_recebido)
        : s,
    0,
  );

  const criar = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id) throw new Error("Usuário sem empresa vinculada");
      const v = Number(valor.replace(",", "."));
      if (!descricao.trim()) throw new Error("Informe a descrição");
      if (!v || v <= 0) throw new Error("Informe um valor maior que zero");
      const n = Math.max(1, Number(parcelas || 1));
      const parcela = Number((v / n).toFixed(2));
      const linhas = Array.from({ length: n }, (_, i) => ({
        tenant_id: profile.tenant_id as string,
        empresa_id: profile.empresa_id,
        filial_id: profile.filial_id,
        cliente_id: clienteId || null,
        descricao: descricao.trim(),
        parcela: i + 1,
        parcelas: n,
        vencimento: somaDias(venc, i * 30),
        valor: i === n - 1 ? Number((v - parcela * (n - 1)).toFixed(2)) : parcela,
        forma_pagamento: forma as never,
      }));
      const { error } = await supabase.from("contas_receber").insert(linhas);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conta a receber criada.");
      setNovaAberta(false);
      setDescricao("");
      setValor("");
      setParcelas("1");
      void queryClient.invalidateQueries({ queryKey: ["contas-receber"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const baixar = useMutation({
    mutationFn: async () => {
      const v = Number(valorBaixa.replace(",", "."));
      const { error } = await supabase.rpc("baixar_conta", {
        p_tipo: "receber",
        p_conta_id: contaId,
        p_valor: v,
        p_forma: formaBaixa as never,
        p_data: dataBaixa,
        p_observacao: obsBaixa,
        ...(usarCaixa === "sim" && caixaAberto ? { p_caixa_id: caixaAberto.id } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Recebimento registrado.");
      setBaixaAberta(false);
      setObsBaixa("");
      void queryClient.invalidateQueries({ queryKey: ["contas-receber"] });
      void queryClient.invalidateQueries({ queryKey: ["caixa-movimentos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("contas_receber")
        .update({ situacao: "cancelado", motivo_cancelamento: "Cancelada pelo usuário" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conta cancelada.");
      void queryClient.invalidateQueries({ queryKey: ["contas-receber"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const creditoPorProfissional = useMemo(() => {
    const m = new Map<string, { nome: string; saldo: number }>();
    for (const p of creditos) m.set(p.id, { nome: p.nome, saldo: p.saldo });
    return m;
  }, [creditos]);

  const creditoTotal = creditos.reduce((s, p) => s + p.saldo, 0);
  const saldoCredProf = credProf ? (creditoPorProfissional.get(credProf)?.saldo ?? 0) : 0;
  const contaCredito = contas.find((c) => c.id === contaId) ?? null;
  const saldoContaCredito = contaCredito
    ? Number(contaCredito.valor) - Number(contaCredito.valor_recebido)
    : 0;

  function abrirCredito(conta: (typeof contas)[number], saldo: number) {
    const prof = (conta.clientes as { profissional_id: string | null } | null)?.profissional_id ?? "";
    const sugerido = prof && creditoPorProfissional.has(prof) ? prof : (creditos[0]?.id ?? "");
    const disponivel = sugerido ? (creditoPorProfissional.get(sugerido)?.saldo ?? 0) : 0;
    setContaId(conta.id);
    setSaldoConta(saldo);
    setCredProf(sugerido);
    setCredValor(Math.min(saldo, disponivel).toFixed(2));
    setCredObs("");
    setCreditoAberta(true);
  }

  const usarCredito = useMutation({
    mutationFn: async () => {
      const v = Number(credValor.replace(",", "."));
      if (!credProf) throw new Error("Escolha o profissional");
      if (!contaId) throw new Error("Escolha a conta");
      if (!v || v <= 0) throw new Error("Informe um valor maior que zero");
      const { error } = await supabase.rpc("premiacao_abater_conta", {
        p_profissional_id: credProf,
        p_conta_id: contaId,
        p_valor: v,
        ...(credObs.trim() ? { p_observacao: credObs.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Crédito do profissional abatido na conta.");
      setCreditoAberta(false);
      void queryClient.invalidateQueries({ queryKey: ["contas-receber"] });
      void queryClient.invalidateQueries({ queryKey: ["creditos-profissionais"] });
      void queryClient.invalidateQueries({ queryKey: ["premiacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <div>
      <PageHeader
        title="Contas a receber"
        description="Parcelas dos pedidos e cobranças avulsas, com baixa no caixa."
        actions={
          <div className="flex flex-wrap gap-2">
            {creditoTotal > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  const primeira = abertas[0];
                  if (!primeira) {
                    toast.error("Nenhuma conta em aberto para abater.");
                    return;
                  }
                  abrirCredito(
                    primeira,
                    Number(primeira.valor) - Number(primeira.valor_recebido),
                  );
                }}
              >
                <BadgePercent className="size-4" /> Usar crédito do profissional
              </Button>
            )}
            <Button onClick={() => setNovaAberta(true)}>
              <Plus className="size-4" /> Nova conta
            </Button>
          </div>
        }

      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Em aberto" value={brl(saldoAberto)} icon={Wallet} />
        <StatCard
          label="Vencidas"
          value={brl(vencidas.reduce((s, c) => s + Number(c.valor) - Number(c.valor_recebido), 0))}
          hint={`${vencidas.length} conta(s)`}
          tone="danger"
          icon={AlertTriangle}
        />
        <StatCard
          label="Vence hoje"
          value={brl(venceHoje.reduce((s, c) => s + Number(c.valor) - Number(c.valor_recebido), 0))}
          hint={`${venceHoje.length} conta(s)`}
          tone="warning"
        />
        <StatCard label="Recebido no mês" value={brl(recebidoMes)} tone="success" />
      </div>

      {(vencidas.length > 0 || venceHoje.length > 0 || proximos7.length > 0) && (
        <div className="panel mb-4 flex flex-wrap items-center gap-3 border-l-4 border-l-warning p-4">
          <AlertTriangle className="size-4 text-warning-foreground" />
          <p className="text-sm">
            {vencidas.length > 0 && <strong>{vencidas.length} conta(s) vencida(s). </strong>}
            {venceHoje.length > 0 && <>{venceHoje.length} vence(m) hoje. </>}
            {proximos7.length > 0 && <>{proximos7.length} vence(m) nos próximos 7 dias.</>}
          </p>
        </div>
      )}

      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <Tabs value={filtro} onValueChange={setFiltro}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="todas">Todas</TabsTrigger>
            <TabsTrigger value="vencidas">Vencidas</TabsTrigger>
            {situacoesConta.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por cliente, número ou descrição"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma conta encontrada."
          description="Gere as parcelas de um pedido ou crie uma cobrança avulsa."
          action={
            <Button onClick={() => setNovaAberta(true)}>
              <Plus className="size-4" /> Nova conta
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Forma</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((c) => {
                const saldo = Number(c.valor) - Number(c.valor_recebido);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="text-numeric">{c.numero}</TableCell>
                    <TableCell>{(c.clientes as { nome: string } | null)?.nome ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {c.descricao}
                      <p className="text-xs text-muted-foreground">
                        Parcela {c.parcela}/{c.parcelas}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">{dateBR(c.vencimento)}</TableCell>
                    <TableCell className="text-sm">{labelForma(c.forma_pagamento)}</TableCell>
                    <TableCell className="text-right text-numeric">{brl(Number(c.valor))}</TableCell>
                    <TableCell className="text-right text-numeric">{brl(saldo)}</TableCell>
                    <TableCell>
                      <Badge className={corConta(c.situacao, c.vencimento)}>
                        {labelConta(c.situacao, c.vencimento)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {["aberto", "parcial"].includes(c.situacao) && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setContaId(c.id);
                              setSaldoConta(saldo);
                              setValorBaixa(saldo.toFixed(2));
                              setFormaBaixa(c.forma_pagamento ?? "pix");
                              setDataBaixa(hojeISO());
                              setUsarCaixa(caixaAberto ? "sim" : "nao");
                              setBaixaAberta(true);
                            }}
                          >
                            Receber
                          </Button>
                          {creditoTotal > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => abrirCredito(c, saldo)}
                            >
                              Usar crédito
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => cancelar.mutate(c.id)}>
                            Cancelar
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setHistorico({
                            id: c.id,
                            numero: c.numero,
                            descricao: c.descricao,
                            valor: Number(c.valor),
                            quitado: Number(c.valor_recebido),
                            vencimento: c.vencimento,
                            pessoa: (c.clientes as { nome: string } | null)?.nome ?? "Cliente",
                            parcela: c.parcela,
                            parcelas: c.parcelas,
                          })
                        }
                      >
                        Histórico
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={baixaAberta} onOpenChange={setBaixaAberta}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar recebimento</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">Saldo em aberto: {brl(saldoConta)}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Valor recebido</Label>
                <Input value={valorBaixa} onChange={(e) => setValorBaixa(e.target.value)} />
              </div>
              <div>
                <Label>Data</Label>
                <Input type="date" value={dataBaixa} onChange={(e) => setDataBaixa(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Forma de pagamento</Label>
              <Select value={formaBaixa} onValueChange={setFormaBaixa}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {formasPagamento.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Lançar no caixa aberto</Label>
              <Select value={usarCaixa} onValueChange={setUsarCaixa} disabled={!caixaAberto}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sim">
                    {caixaAberto ? `Sim — caixa nº ${caixaAberto.numero}` : "Sim"}
                  </SelectItem>
                  <SelectItem value="nao">Não</SelectItem>
                </SelectContent>
              </Select>
              {!caixaAberto && (
                <p className="mt-1 text-xs text-muted-foreground">Nenhum caixa aberto agora.</p>
              )}
            </div>
            <div>
              <Label>Observação</Label>
              <Textarea value={obsBaixa} onChange={(e) => setObsBaixa(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBaixaAberta(false)}>
              Cancelar
            </Button>
            <Button onClick={() => baixar.mutate()} disabled={baixar.isPending}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={novaAberta} onOpenChange={setNovaAberta}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova conta a receber</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Cliente</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Valor total</Label>
                <Input value={valor} onChange={(e) => setValor(e.target.value)} />
              </div>
              <div>
                <Label>1º vencimento</Label>
                <Input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} />
              </div>
              <div>
                <Label>Parcelas</Label>
                <Input
                  inputMode="numeric"
                  value={parcelas}
                  onChange={(e) => setParcelas(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Forma de pagamento</Label>
              <Select value={forma} onValueChange={setForma}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {formasPagamento.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaAberta(false)}>
              Cancelar
            </Button>
            <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creditoAberta} onOpenChange={setCreditoAberta}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usar crédito do profissional</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Profissional</Label>
              <Select value={credProf} onValueChange={setCredProf}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolher profissional" />
                </SelectTrigger>
                <SelectContent>
                  {creditos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome} — {brl(p.saldo)} de crédito
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Conta a receber</Label>
              <Select value={contaId} onValueChange={setContaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolher conta" />
                </SelectTrigger>
                <SelectContent>
                  {abertas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      nº {c.numero} · {(c.clientes as { nome: string } | null)?.nome ?? "Sem cliente"} ·
                      saldo {brl(Number(c.valor) - Number(c.valor_recebido))} · vence{" "}
                      {dateBR(c.vencimento)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor a abater</Label>
              <div className="flex gap-2">
                <Input value={credValor} onChange={(e) => setCredValor(e.target.value)} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setCredValor(Math.min(saldoCredProf, saldoContaCredito).toFixed(2))
                  }
                >
                  Usar o máximo
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Crédito disponível: {brl(saldoCredProf)} · saldo da conta: {brl(saldoContaCredito)}
              </p>
            </div>
            <div>
              <Label>Observação</Label>
              <Textarea value={credObs} onChange={(e) => setCredObs(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditoAberta(false)}>
              Cancelar
            </Button>
            <Button onClick={() => usarCredito.mutate()} disabled={usarCredito.isPending}>
              Abater na conta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HistoricoTitulo
        tipo="receber"
        titulo={historico}
        onOpenChange={(aberto) => {
          if (!aberto) setHistorico(null);
        }}
      />

    </div>
  );
}
