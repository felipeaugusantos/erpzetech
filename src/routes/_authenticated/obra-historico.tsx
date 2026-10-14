import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownUp,
  CalendarClock,
  CalendarX2,
  ClipboardList,
  PackageCheck,
  Truck,
  XCircle,
} from "lucide-react";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { dateBR, dateTimeBR, num } from "@/lib/format";
import {
  ROTULO_EVENTO,
  filtrarEventos,
  montarHistoricoObra,
  resumoPedidos,
  type EntregaObra,
  type HistoricoPedido,
  type OcorrenciaObra,
  type PedidoObra,
  type ReagendamentoObra,
  type TipoEvento,
} from "@/lib/historico-obra";
import { corSituacao, labelSituacao } from "@/lib/pedido";

export const Route = createFileRoute("/_authenticated/obra-historico")({
  validateSearch: (search: Record<string, unknown>) => ({
    obra: typeof search["obra"] === "string" ? (search["obra"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Histórico da obra — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Todas as entregas, retiradas, ocorrências e agendamentos da obra, do pedido até a última entrega.",
      },
    ],
  }),
  component: HistoricoObra,
});

const ICONE: Record<TipoEvento, typeof Truck> = {
  pedido: ClipboardList,
  agendamento: CalendarClock,
  reagendamento: CalendarX2,
  rota: Truck,
  saida: PackageCheck,
  insucesso: XCircle,
  ocorrencia: AlertTriangle,
};
const COR: Record<TipoEvento, string> = {
  pedido: "bg-secondary text-secondary-foreground",
  agendamento: "bg-info/15 text-info",
  reagendamento: "bg-warning/20 text-warning-foreground",
  rota: "bg-primary/15 text-primary",
  saida: "bg-success/15 text-success",
  insucesso: "bg-destructive/15 text-destructive",
  ocorrencia: "bg-destructive/15 text-destructive",
};
const TIPOS = Object.keys(ROTULO_EVENTO) as TipoEvento[];

type ObraLinha = {
  id: string;
  nome: string;
  situacao: string;
  endereco: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  responsavel: string | null;
  previsao_termino: string | null;
  clientes: { nome: string } | null;
};

function HistoricoObra() {
  const { obra: obraId } = Route.useSearch();
  const navigate = useNavigate();
  const [tipos, setTipos] = useState<TipoEvento[]>([]);
  const [pedidoFiltro, setPedidoFiltro] = useState<string>("todos");
  const [maisNovosPrimeiro, setMaisNovosPrimeiro] = useState(false);

  const { data: obras = [] } = useQuery({
    queryKey: ["obras-historico-lista"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("obras")
        .select(
          "id, nome, situacao, endereco, numero, bairro, cidade, responsavel, previsao_termino, clientes(nome)",
        )
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as ObraLinha[];
    },
  });
  const obra = obras.find((o) => o.id === obraId) ?? null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["obra-historico", obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const { data: pedidos, error } = await supabase
        .from("pedidos")
        .select(
          "id, numero, situacao, total, created_at, pedido_itens(quantidade, quantidade_entregue)",
        )
        .eq("obra_id", obraId!)
        .order("created_at");
      if (error) throw error;
      const ids = (pedidos ?? []).map((p) => p.id);
      if (ids.length === 0)
        return {
          pedidos: [] as PedidoObra[],
          historico: [] as HistoricoPedido[],
          entregas: [] as EntregaObra[],
          reagendamentos: [] as ReagendamentoObra[],
          ocorrencias: [] as OcorrenciaObra[],
          nomes: {} as Record<string, string>,
        };
      const [hist, ent, oco] = await Promise.all([
        supabase.from("pedido_historico").select("*").in("pedido_id", ids),
        supabase
          .from("entregas")
          .select("*, entrega_itens(quantidade, produtos(descricao, unidade))")
          .in("pedido_id", ids),
        supabase
          .from("pedido_ocorrencias")
          .select(
            "id, pedido_id, etapa, tipo, quantidade, observacao, usuario_id, created_at, pedido_itens(produtos(descricao, unidade)), substituto:produtos!pedido_ocorrencias_produto_substituto_id_fkey(descricao)",
          )
          .in("pedido_id", ids),
      ]);
      for (const r of [hist, ent, oco]) if (r.error) throw r.error;
      const entregaIds = (ent.data ?? []).map((e) => e.id);
      const rea =
        entregaIds.length > 0
          ? await supabase.from("entrega_reagendamentos").select("*").in("entrega_id", entregaIds)
          : { data: [], error: null };
      if (rea.error) throw rea.error;

      const usuarios = [
        ...new Set(
          [
            ...(hist.data ?? []).map((h) => h.usuario_id),
            ...(ent.data ?? []).map((e) => e.usuario_id),
            ...(oco.data ?? []).map((o) => o.usuario_id),
            ...(rea.data ?? []).map((r) => r.usuario_id),
          ].filter(Boolean),
        ),
      ] as string[];
      const perfis =
        usuarios.length > 0
          ? await supabase.from("profiles").select("id, nome").in("id", usuarios)
          : { data: [] };
      return {
        pedidos: (pedidos ?? []) as unknown as PedidoObra[],
        historico: (hist.data ?? []) as unknown as HistoricoPedido[],
        entregas: (ent.data ?? []) as unknown as EntregaObra[],
        reagendamentos: (rea.data ?? []) as unknown as ReagendamentoObra[],
        ocorrencias: (oco.data ?? []) as unknown as OcorrenciaObra[],
        nomes: Object.fromEntries((perfis.data ?? []).map((p) => [p.id, p.nome])) as Record<
          string,
          string
        >,
      };
    },
  });

  const eventos = useMemo(() => (data ? montarHistoricoObra(data) : []), [data]);
  const resumo = useMemo(() => (data ? resumoPedidos(data.pedidos) : []), [data]);
  const visiveis = useMemo(() => {
    const f = filtrarEventos(eventos, {
      tipos,
      pedidoNumero: pedidoFiltro === "todos" ? null : Number(pedidoFiltro),
    });
    return maisNovosPrimeiro ? [...f].reverse() : f;
  }, [eventos, tipos, pedidoFiltro, maisNovosPrimeiro]);

  const contagem = useMemo(() => {
    const c = Object.fromEntries(TIPOS.map((t) => [t, 0])) as Record<TipoEvento, number>;
    for (const e of eventos) c[e.tipo] += 1;
    return c;
  }, [eventos]);

  const totais = useMemo(() => {
    const pedido = resumo.reduce((s, r) => s + r.pedido, 0);
    const entregue = resumo.reduce((s, r) => s + r.entregue, 0);
    return { pedido, entregue, pendente: pedido - entregue };
  }, [resumo]);

  return (
    <>
      <PageHeader
        title="Histórico da obra"
        description="Pedidos, retiradas, entregas, agendamentos e ocorrências da obra, do início ao fim."
      />

      <div className="panel mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="w-full max-w-md">
          <p className="mb-1 text-sm font-medium">Obra</p>
          <Select
            value={obraId ?? ""}
            onValueChange={(v) => {
              setTipos([]);
              setPedidoFiltro("todos");
              void navigate({ to: "/obra-historico", search: { obra: v } });
            }}
          >
            <SelectTrigger aria-label="Obra">
              <SelectValue placeholder="Escolha a obra" />
            </SelectTrigger>
            <SelectContent>
              {obras.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.nome}
                  {o.clientes?.nome ? ` · ${o.clientes.nome}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {obra && (
          <div className="text-sm text-muted-foreground">
            <p>
              {[obra.endereco, obra.numero, obra.bairro, obra.cidade].filter(Boolean).join(", ") ||
                "Sem endereço"}
            </p>
            <p>
              {obra.responsavel ? `Responsável: ${obra.responsavel} · ` : ""}
              {obra.previsao_termino ? `Término previsto: ${dateBR(obra.previsao_termino)}` : ""}
            </p>
          </div>
        )}
      </div>

      {!obraId && (
        <EmptyState
          title="Escolha uma obra"
          description="O histórico reúne tudo o que aconteceu nos pedidos da obra."
        />
      )}
      {obraId && isLoading && <div className="panel h-48 animate-pulse" />}
      {obraId && isError && (
        <p className="text-sm text-destructive">Não foi possível carregar o histórico da obra.</p>
      )}

      {obraId && data && data.pedidos.length === 0 && (
        <EmptyState
          title="Nenhum pedido nesta obra"
          description="Quando houver pedidos vinculados a ela, o histórico aparece aqui."
        />
      )}

      {obraId && data && data.pedidos.length > 0 && (
        <div className="space-y-4">
          <div className="panel p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-display font-semibold">Andamento dos pedidos</p>
              <p className="text-sm text-muted-foreground">
                {num(totais.entregue, 3)} de {num(totais.pedido, 3)} itens já saíram · faltam{" "}
                {num(totais.pendente, 3)}
              </p>
            </div>
            <ul className="mt-3 grid gap-3 md:grid-cols-2">
              {resumo.map((r) => (
                <li key={r.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to="/pedidos/$id"
                      params={{ id: r.id }}
                      className="font-semibold text-primary hover:underline"
                    >
                      Pedido #{String(r.numero ?? "").padStart(4, "0")}
                    </Link>
                    <Badge className={corSituacao(r.situacao)}>{labelSituacao(r.situacao)}</Badge>
                  </div>
                  <Progress
                    value={r.percentual}
                    className="mt-2 h-2"
                    aria-label={`Pedido ${r.numero}: ${r.percentual}% entregue`}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.percentual}% entregue · {num(r.entregue, 3)} de {num(r.pedido, 3)} · faltam{" "}
                    {num(r.pendente, 3)}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-2 font-display font-semibold">Linha do tempo</p>
              <Button
                size="sm"
                variant={tipos.length === 0 ? "default" : "outline"}
                onClick={() => setTipos([])}
              >
                Tudo ({eventos.length})
              </Button>
              {TIPOS.filter((t) => contagem[t] > 0).map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={tipos.includes(t) ? "default" : "outline"}
                  onClick={() =>
                    setTipos((atual) =>
                      atual.includes(t) ? atual.filter((x) => x !== t) : [...atual, t],
                    )
                  }
                >
                  {ROTULO_EVENTO[t]} ({contagem[t]})
                </Button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                {data.pedidos.length > 1 && (
                  <Select value={pedidoFiltro} onValueChange={setPedidoFiltro}>
                    <SelectTrigger className="h-9 w-44" aria-label="Filtrar por pedido">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os pedidos</SelectItem>
                      {data.pedidos.map((p) => (
                        <SelectItem key={p.id} value={String(p.numero)}>
                          Pedido #{String(p.numero ?? "").padStart(4, "0")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMaisNovosPrimeiro((v) => !v)}
                  title="Inverter a ordem"
                >
                  <ArrowDownUp className="mr-1 size-4" />
                  {maisNovosPrimeiro ? "Mais novos primeiro" : "Do início ao fim"}
                </Button>
              </div>
            </div>

            {visiveis.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Nada com esse filtro. Tire o filtro para ver tudo.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {visiveis.map((e) => {
                  const Icone = ICONE[e.tipo];
                  return (
                    <li key={e.id} className="flex gap-3">
                      <span
                        className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${COR[e.tipo]}`}
                      >
                        <Icone className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1 rounded-md border border-border p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{e.titulo}</span>
                          {e.pedidoNumero != null && (
                            <Badge variant="outline">
                              Pedido #{String(e.pedidoNumero).padStart(4, "0")}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {dateTimeBR(e.quando)}
                          {e.usuarioId && data.nomes[e.usuarioId]
                            ? ` · ${data.nomes[e.usuarioId]}`
                            : ""}
                        </p>
                        {e.detalhe && <p className="mt-1">{e.detalhe}</p>}
                        {e.itens.length > 0 && (
                          <ul className="mt-1 text-xs text-muted-foreground">
                            {e.itens.map((i, idx) => (
                              <li key={idx}>
                                {num(i.quantidade, 3)} {i.unidade} · {i.descricao}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      )}
    </>
  );
}
