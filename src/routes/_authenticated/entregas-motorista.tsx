import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";

import { PageHeader } from "@/components/app/PageHeader";
import { MapaRota } from "@/components/app/MapaRota";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { num } from "@/lib/format";
import { enderecoPedido, labelEntrega } from "@/lib/entrega";

export const Route = createFileRoute("/_authenticated/entregas-motorista")({
  head: () => ({
    meta: [
      { title: "Entregas do motorista — ERP Ze Tech" },
      {
        name: "description",
        content: "Rota do dia de cada motorista no computador, com ordem, endereço, situação e motivo.",
      },
    ],
  }),
  component: EntregasMotorista,
});

type Pedido = Parameters<typeof enderecoPedido>[0] & {
  numero: number;
  clientes: { nome: string; telefone: string | null } | null;
  obras: { nome: string } | null;
};
type Entrega = {
  id: string;
  numero: number | null;
  situacao: string;
  sequencia: number | null;
  previsao_data: string | null;
  data_saida: string | null;
  data_entrega: string | null;
  endereco_entrega: string | null;
  motivo_insucesso: string | null;
  observacao: string | null;
  recebedor: string | null;
  pedidos: Pedido | null;
  veiculos: { placa: string } | null;
  entrega_itens: { quantidade: number; produtos: { descricao: string; unidade: string | null } | null }[];
};

const hojeISO = () => new Date().toISOString().slice(0, 10);
const tom: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  planejada: "outline",
  em_rota: "default",
  entregue: "secondary",
  insucesso: "destructive",
};

function EntregasMotorista() {
  const qc = useQueryClient();
  const [motoristaId, setMotoristaId] = useState("");
  const [dia, setDia] = useState(hojeISO());

  const { data: motoristas = [] } = useQuery({
    queryKey: ["motoristas-ativos"],
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
  useEffect(() => {
    if (!motoristaId && motoristas[0]) setMotoristaId(motoristas[0].id);
  }, [motoristas, motoristaId]);

  const { data: entregas = [], isLoading } = useQuery({
    queryKey: ["entregas-motorista-pc", motoristaId, dia],
    enabled: Boolean(motoristaId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entregas")
        .select(
          "id, numero, situacao, sequencia, previsao_data, data_saida, data_entrega, endereco_entrega, motivo_insucesso, observacao, recebedor, veiculos(placa), pedidos(numero, entrega_endereco, entrega_numero, entrega_bairro, entrega_cidade, entrega_estado, clientes(nome, telefone), obras(nome)), entrega_itens(quantidade, produtos(descricao, unidade))",
        )
        .eq("motorista_id", motoristaId)
        .order("sequencia", { ascending: true, nullsFirst: false });
      if (error) throw error;
      // Do dia: previstas para a data, saídas/finalizadas na data, e abertas sem data.
      return (data as unknown as Entrega[]).filter((e) => {
        const datas = [e.previsao_data, e.data_saida?.slice(0, 10), e.data_entrega?.slice(0, 10)];
        const aberta = ["planejada", "em_rota"].includes(e.situacao);
        return datas.includes(dia) || (aberta && !e.previsao_data);
      });
    },
  });

  useEffect(() => {
    if (!motoristaId) return;
    const canal = supabase
      .channel(`entregas-pc-${motoristaId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entregas", filter: `motorista_id=eq.${motoristaId}` },
        () => void qc.invalidateQueries({ queryKey: ["entregas-motorista-pc"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [motoristaId, qc]);

  const endereco = (e: Entrega) => e.endereco_entrega || (e.pedidos ? enderecoPedido(e.pedidos) : "");
  const abertas = useMemo(
    () => entregas.filter((e) => ["planejada", "em_rota"].includes(e.situacao)),
    [entregas],
  );
  const cont = (s: string) => entregas.filter((e) => e.situacao === s).length;

  return (
    <>
      <PageHeader
        title="Entregas do motorista"
        description="A rota do dia no computador: ordem das paradas, endereço, o que levar e a situação de cada entrega, atualizada na hora."
        actions={
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1 size-4" /> Imprimir rota
          </Button>
        }
      />

      <div className="panel mb-4 flex flex-wrap items-end gap-3 p-3 print:hidden">
        <label className="text-xs">
          Motorista
          <select
            className="block h-9 min-w-56 rounded-md border border-input bg-background px-2 text-sm"
            value={motoristaId}
            onChange={(e) => setMotoristaId(e.target.value)}
          >
            {motoristas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Dia
          <Input type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
        </label>
        <div className="ml-auto flex gap-2 text-sm">
          <Badge variant="outline">Planejadas {cont("planejada")}</Badge>
          <Badge>Em rota {cont("em_rota")}</Badge>
          <Badge variant="secondary">Entregues {cont("entregue")}</Badge>
          <Badge variant="destructive">Sem sucesso {cont("insucesso")}</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <div className="panel overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Ordem</th>
                <th className="px-3 py-2">Entrega</th>
                <th className="px-3 py-2">Cliente / obra</th>
                <th className="px-3 py-2">Endereço</th>
                <th className="px-3 py-2">Levar</th>
                <th className="px-3 py-2">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border align-top">
              {entregas.map((e, i) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 font-display font-bold">{e.sequencia ?? i + 1}</td>
                  <td className="px-3 py-2">
                    nº {e.numero ?? "—"}
                    <p className="text-xs text-muted-foreground">Pedido {e.pedidos?.numero}</p>
                    {e.veiculos?.placa && (
                      <p className="text-xs text-muted-foreground">{e.veiculos.placa}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {e.pedidos?.clientes?.nome ?? "—"}
                    {e.pedidos?.obras?.nome && (
                      <p className="text-xs text-muted-foreground">{e.pedidos.obras.nome}</p>
                    )}
                    {e.pedidos?.clientes?.telefone && (
                      <p className="text-xs text-muted-foreground">{e.pedidos.clientes.telefone}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">{endereco(e) || "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {e.entrega_itens.map((it, k) => (
                      <p key={k}>
                        {num(Number(it.quantidade))} {it.produtos?.unidade ?? ""} {it.produtos?.descricao}
                      </p>
                    ))}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={tom[e.situacao] ?? "outline"}>{labelEntrega(e.situacao)}</Badge>
                    {e.motivo_insucesso && (
                      <p className="mt-1 text-xs text-destructive">{e.motivo_insucesso}</p>
                    )}
                    {e.observacao && <p className="text-xs text-muted-foreground">{e.observacao}</p>}
                    {e.recebedor && (
                      <p className="text-xs text-muted-foreground">Recebeu: {e.recebedor}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && entregas.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Nenhuma entrega deste motorista no dia.</p>
          )}
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando…</p>}
        </div>
        <div className="print:hidden">
          <MapaRota
            paradas={(abertas.length ? abertas : entregas).map((e) => ({
              rotulo: e.pedidos?.clientes?.nome ?? `Entrega ${e.numero ?? ""}`,
              endereco: endereco(e),
            }))}
          />
        </div>
      </div>
    </>
  );
}
