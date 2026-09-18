import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, Percent, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR, num } from "@/lib/format";
import { usePeriodo } from "@/lib/periodo";
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

export const Route = createFileRoute("/_authenticated/comissoes")({
  head: () => ({
    meta: [
      { title: "Comissão por vendedor — Ze Obra" },
      {
        name: "description",
        content:
          "Defina o percentual de comissão de cada vendedor, sobre a venda ou sobre o lucro, e acompanhe o saldo a pagar por período.",
      },
      { property: "og:title", content: "Comissão por vendedor — Ze Obra" },
      {
        property: "og:description",
        content: "Comissão lançada automaticamente quando o pedido do vendedor é entregue.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Comissoes,
});

const SITUACOES: Record<string, string> = {
  a_aprovar: "A aprovar",
  aprovada: "Aprovada",
  paga: "Paga",
  cancelada: "Cancelada",
};

function Comissoes() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const tenantId = session?.profile?.tenant_id ?? null;
  const empresaId = session?.profile?.empresa_id ?? session?.empresa?.id ?? null;
  const podeAprovar =
    session?.roles.some((r) => ["administrador", "gestor"].includes(r)) ?? false;

  const { periodo, setDe, setAte } = usePeriodo();
  const [depositoId, setDepositoId] = useState("todos");

  const { data, isLoading } = useQuery({
    queryKey: ["comissoes", periodo.de, periodo.ate],
    queryFn: async () => {
      const [comRes, regraRes, perfRes, depRes] = await Promise.all([
        supabase
          .from("comissoes")
          .select(
            "*, profiles(nome), pedidos(numero, deposito_id, depositos(nome), clientes(nome))",
          )
          .gte("created_at", `${periodo.de}T00:00:00`)
          .lte("created_at", `${periodo.ate}T23:59:59`)
          .order("created_at", { ascending: false }),
        supabase.from("vendedor_comissao_regras").select("*, profiles(nome, email)"),
        supabase.from("profiles").select("id, nome, email, ativo").order("nome"),
        supabase.from("depositos").select("id, nome").order("nome"),
      ]);
      if (comRes.error) throw comRes.error;
      return {
        comissoes: comRes.data ?? [],
        regras: regraRes.data ?? [],
        vendedores: perfRes.data ?? [],
        depositos: depRes.data ?? [],
      };
    },
  });

  const todas = data?.comissoes ?? [];
  const regras = data?.regras ?? [];
  const vendedores = data?.vendedores ?? [];
  const depositos = data?.depositos ?? [];

  /** Filtro por depósito de saída da mercadoria do pedido. */
  const comissoes = useMemo(
    () =>
      depositoId === "todos"
        ? todas
        : todas.filter((c) => c.pedidos?.deposito_id === depositoId),
    [todas, depositoId],
  );

  const resumo = useMemo(() => {
    let aPagar = 0;
    let pago = 0;
    let vendas = 0;
    for (const c of comissoes) {
      if (c.situacao === "cancelada") continue;
      vendas += Number(c.valor_venda);
      if (c.situacao === "paga") pago += Number(c.valor);
      else aPagar += Number(c.valor);
    }
    return { aPagar, pago, vendas };
  }, [comissoes]);

  /** Saldo consolidado por vendedor no período. */
  const porVendedor = useMemo(() => {
    const mapa = new Map<
      string,
      { nome: string; vendas: number; aPagar: number; pago: number; pedidos: number }
    >();
    for (const c of comissoes) {
      if (c.situacao === "cancelada") continue;
      const atual =
        mapa.get(c.vendedor_id) ?? {
          nome: c.profiles?.nome ?? "Vendedor",
          vendas: 0,
          aPagar: 0,
          pago: 0,
          pedidos: 0,
        };
      atual.vendas += Number(c.valor_venda);
      atual.pedidos += 1;
      if (c.situacao === "paga") atual.pago += Number(c.valor);
      else atual.aPagar += Number(c.valor);
      mapa.set(c.vendedor_id, atual);
    }
    return [...mapa.entries()].sort((a, b) => b[1].vendas - a[1].vendas);
  }, [comissoes]);

  /* ---------- regra do vendedor ---------- */
  const vazio = { vendedor_id: "", percentual: "1", base: "venda", venda_minima: "0" };
  const [aberto, setAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState(vazio);

  function nova() {
    setEditandoId(null);
    setForm(vazio);
    setAberto(true);
  }

  function editar(r: (typeof regras)[number]) {
    setEditandoId(r.id);
    setForm({
      vendedor_id: r.vendedor_id,
      percentual: String(r.percentual),
      base: r.base,
      venda_minima: String(r.venda_minima),
    });
    setAberto(true);
  }

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.vendedor_id) throw new Error("Escolha o vendedor");
      const perc = Number(form.percentual.replace(",", "."));
      if (!Number.isFinite(perc) || perc <= 0 || perc > 100)
        throw new Error("Percentual de comissão inválido");
      const minimo = Number(form.venda_minima.replace(",", ".")) || 0;
      const valores = {
        vendedor_id: form.vendedor_id,
        percentual: perc,
        base: form.base,
        venda_minima: minimo,
      };
      if (editandoId) {
        const { error } = await supabase
          .from("vendedor_comissao_regras")
          .update(valores)
          .eq("id", editandoId);
        if (error) throw error;
      } else {
        if (!tenantId) throw new Error("Empresa não identificada");
        const { error } = await supabase
          .from("vendedor_comissao_regras")
          .insert({ tenant_id: tenantId, empresa_id: empresaId, ...valores });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Regra de comissão salva");
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["comissoes"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const alternarAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase
        .from("vendedor_comissao_regras")
        .update({ ativo })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comissoes"] }),
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const gerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("gerar_comissoes");
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (qtd) => {
      toast.success(
        qtd > 0
          ? `${qtd} comissão(ões) lançada(s)`
          : "Nenhum pedido entregue sem comissão lançada",
      );
      qc.invalidateQueries({ queryKey: ["comissoes"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const mudarSituacao = useMutation({
    mutationFn: async ({ id, situacao }: { id: string; situacao: string }) => {
      const { error } = await supabase
        .from("comissoes")
        .update({
          situacao,
          ...(situacao === "paga" ? { pago_em: new Date().toISOString().slice(0, 10) } : {}),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Comissão atualizada");
      qc.invalidateQueries({ queryKey: ["comissoes"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Comissão por vendedor"
        description="A comissão é lançada sozinha quando o pedido do vendedor é entregue ou concluído. O botão abaixo só serve para pedidos antigos."
        actions={
          <>
            <Button variant="outline" onClick={() => gerar.mutate()} disabled={gerar.isPending}>
              <RefreshCw className="mr-2 size-4" /> Gerar comissões
            </Button>
            <Button onClick={nova}>Nova regra</Button>
          </>
        }
      />

      <div className="panel mb-6 flex flex-wrap items-end gap-4">
        <div>
          <Label>De</Label>
          <Input
            type="date"
            className="mt-1"
            value={periodo.de}
            onChange={(e) => setDe(e.target.value)}
          />
        </div>
        <div>
          <Label>Até</Label>
          <Input
            type="date"
            className="mt-1"
            value={periodo.ate}
            onChange={(e) => setAte(e.target.value)}
          />
        </div>
        <div className="min-w-48">
          <Label>Depósito</Label>
          <Select value={depositoId} onValueChange={setDepositoId}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os depósitos</SelectItem>
              {depositos.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">Mesmo período do painel e dos relatórios.</p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Vendas com comissão"
          value={brl(resumo.vendas)}
          hint={`${comissoes.length} pedido(s) no período`}
          icon={BadgePercent}
          tone="accent"
        />
        <StatCard
          label="Comissão a pagar"
          value={brl(resumo.aPagar)}
          hint="A aprovar e aprovadas"
          icon={Wallet}
          tone="warning"
        />
        <StatCard
          label="Comissão paga"
          value={brl(resumo.pago)}
          hint="Já quitada no período"
          icon={Wallet}
          tone="success"
        />
        <StatCard
          label="Regras ativas"
          value={String(regras.filter((r) => r.ativo).length)}
          hint={`${regras.length} vendedor(es) com regra`}
          icon={Percent}
        />
      </div>

      <Tabs defaultValue="lancamentos">
        <TabsList>
          <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
          <TabsTrigger value="vendedores">Por vendedor</TabsTrigger>
          <TabsTrigger value="regras">Regras</TabsTrigger>
        </TabsList>

        <TabsContent value="lancamentos" className="mt-4">
          {isLoading ? (
            <div className="panel h-40 animate-pulse" />
          ) : comissoes.length === 0 ? (
            <EmptyState
              title="Nenhuma comissão no período."
              description="Cadastre a regra do vendedor e entregue um pedido dele — a comissão entra automaticamente."
              action={<Button onClick={nova}>Nova regra</Button>}
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Vendedor</TableHead>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Venda</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Comissão</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comissoes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-sm">{dateBR(c.created_at)}</TableCell>
                      <TableCell className="text-sm font-medium">
                        {c.profiles?.nome ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.pedidos?.numero ? `nº ${c.pedidos.numero}` : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.pedidos?.clientes?.nome ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(Number(c.valor_venda))}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(Number(c.valor_base))}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {c.base === "lucro" ? "lucro" : "venda"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {num(Number(c.percentual), 2)}%
                      </TableCell>
                      <TableCell className="text-right text-numeric font-semibold">
                        {brl(Number(c.valor))}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            c.situacao === "paga"
                              ? "default"
                              : c.situacao === "cancelada"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {SITUACOES[c.situacao] ?? c.situacao}
                        </Badge>
                        {c.pago_em && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {dateBR(c.pago_em)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {podeAprovar && c.situacao === "a_aprovar" && (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                mudarSituacao.mutate({ id: c.id, situacao: "aprovada" })
                              }
                            >
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                mudarSituacao.mutate({ id: c.id, situacao: "cancelada" })
                              }
                            >
                              Recusar
                            </Button>
                          </div>
                        )}
                        {podeAprovar && c.situacao === "aprovada" && (
                          <Button
                            size="sm"
                            onClick={() => mudarSituacao.mutate({ id: c.id, situacao: "paga" })}
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

        <TabsContent value="vendedores" className="mt-4">
          {porVendedor.length === 0 ? (
            <EmptyState
              title="Sem vendas comissionadas no período."
              description="Ajuste as datas acima ou cadastre a regra de comissão do vendedor."
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead>
                    <TableHead className="text-right">Pedidos</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">A pagar</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porVendedor.map(([id, v]) => (
                    <TableRow key={id}>
                      <TableCell className="text-sm font-medium">{v.nome}</TableCell>
                      <TableCell className="text-right text-numeric">{v.pedidos}</TableCell>
                      <TableCell className="text-right text-numeric">{brl(v.vendas)}</TableCell>
                      <TableCell className="text-right text-numeric font-semibold">
                        {brl(v.aPagar)}
                      </TableCell>
                      <TableCell className="text-right text-numeric text-muted-foreground">
                        {brl(v.pago)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="regras" className="mt-4">
          {regras.length === 0 ? (
            <EmptyState
              title="Nenhuma regra de comissão."
              description="Escolha o vendedor, o percentual e se a comissão sai sobre o valor da venda ou sobre o lucro."
              action={<Button onClick={nova}>Nova regra</Button>}
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead>
                    <TableHead className="text-right">Comissão</TableHead>
                    <TableHead>Cálculo sobre</TableHead>
                    <TableHead className="text-right">Venda mínima</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {regras.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm font-medium">
                        {r.profiles?.nome ?? "—"}
                        <span className="block text-xs text-muted-foreground">
                          {r.profiles?.email ?? ""}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {num(Number(r.percentual), 2)}%
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.base === "lucro" ? "Lucro (venda menos custo)" : "Valor da venda"}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {Number(r.venda_minima) > 0 ? brl(Number(r.venda_minima)) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.ativo ? "default" : "outline"}>
                          {r.ativo ? "Ativa" : "Inativa"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => editar(r)}>
                            Editar
                          </Button>
                          {podeAprovar && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                alternarAtivo.mutate({ id: r.id, ativo: !r.ativo })
                              }
                            >
                              {r.ativo ? "Desativar" : "Ativar"}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editandoId ? "Editar regra" : "Nova regra de comissão"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Vendedor</Label>
              <Select
                value={form.vendedor_id}
                onValueChange={(v) => setForm({ ...form, vendedor_id: v })}
                disabled={!!editandoId}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Escolha o vendedor" />
                </SelectTrigger>
                <SelectContent>
                  {vendedores.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.nome}
                      {v.email ? ` · ${v.email}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Comissão (%)</Label>
              <Input
                className="mt-1"
                inputMode="decimal"
                value={form.percentual}
                onChange={(e) => setForm({ ...form, percentual: e.target.value })}
              />
            </div>
            <div>
              <Label>Cálculo sobre</Label>
              <Select value={form.base} onValueChange={(v) => setForm({ ...form, base: v })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="venda">Valor da venda</SelectItem>
                  <SelectItem value="lucro">Lucro (venda menos custo)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Venda mínima para gerar comissão (R$)</Label>
              <Input
                className="mt-1"
                inputMode="decimal"
                value={form.venda_minima}
                onChange={(e) => setForm({ ...form, venda_minima: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Deixe 0 para comissionar qualquer pedido entregue.
              </p>
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
