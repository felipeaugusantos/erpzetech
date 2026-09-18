import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowLeftRight,
  Boxes,
  PackageX,
  Search,
  SlidersHorizontal,
  TrendingDown,
} from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/depositos/$id")({
  head: () => ({
    meta: [
      { title: "Depósito — Ze Obra" },
      {
        name: "description",
        content: "Estoque físico, reservado e disponível por produto no depósito, com transferência e ajuste.",
      },
      { property: "og:title", content: "Depósito — Ze Obra" },
      {
        property: "og:description",
        content: "Saldo por produto, transferência entre depósitos e ajuste de inventário.",
      },
    ],
  }),
  component: DepositoDetalhe,
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

function DepositoDetalhe() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");

  const [transf, setTransf] = useState({
    aberto: false,
    produto_id: "",
    produto_nome: "",
    unidade: "UN",
    disponivel: 0,
    destino_id: "",
    quantidade: "",
    documento: "",
    motivo: "",
  });

  const [ajuste, setAjuste] = useState({
    aberto: false,
    produto_id: "",
    produto_nome: "",
    unidade: "UN",
    fisico: 0,
    tipo: "ajuste",
    quantidade: "",
    documento: "",
    motivo: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["deposito", id],
    queryFn: async () => {
      const [dep, est, deps] = await Promise.all([
        supabase.from("depositos").select("*, filiais(nome)").eq("id", id).maybeSingle(),
        supabase
          .from("estoques")
          .select(
            "id, quantidade, reservado, localizacao, produto_id, produtos(descricao, codigo_interno, codigo_barras, unidade, unidade_compra, fator_conversao, custo, estoque_minimo, estoque_maximo)",
          )
          .eq("deposito_id", id),
        supabase.from("depositos").select("id, nome").eq("ativo", true).neq("id", id).order("nome"),
      ]);
      if (dep.error) throw dep.error;
      return { deposito: dep.data, estoques: est.data ?? [], outros: deps.data ?? [] };
    },
  });

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data?.estoques ?? [])
      .map((e) => {
        const p = e.produtos as unknown as Prod;
        const fisico = Number(e.quantidade);
        const reservado = Number(e.reservado);
        return { e, p, fisico, reservado, disponivel: fisico - reservado };
      })
      .filter((l) => {
        if (!l.p) return false;
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
  }, [data, busca, filtro]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["deposito", id] });
    qc.invalidateQueries({ queryKey: ["estoque"] });
    qc.invalidateQueries({ queryKey: ["depositos"] });
    qc.invalidateQueries({ queryKey: ["movimentacoes"] });
    qc.invalidateQueries({ queryKey: ["alertas"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const transferir = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("registrar_movimentacao", {
        p_produto_id: transf.produto_id,
        p_deposito_id: id,
        p_tipo: "transferencia_saida",
        p_quantidade: Number(transf.quantidade),
        p_deposito_destino_id: transf.destino_id,
        ...(transf.motivo ? { p_motivo: transf.motivo } : {}),
        ...(transf.documento ? { p_documento: transf.documento } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transferência registrada");
      setTransf({ ...transf, aberto: false, quantidade: "", motivo: "", documento: "" });
      invalidar();
    },
    onError: (e: Error) =>
      toast.error("Não foi possível transferir", { description: e.message }),
  });

  const ajustar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("registrar_movimentacao", {
        p_produto_id: ajuste.produto_id,
        p_deposito_id: id,
        p_tipo: ajuste.tipo as "ajuste",
        p_quantidade: Number(ajuste.quantidade),
        ...(ajuste.motivo ? { p_motivo: ajuste.motivo } : {}),
        ...(ajuste.documento ? { p_documento: ajuste.documento } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ajuste registrado");
      setAjuste({ ...ajuste, aberto: false, quantidade: "", motivo: "", documento: "" });
      invalidar();
    },
    onError: (e: Error) => toast.error("Não foi possível ajustar", { description: e.message }),
  });

  const totalFisico = linhas.reduce((s, l) => s + l.fisico, 0);
  const totalReservado = linhas.reduce((s, l) => s + l.reservado, 0);
  const totalValor = linhas.reduce((s, l) => s + l.fisico * Number(l.p.custo), 0);
  const semSaldo = linhas.filter((l) => l.disponivel <= 0).length;

  const dep = data?.deposito;

  return (
    <>
      <Link
        to="/depositos"
        className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Depósitos
      </Link>

      <PageHeader
        title={dep?.nome ?? "Depósito"}
        description={`${(dep?.filiais as unknown as { nome: string } | null)?.nome ?? "Sem filial"} · ${
          dep?.endereco ?? "sem endereço"
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="capitalize">
              {dep?.tipo ?? "—"}
            </Badge>
            {dep?.permite_negativo ? (
              <Badge variant="destructive">Permite negativo</Badge>
            ) : (
              <Badge variant="outline">Bloqueia negativo</Badge>
            )}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Físico" value={num(totalFisico)} icon={Boxes} />
        <StatCard label="Reservado" value={num(totalReservado)} icon={ArrowLeftRight} tone="warning" />
        <StatCard
          label="Disponível"
          value={num(totalFisico - totalReservado)}
          icon={TrendingDown}
          tone="success"
        />
        <StatCard
          label="Sem disponibilidade"
          value={num(semSaldo, 0)}
          icon={PackageX}
          tone="danger"
          hint={`Valor em custo ${brl(totalValor)}`}
        />
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
            title="Nenhum produto com saldo neste depósito."
            description="Registre uma entrada, uma transferência ou um ajuste de inventário."
          />
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
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
                      {formatConverted(
                        l.fisico,
                        l.p.unidade,
                        l.p.unidade_compra,
                        Number(l.p.fator_conversao),
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setTransf({
                              aberto: true,
                              produto_id: l.e.produto_id,
                              produto_nome: l.p.descricao,
                              unidade: l.p.unidade,
                              disponivel: l.disponivel,
                              destino_id: "",
                              quantidade: "",
                              documento: "",
                              motivo: "",
                            })
                          }
                        >
                          <ArrowLeftRight className="mr-1.5 size-3.5" /> Transferir
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setAjuste({
                              aberto: true,
                              produto_id: l.e.produto_id,
                              produto_nome: l.p.descricao,
                              unidade: l.p.unidade,
                              fisico: l.fisico,
                              tipo: "ajuste",
                              quantidade: String(l.fisico),
                              documento: "",
                              motivo: "",
                            })
                          }
                        >
                          <SlidersHorizontal className="mr-1.5 size-3.5" /> Ajustar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={transf.aberto} onOpenChange={(v) => setTransf({ ...transf, aberto: v })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferir entre depósitos</DialogTitle>
            <DialogDescription>
              {transf.produto_nome} · disponível {num(transf.disponivel)} {transf.unidade} em{" "}
              {dep?.nome}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Depósito de destino</Label>
              <Select
                value={transf.destino_id}
                onValueChange={(v) => setTransf({ ...transf, destino_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o destino" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.outros ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="t-qtd">Quantidade ({transf.unidade})</Label>
                <Input
                  id="t-qtd"
                  type="number"
                  step="0.001"
                  value={transf.quantidade}
                  onChange={(e) => setTransf({ ...transf, quantidade: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="t-doc">Documento</Label>
                <Input
                  id="t-doc"
                  value={transf.documento}
                  onChange={(e) => setTransf({ ...transf, documento: e.target.value })}
                  placeholder="Guia, romaneio…"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="t-motivo">Motivo</Label>
              <Textarea
                id="t-motivo"
                value={transf.motivo}
                onChange={(e) => setTransf({ ...transf, motivo: e.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              A saída sai deste depósito e entra no destino, gerando duas movimentações permanentes.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransf({ ...transf, aberto: false })}>
              Cancelar
            </Button>
            <Button
              onClick={() => transferir.mutate()}
              disabled={
                !transf.destino_id ||
                !transf.quantidade ||
                Number(transf.quantidade) <= 0 ||
                transferir.isPending
              }
            >
              Confirmar transferência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ajuste.aberto} onOpenChange={(v) => setAjuste({ ...ajuste, aberto: v })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar estoque</DialogTitle>
            <DialogDescription>
              {ajuste.produto_nome} · físico atual {num(ajuste.fisico)} {ajuste.unidade}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={ajuste.tipo} onValueChange={(v) => setAjuste({ ...ajuste, tipo: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ajuste">Ajuste (define o saldo)</SelectItem>
                  <SelectItem value="inventario">Inventário (define o saldo)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="a-qtd">Saldo correto ({ajuste.unidade})</Label>
                <Input
                  id="a-qtd"
                  type="number"
                  step="0.001"
                  value={ajuste.quantidade}
                  onChange={(e) => setAjuste({ ...ajuste, quantidade: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="a-doc">Documento</Label>
                <Input
                  id="a-doc"
                  value={ajuste.documento}
                  onChange={(e) => setAjuste({ ...ajuste, documento: e.target.value })}
                  placeholder="Contagem, laudo…"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="a-motivo">Motivo</Label>
              <Textarea
                id="a-motivo"
                value={ajuste.motivo}
                onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })}
                placeholder="Diferença de contagem, avaria, perda…"
              />
            </div>
            {ajuste.quantidade !== "" && (
              <p className="text-xs text-muted-foreground">
                Diferença de {num(Number(ajuste.quantidade) - ajuste.fisico)} {ajuste.unidade}. O
                histórico da movimentação nunca é apagado.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAjuste({ ...ajuste, aberto: false })}>
              Cancelar
            </Button>
            <Button
              onClick={() => ajustar.mutate()}
              disabled={ajuste.quantidade === "" || Number(ajuste.quantidade) < 0 || ajustar.isPending}
            >
              Confirmar ajuste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
