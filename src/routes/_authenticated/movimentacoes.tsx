import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { dateTimeBR, num } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/movimentacoes")({
  head: () => ({
    meta: [
      { title: "Movimentações — ERP Ze Tech" },
      {
        name: "description",
        content: "Histórico permanente de entradas, saídas, ajustes, reservas e transferências.",
      },
      { property: "og:title", content: "Movimentações — ERP Ze Tech" },
      { property: "og:description", content: "Rastreabilidade completa do estoque." },
    ],
  }),
  component: Movimentacoes,
});

const tipos = [
  "entrada",
  "saida",
  "ajuste",
  "inventario",
  "transferencia_saida",
  "transferencia_entrada",
  "reserva",
  "liberacao_reserva",
];

function Movimentacoes() {
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("todos");

  const { data, isLoading } = useQuery({
    queryKey: ["movimentacoes"],
    queryFn: async () => {
      const [movs, perfis] = await Promise.all([
        supabase
          .from("estoque_movimentacoes")
          .select(
            "*, produtos(descricao, codigo_interno), depositos!estoque_movimentacoes_deposito_id_fkey(nome)",
          )
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("profiles").select("id, nome"),
      ]);
      const nomes = new Map((perfis.data ?? []).map((p) => [p.id, p.nome]));
      return { movs: movs.data ?? [], nomes };
    },
  });

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data?.movs ?? []).filter((m) => {
      if (tipo !== "todos" && m.tipo !== tipo) return false;
      if (!termo) return true;
      const p = m.produtos as unknown as { descricao: string; codigo_interno: string } | null;
      return [p?.descricao, p?.codigo_interno, m.documento, m.motivo]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo));
    });
  }, [data, busca, tipo]);

  return (
    <>
      <PageHeader
        title="Movimentações de estoque"
        description="Registros não podem ser editados nem excluídos — correções são feitas por novo lançamento."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Produto, documento, motivo…"
            className="pl-8"
          />
        </div>
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {tipos.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">
                {t.replace(/_/g, " ")}
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
            title="Nenhuma movimentação encontrada."
            description="Registre entradas e saídas na tela de Estoque."
          />
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data / hora</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Depósito</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead className="text-right">Saldo anterior</TableHead>
                  <TableHead className="text-right">Saldo posterior</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((m) => {
                  const p = m.produtos as unknown as { descricao: string; codigo_interno: string } | null;
                  const d = m.depositos as unknown as { nome: string } | null;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-sm">{dateTimeBR(m.created_at)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            m.tipo === "saida" || m.tipo === "transferencia_saida"
                              ? "destructive"
                              : "secondary"
                          }
                          className="capitalize"
                        >
                          {m.tipo.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <p className="font-medium">{p?.descricao ?? "—"}</p>
                        <p className="text-numeric text-xs text-muted-foreground">
                          {p?.codigo_interno ?? ""}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">{d?.nome ?? "—"}</TableCell>
                      <TableCell className="text-numeric text-right">
                        {num(m.quantidade)} {m.unidade ?? ""}
                      </TableCell>
                      <TableCell className="text-numeric text-right">{num(m.saldo_anterior)}</TableCell>
                      <TableCell className="text-numeric text-right">{num(m.saldo_posterior)}</TableCell>
                      <TableCell className="text-sm">{m.documento ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {m.usuario_id ? (data?.nomes.get(m.usuario_id) ?? "—") : "Sistema"}
                      </TableCell>
                      <TableCell className="max-w-48 truncate text-sm text-muted-foreground">
                        {m.motivo ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}
