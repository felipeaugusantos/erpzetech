import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Boxes, PackageX, Search, TrendingDown } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, formatConverted, num } from "@/lib/format";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

export const Route = createFileRoute("/_authenticated/estoque")({
  head: () => ({
    meta: [
      { title: "Estoque — Enzova Build" },
      {
        name: "description",
        content: "Estoque físico, reservado e disponível por produto e depósito, com movimentações.",
      },
      { property: "og:title", content: "Estoque — Enzova Build" },
      { property: "og:description", content: "Controle de saldo por depósito com reserva." },
    ],
  }),
  component: Estoque,
});

const tipos = [
  { value: "entrada", label: "Entrada" },
  { value: "saida", label: "Saída" },
  { value: "ajuste", label: "Ajuste (define o saldo)" },
  { value: "inventario", label: "Inventário (define o saldo)" },
  { value: "transferencia_saida", label: "Transferência entre depósitos" },
  { value: "reserva", label: "Reservar" },
  { value: "liberacao_reserva", label: "Liberar reserva" },
];

function Estoque() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [dep, setDep] = useState("todos");
  const [filtro, setFiltro] = useState("todos");
  const [open, setOpen] = useState(false);
  const [mov, setMov] = useState({
    produto_id: "",
    produto_nome: "",
    unidade: "UN",
    deposito_id: "",
    destino_id: "",
    tipo: "entrada",
    quantidade: "",
    documento: "",
    motivo: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["estoque"],
    queryFn: async () => {
      const [est, deps] = await Promise.all([
        supabase
          .from("estoques")
          .select(
            "id, quantidade, reservado, localizacao, produto_id, deposito_id, produtos(descricao, codigo_interno, codigo_barras, unidade, unidade_compra, fator_conversao, custo, estoque_minimo, estoque_maximo), depositos(nome)",
          ),
        supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome"),
      ]);
      return { estoques: est.data ?? [], depositos: deps.data ?? [] };
    },
  });

  type Prod = {
    descricao: string;
    codigo_interno: string;
    codigo_barras: string | null;
    unidade: string;
    unidade_compra: string | null;
    fator_conversao: number;
    custo: number;
    estoque_minimo: number;
    estoque_maximo: number;
  };

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data?.estoques ?? [])
      .map((e) => {
        const p = e.produtos as unknown as Prod;
        const d = e.depositos as unknown as { nome: string } | null;
        const fisico = Number(e.quantidade);
        const reservado = Number(e.reservado);
        return { e, p, deposito: d?.nome ?? "—", fisico, reservado, disponivel: fisico - reservado };
      })
      .filter((l) => {
        if (!l.p) return false;
        if (dep !== "todos" && l.e.deposito_id !== dep) return false;
        if (filtro === "zerado" && l.disponivel > 0) return false;
        if (filtro === "baixo" && !(l.disponivel > 0 && l.disponivel < Number(l.p.estoque_minimo)))
          return false;
        if (filtro === "reservado" && l.reservado <= 0) return false;
        if (!termo) return true;
        return [l.p.descricao, l.p.codigo_interno, l.p.codigo_barras]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(termo));
      })
      .sort((a, b) => a.p.descricao.localeCompare(b.p.descricao));
  }, [data, busca, dep, filtro]);

  const movimentar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("registrar_movimentacao", {
        p_produto_id: mov.produto_id,
        p_deposito_id: mov.deposito_id,
        p_tipo: mov.tipo as "entrada",
        p_quantidade: Number(mov.quantidade),
        p_motivo: mov.motivo || undefined,
        p_documento: mov.documento || undefined,
        p_deposito_destino_id:
          mov.tipo === "transferencia_saida" ? mov.destino_id : undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Movimentação registrada");
      setOpen(false);
      setMov({ ...mov, quantidade: "", motivo: "", documento: "" });
      qc.invalidateQueries({ queryKey: ["estoque"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["alertas"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error("Não foi possível movimentar", { description: e.message }),
  });

  const totalFisico = linhas.reduce((s, l) => s + l.fisico, 0);
  const totalReservado = linhas.reduce((s, l) => s + l.reservado, 0);
  const totalValor = linhas.reduce((s, l) => s + l.fisico * Number(l.p.custo), 0);
  const zerados = linhas.filter((l) => l.disponivel <= 0).length;

  return (
    <>
      <PageHeader
        title="Estoque"
        description="Físico, reservado e disponível por produto e depósito. Saídas acima do disponível são bloqueadas."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Quantidade física" value={num(totalFisico)} icon={Boxes} />
        <StatCard label="Reservado" value={num(totalReservado)} icon={ArrowLeftRight} tone="warning" />
        <StatCard label="Disponível" value={num(totalFisico - totalReservado)} icon={TrendingDown} tone="success" />
        <StatCard label="Sem disponibilidade" value={num(zerados, 0)} icon={PackageX} tone="danger" hint={`Valor total ${brl(totalValor)}`} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Produto, código, código de barras…"
            className="pl-8"
          />
        </div>
        <Select value={dep} onValueChange={setDep}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os depósitos</SelectItem>
            {(data?.depositos ?? []).map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os itens</SelectItem>
            <SelectItem value="baixo">Abaixo do mínimo</SelectItem>
            <SelectItem value="zerado">Sem disponibilidade</SelectItem>
            <SelectItem value="reservado">Com reserva</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="panel h-64 animate-pulse" />
        ) : linhas.length === 0 ? (
          <EmptyState
            title="Nenhum item de estoque encontrado."
            description="Ajuste os filtros ou registre uma entrada de mercadoria."
          />
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Depósito</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead className="text-right">Físico</TableHead>
                  <TableHead className="text-right">Reservado</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                  <TableHead>Conversão</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={l.e.id}>
                    <TableCell>
                      <p className="font-medium">{l.p.descricao}</p>
                      <p className="text-numeric text-xs text-muted-foreground">
                        {l.p.codigo_interno} • mín. {num(l.p.estoque_minimo)} {l.p.unidade}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">{l.deposito}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {l.e.localizacao ?? "—"}
                    </TableCell>
                    <TableCell className="text-numeric text-right">{num(l.fisico)}</TableCell>
                    <TableCell className="text-numeric text-right">{num(l.reservado)}</TableCell>
                    <TableCell className="text-numeric text-right">
                      <span className={l.disponivel <= 0 ? "font-semibold text-destructive" : ""}>
                        {num(l.disponivel)}
                      </span>
                      {l.disponivel > 0 && l.disponivel < Number(l.p.estoque_minimo) && (
                        <Badge variant="secondary" className="ml-2">
                          baixo
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatConverted(l.fisico, l.p.unidade, l.p.unidade_compra, Number(l.p.fator_conversao))}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMov({
                            produto_id: l.e.produto_id,
                            produto_nome: l.p.descricao,
                            unidade: l.p.unidade,
                            deposito_id: l.e.deposito_id,
                            destino_id: "",
                            tipo: "entrada",
                            quantidade: "",
                            documento: "",
                            motivo: "",
                          });
                          setOpen(true);
                        }}
                      >
                        Movimentar
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Movimentar estoque</DialogTitle>
            <DialogDescription>{mov.produto_nome}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tipo de movimentação</Label>
              <Select value={mov.tipo} onValueChange={(v) => setMov({ ...mov, tipo: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tipos.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Depósito de origem</Label>
                <Select value={mov.deposito_id} onValueChange={(v) => setMov({ ...mov, deposito_id: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(data?.depositos ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {mov.tipo === "transferencia_saida" && (
                <div>
                  <Label>Depósito de destino</Label>
                  <Select value={mov.destino_id} onValueChange={(v) => setMov({ ...mov, destino_id: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {(data?.depositos ?? [])
                        .filter((d) => d.id !== mov.deposito_id)
                        .map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.nome}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="m-qtd">Quantidade ({mov.unidade})</Label>
                <Input
                  id="m-qtd"
                  type="number"
                  step="0.001"
                  value={mov.quantidade}
                  onChange={(e) => setMov({ ...mov, quantidade: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="m-doc">Documento</Label>
                <Input
                  id="m-doc"
                  value={mov.documento}
                  onChange={(e) => setMov({ ...mov, documento: e.target.value })}
                  placeholder="NF, pedido, OS…"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="m-motivo">Motivo</Label>
              <Textarea
                id="m-motivo"
                value={mov.motivo}
                onChange={(e) => setMov({ ...mov, motivo: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => movimentar.mutate()}
              disabled={
                !mov.quantidade ||
                Number(mov.quantidade) <= 0 ||
                !mov.deposito_id ||
                (mov.tipo === "transferencia_saida" && !mov.destino_id) ||
                movimentar.isPending
              }
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
