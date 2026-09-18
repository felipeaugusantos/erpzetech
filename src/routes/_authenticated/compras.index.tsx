import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Gauge, ShoppingCart, Plus, Search, Sparkles, Trophy } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR } from "@/lib/format";
import { corCompra, labelCompra, situacoesCompra } from "@/lib/financeiro";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
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

export const Route = createFileRoute("/_authenticated/compras/")({
  head: () => ({
    meta: [
      { title: "Compras — Ze Obra" },
      {
        name: "description",
        content: "Solicitações, cotações, pedidos de compra e recebimento de mercadorias.",
      },
      { property: "og:title", content: "Compras — Ze Obra" },
      { property: "og:description", content: "Fluxo de compras da loja de materiais." },
    ],
  }),
  component: Compras,
});

function Compras() {
  const { data: session } = useSessionData();
  const profile = session?.profile ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [novaAberta, setNovaAberta] = useState(false);
  const [sugestaoAberta, setSugestaoAberta] = useState(false);
  const [fornecedorId, setFornecedorId] = useState("");
  const [depositoId, setDepositoId] = useState("");
  const [previsao, setPrevisao] = useState("");
  const [condicao, setCondicao] = useState("");
  const [observacoes, setObservacoes] = useState("");

  const { data: depositos = [] } = useQuery({
    queryKey: ["depositos-lista"],
    queryFn: async () => {
      const { data, error } = await supabase.from("depositos").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ["fornecedores-lista"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fornecedores")
        .select("id, razao_social")
        .eq("ativo", true)
        .order("razao_social");
      if (error) throw error;
      return data;
    },
  });

  const { data: compras = [], isLoading } = useQuery({
    queryKey: ["compras"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compras")
        .select("*, fornecedores(razao_social), depositos(nome)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const depositoPadrao = useMemo(
    () =>
      depositos.find((d) => d.nome.toLowerCase().includes("principal"))?.id ??
      depositos[0]?.id ??
      "",
    [depositos],
  );

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return compras.filter((c) => {
      if (filtro !== "todos" && c.situacao !== filtro) return false;
      if (!t) return true;
      const forn = (c.fornecedores as { razao_social: string } | null)?.razao_social ?? "";
      return `${c.numero} ${forn}`.toLowerCase().includes(t);
    });
  }, [compras, filtro, busca]);

  const abertas = compras.filter((c) =>
    ["rascunho", "cotacao", "aprovado", "pedido_enviado", "parcialmente_recebido"].includes(
      c.situacao,
    ),
  );
  const aguardando = compras.filter((c) =>
    ["aprovado", "pedido_enviado", "parcialmente_recebido"].includes(c.situacao),
  );
  const recebidasMes = compras.filter(
    (c) => c.situacao === "recebido" && (c.updated_at ?? "").slice(0, 7) === new Date().toISOString().slice(0, 7),
  );

  const criar = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id) throw new Error("Usuário sem empresa vinculada");
      const deposito = depositoId || depositoPadrao;
      if (!deposito) throw new Error("Cadastre um depósito antes de comprar");
      const { data, error } = await supabase
        .from("compras")
        .insert({
          tenant_id: profile.tenant_id,
          empresa_id: profile.empresa_id,
          filial_id: profile.filial_id,
          deposito_id: deposito,
          fornecedor_id: fornecedorId || null,
          previsao_entrega: previsao || null,
          condicao_pagamento: condicao || null,
          observacoes: observacoes || null,
          solicitante_id: profile.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success("Solicitação de compra criada.");
      setNovaAberta(false);
      setFornecedorId("");
      setPrevisao("");
      setCondicao("");
      setObservacoes("");
      void queryClient.invalidateQueries({ queryKey: ["compras"] });
      void navigate({ to: "/compras/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sugerir = useMutation({
    mutationFn: async () => {
      const deposito = depositoId || depositoPadrao;
      if (!deposito) throw new Error("Selecione o depósito");
      const { data, error } = await supabase.rpc("gerar_compra_estoque_minimo", {
        p_deposito_id: deposito,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Solicitação gerada a partir do estoque mínimo.");
      setSugestaoAberta(false);
      void queryClient.invalidateQueries({ queryKey: ["compras"] });
      void navigate({ to: "/compras/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Compras"
        description="Necessidade → cotação → pedido de compra → recebimento no estoque."
        actions={
           <>
            <Button variant="outline" asChild>
              <Link to="/giro-estoque">
                <Gauge className="size-4" /> Giro e sugestão
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/cotacoes">
                <Trophy className="size-4" /> Cotações
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/nfe-entrada">
                <FileUp className="size-4" /> Importar XML da NF-e
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDepositoId(depositoPadrao);
                setSugestaoAberta(true);
              }}
            >
              <Sparkles className="size-4" /> Sugerir pelo estoque mínimo
            </Button>
            <Button
              onClick={() => {
                setDepositoId(depositoPadrao);
                setNovaAberta(true);
              }}
            >
              <Plus className="size-4" /> Nova compra
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Compras em aberto" value={String(abertas.length)} icon={ShoppingCart} />
        <StatCard label="Aguardando recebimento" value={String(aguardando.length)} tone="warning" />
        <StatCard label="Recebidas no mês" value={String(recebidasMes.length)} tone="success" />
        <StatCard
          label="Valor em aberto"
          value={brl(abertas.reduce((s, c) => s + Number(c.total ?? 0), 0))}
          tone="accent"
        />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <Tabs value={filtro} onValueChange={setFiltro}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="todos">Todas</TabsTrigger>
            {situacoesCompra.map((s) => (
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
            placeholder="Buscar por número ou fornecedor"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma compra encontrada."
          description="Crie uma solicitação ou gere uma sugestão pelo estoque mínimo."
          action={
            <Button
              onClick={() => {
                setDepositoId(depositoPadrao);
                setNovaAberta(true);
              }}
            >
              <Plus className="size-4" /> Nova compra
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Depósito</TableHead>
                <TableHead>Previsão</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-numeric font-medium">{c.numero}</TableCell>
                  <TableCell>
                    {(c.fornecedores as { razao_social: string } | null)?.razao_social ?? "—"}
                    {c.origem === "estoque_minimo" && (
                      <p className="text-xs text-muted-foreground">Gerada pelo estoque mínimo</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {(c.depositos as { nome: string } | null)?.nome ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{dateBR(c.previsao_entrega)}</TableCell>
                  <TableCell>
                    <Badge className={corCompra(c.situacao)}>{labelCompra(c.situacao)}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-numeric">{brl(Number(c.total))}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/compras/$id" params={{ id: c.id }}>
                        Abrir
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={novaAberta} onOpenChange={setNovaAberta}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova compra</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Fornecedor (pode definir depois na cotação)</Label>
              <Select value={fornecedorId} onValueChange={setFornecedorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar fornecedor" />
                </SelectTrigger>
                <SelectContent>
                  {fornecedores.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.razao_social}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Depósito de entrada</Label>
              <Select value={depositoId} onValueChange={setDepositoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar depósito" />
                </SelectTrigger>
                <SelectContent>
                  {depositos.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Previsão de entrega</Label>
                <Input type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} />
              </div>
              <div>
                <Label>Condição de pagamento</Label>
                <Input
                  placeholder="Ex.: 28/56 dias"
                  value={condicao}
                  onChange={(e) => setCondicao(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaAberta(false)}>
              Cancelar
            </Button>
            <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
              Criar e adicionar itens
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sugestaoAberta} onOpenChange={setSugestaoAberta}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sugerir compra pelo estoque mínimo</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O sistema lista os produtos abaixo do estoque mínimo neste depósito e monta uma
            solicitação com a quantidade necessária para repor.
          </p>
          <div>
            <Label>Depósito</Label>
            <Select value={depositoId} onValueChange={setDepositoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecionar depósito" />
              </SelectTrigger>
              <SelectContent>
                {depositos.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSugestaoAberta(false)}>
              Cancelar
            </Button>
            <Button onClick={() => sugerir.mutate()} disabled={sugerir.isPending}>
              Gerar solicitação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
