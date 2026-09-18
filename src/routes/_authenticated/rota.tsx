import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, MapPin, Package, Truck, User } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { dateBR, num } from "@/lib/format";
import { corEntrega, enderecoPedido, labelEntrega } from "@/lib/entrega";
import { hojeISO } from "@/lib/rota";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/rota")({
  head: () => ({
    meta: [
      { title: "Rota do dia — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Lista de entregas do dia por motorista e veículo, com endereço, produtos e ordem da rota.",
      },
      { property: "og:title", content: "Rota do dia — ERP Ze Tech" },
      { property: "og:description", content: "Entregas do dia para consulta no celular ou no computador." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RotaDoDia,
});

type PedidoRel = {
  numero: number;
  observacoes: string | null;
  entrega_endereco: string | null;
  entrega_numero: string | null;
  entrega_bairro: string | null;
  entrega_cidade: string | null;
  entrega_estado: string | null;
  clientes: { nome: string; telefone: string | null } | null;
};

function RotaDoDia() {
  const [dia, setDia] = useState(hojeISO());
  const [motoristaId, setMotoristaId] = useState("todos");

  const { data: motoristas = [] } = useQuery({
    queryKey: ["motoristas-rota"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("motoristas")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: entregas = [], isLoading } = useQuery({
    queryKey: ["rota-dia"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entregas")
        .select(
          "id, numero, situacao, previsao_data, sequencia, observacao, motorista_id, motoristas(nome), veiculos(placa, descricao), pedidos(numero, observacoes, entrega_endereco, entrega_numero, entrega_bairro, entrega_cidade, entrega_estado, clientes(nome, telefone)), entrega_itens(quantidade, produtos(descricao, unidade))",
        )
        .in("situacao", ["planejada", "em_rota"])
        .order("sequencia", { nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

  const lista = useMemo(() => {
    return entregas
      .filter((e) => (dia ? (e.previsao_data ?? "") === dia || !e.previsao_data : true))
      .filter((e) => (motoristaId === "todos" ? true : e.motorista_id === motoristaId))
      .sort((a, b) => Number(a.sequencia ?? 999) - Number(b.sequencia ?? 999));
  }, [entregas, dia, motoristaId]);

  const emRota = lista.filter((e) => e.situacao === "em_rota").length;

  return (
    <div>
      <PageHeader
        title="Rota do dia"
        description="Entregas na ordem da rota, com endereço e produtos. Abre no celular e no computador."
        actions={
          <Button variant="outline" asChild>
            <Link to="/motorista">Registrar entregas</Link>
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Entregas na rota" value={String(lista.length)} icon={Truck} />
        <StatCard label="Já em rota" value={String(emRota)} tone="accent" icon={CalendarClock} />
        <StatCard
          label="Produtos a levar"
          value={String(
            lista.reduce((s, e) => s + ((e.entrega_itens as unknown as unknown[]) ?? []).length, 0),
          )}
          icon={Package}
        />
      </div>

      <div className="panel mb-4 grid gap-3 p-3 sm:grid-cols-2">
        <div>
          <Label>Dia</Label>
          <Input type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
        </div>
        <div>
          <Label>Motorista</Label>
          <Select value={motoristaId} onValueChange={setMotoristaId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os motoristas</SelectItem>
              {motoristas.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma entrega na rota deste dia."
          description="Planeje as entregas na tela de Entregas para elas aparecerem aqui."
          action={
            <Button asChild>
              <Link to="/entregas">Ir para entregas</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {lista.map((e) => {
            const pedido = e.pedidos as unknown as PedidoRel | null;
            const veiculo = e.veiculos as unknown as { placa: string; descricao: string } | null;
            const motorista = e.motoristas as unknown as { nome: string } | null;
            const itens = (e.entrega_itens ?? []) as unknown as {
              quantidade: number;
              produtos: { descricao: string; unidade: string } | null;
            }[];
            return (
              <div key={e.id} className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Parada {e.sequencia ?? "—"} · Entrega #{String(e.numero).padStart(4, "0")}
                    </p>
                    <h3 className="font-display text-base font-semibold">
                      {pedido?.clientes?.nome ?? "—"}
                    </h3>
                    <p className="text-xs text-muted-foreground text-numeric">
                      Pedido #{String(pedido?.numero ?? "").padStart(4, "0")} ·{" "}
                      {dateBR(e.previsao_data)}
                    </p>
                  </div>
                  <Badge className={corEntrega(e.situacao)}>{labelEntrega(e.situacao)}</Badge>
                </div>

                <p className="mt-3 flex items-start gap-1 text-sm">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  {pedido ? enderecoPedido(pedido) : "—"}
                </p>
                {pedido?.clientes?.telefone && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Telefone: {pedido.clientes.telefone}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Truck className="size-3.5" />
                    {veiculo ? `${veiculo.descricao} (${veiculo.placa})` : "sem veículo"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <User className="size-3.5" />
                    {motorista?.nome ?? "sem motorista"}
                  </span>
                </div>

                <ul className="mt-3 space-y-1 rounded-md border border-border p-3 text-sm">
                  {itens.map((i, idx) => (
                    <li key={idx} className="flex justify-between gap-2">
                      <span className="truncate">{i.produtos?.descricao ?? "—"}</span>
                      <span className="text-numeric text-muted-foreground">
                        {num(i.quantidade)} {i.produtos?.unidade ?? ""}
                      </span>
                    </li>
                  ))}
                </ul>

                {(e.observacao || pedido?.observacoes) && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {e.observacao ?? pedido?.observacoes}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
