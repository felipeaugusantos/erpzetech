import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, num } from "@/lib/format";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { situacoesPedido, corSituacao, labelSituacao } from "@/lib/pedido";

export const Route = createFileRoute("/_authenticated/pedidos/")({
  head: () => ({
    meta: [
      { title: "Pedidos — Ze Obra" },
      {
        name: "description",
        content: "Pedidos com separação, conferência e entrega acompanhados por timeline.",
      },
      { property: "og:title", content: "Pedidos — Ze Obra" },
      {
        property: "og:description",
        content: "Do pagamento à entrega: acompanhe cada etapa do pedido da loja.",
      },
    ],
  }),
  component: Pedidos,
});

function Pedidos() {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");

  const { data, isLoading } = useQuery({
    queryKey: ["pedidos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pedidos")
        .select("*, clientes(nome), obras(nome), depositos(nome)")
        .order("numero", { ascending: false });
      return data ?? [];
    },
  });

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data ?? []).filter((p) => {
      if (filtro !== "todos" && p.situacao !== filtro) return false;
      if (!termo) return true;
      const cliente = (p.clientes as unknown as { nome: string } | null)?.nome ?? "";
      return [String(p.numero), cliente].some((v) => v.toLowerCase().includes(termo));
    });
  }, [data, busca, filtro]);

  const totais = useMemo(() => {
    const l = data ?? [];
    const emAberto = l.filter(
      (p) => !["entregue", "concluido", "cancelado"].includes(p.situacao),
    );
    const valor = emAberto.reduce((s, p) => s + Number(p.total), 0);
    const separacao = l.filter((p) => ["separacao", "separado", "conferencia"].includes(p.situacao));
    const entrega = l.filter((p) => ["pronto_entrega", "em_rota"].includes(p.situacao));
    return { total: l.length, emAberto: emAberto.length, valor, separacao: separacao.length, entrega: entrega.length };
  }, [data]);

  return (
    <>
      <PageHeader
        title="Pedidos"
        description="Fluxo completo: pagamento, separação, conferência, expedição e entrega."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pedidos" value={num(totais.total)} />
        <StatCard label="Em andamento" value={num(totais.emAberto)} />
        <StatCard label="Em separação / conferência" value={num(totais.separacao)} />
        <StatCard label="Valor em andamento" value={brl(totais.valor)} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Número ou cliente…"
            className="pl-8"
          />
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as situações</SelectItem>
            {situacoesPedido.map((s) => (
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
            title="Nenhum pedido encontrado."
            description="Pedidos são gerados a partir de orçamentos aprovados."
            action={
              <Button asChild>
                <Link to="/orcamentos">Ir para orçamentos</Link>
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
                  <TableHead>Obra</TableHead>
                  <TableHead>Depósito</TableHead>
                  <TableHead>Previsão</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">
                      #{String(p.numero).padStart(4, "0")}
                    </TableCell>
                    <TableCell className="font-medium">
                      {(p.clientes as unknown as { nome: string } | null)?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(p.obras as unknown as { nome: string } | null)?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(p.depositos as unknown as { nome: string } | null)?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{dateBR(p.previsao_entrega)}</TableCell>
                    <TableCell className="text-right font-semibold">{brl(Number(p.total))}</TableCell>
                    <TableCell>
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-medium ${corSituacao(p.situacao)}`}
                      >
                        {labelSituacao(p.situacao)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/pedidos/$id" params={{ id: p.id }}>
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
      </div>
    </>
  );
}
