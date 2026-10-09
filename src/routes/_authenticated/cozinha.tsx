import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRealtimeTabelas } from "@/hooks/useRealtimeTabelas";
import { useSessionData } from "@/hooks/useSessionData";
import { useModulosCnae } from "@/lib/cnae";
import { ROTULO_ESTACAO, minutosDesde, proximoPreparo } from "@/lib/restaurante";
import {
  CHAVE_REST,
  rpcRestaurante,
  tabela,
  type Comanda,
  type ComandaItem,
  type Mesa,
} from "@/lib/restaurante-dados";

export const Route = createFileRoute("/_authenticated/cozinha")({
  head: () => ({
    meta: [
      { title: "Cozinha — ERP Ze Tech" },
      { name: "description", content: "Fila de preparo da cozinha e do bar em tempo real." },
    ],
  }),
  component: Cozinha,
});

const PERFIS_COZINHA = ["administrador", "gestor", "cozinha"];
const ESTACOES = [
  { valor: "todas", rotulo: "Tudo" },
  { valor: "cozinha", rotulo: "Cozinha" },
  { valor: "bar", rotulo: "Bar" },
];

function Cozinha() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const modulos = useModulosCnae();
  const [estacao, setEstacao] = useState("todas");
  const roles = session?.roles ?? [];

  useRealtimeTabelas(["comanda_itens", "comandas"], () =>
    qc.invalidateQueries({ queryKey: [CHAVE_REST] }),
  );

  const { data, isLoading } = useQuery({
    queryKey: [CHAVE_REST, "cozinha"],
    enabled: modulos.restaurante,
    // além do tempo real: os minutos de espera precisam andar mesmo sem novidade
    refetchInterval: 60_000,
    queryFn: async () => {
      const itens = await tabela("comanda_itens")
        .select("*")
        .in("situacao", ["enviado", "preparando", "pronto"])
        .order("enviado_em");
      if (itens.error) throw new Error(itens.error.message);
      const lista = (itens.data ?? []) as unknown as ComandaItem[];
      const ids = [...new Set(lista.map((i) => i.comanda_id))];
      const comandas = new Map<string, Comanda>();
      const mesas = new Map<string, Mesa>();
      if (ids.length > 0) {
        const c = await tabela("comandas").select("*").in("id", ids);
        if (c.error) throw new Error(c.error.message);
        for (const x of (c.data ?? []) as unknown as Comanda[]) comandas.set(x.id, x);
        const mesaIds = [...comandas.values()].map((x) => x.mesa_id).filter(Boolean) as string[];
        if (mesaIds.length > 0) {
          const m = await tabela("mesas").select("*").in("id", mesaIds);
          if (m.error) throw new Error(m.error.message);
          for (const x of (m.data ?? []) as unknown as Mesa[]) mesas.set(x.id, x);
        }
      }
      return { itens: lista, comandas, mesas };
    },
  });

  const andamento = useMutation({
    mutationFn: (p: { id: string; para: string }) =>
      rpcRestaurante("restaurante_atualizar_item", { p_item_id: p.id, p_situacao: p.para }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [CHAVE_REST] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (session && !modulos.carregando && !modulos.restaurante)
    return <ModuloBloqueado modulo="restaurante" />;
  if (session && !roles.some((r) => PERFIS_COZINHA.includes(r)))
    return (
      <EmptyState title="Sem acesso à cozinha" description="Seu perfil não prepara pedidos." />
    );

  const itens = (data?.itens ?? []).filter((i) => estacao === "todas" || i.estacao === estacao);
  const colunas = [
    { situacao: "enviado", titulo: "Na fila" },
    { situacao: "preparando", titulo: "Preparando" },
    { situacao: "pronto", titulo: "Prontos (aguardando o garçom)" },
  ];

  const origem = (i: ComandaItem) => {
    const c = data?.comandas.get(i.comanda_id);
    const mesa = c?.mesa_id ? data?.mesas.get(c.mesa_id) : null;
    return mesa ? `Mesa ${mesa.numero}` : c ? `Comanda ${c.numero}` : "—";
  };

  return (
    <>
      <PageHeader
        title="Cozinha"
        description="Os pedidos aparecem aqui assim que o garçom envia. Atualiza sozinho."
        actions={
          <div className="flex gap-1">
            {ESTACOES.map((e) => (
              <Button
                key={e.valor}
                size="sm"
                variant={estacao === e.valor ? "default" : "outline"}
                onClick={() => setEstacao(e.valor)}
              >
                {e.rotulo}
              </Button>
            ))}
          </div>
        }
      />

      {isLoading && <p className="text-sm text-muted-foreground">Carregando pedidos...</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        {colunas.map((col) => {
          const lista = itens.filter((i) => i.situacao === col.situacao);
          return (
            <section key={col.situacao} className="rounded-xl border bg-card/50 p-3">
              <h2 className="mb-3 flex items-center justify-between font-display text-lg font-semibold">
                {col.titulo}
                <Badge variant="secondary">{lista.length}</Badge>
              </h2>
              <div className="space-y-2">
                {lista.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">Nada por aqui.</p>
                )}
                {lista.map((i) => {
                  const espera = minutosDesde(i.enviado_em);
                  const prox = proximoPreparo(i.situacao);
                  const atrasado = i.situacao !== "pronto" && espera >= 20;
                  return (
                    <article
                      key={i.id}
                      className={`rounded-lg border p-3 ${atrasado ? "border-destructive bg-red-50" : "bg-card"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-display text-lg font-bold leading-tight">
                            {Number(i.quantidade)}× {i.nome}
                          </p>
                          {i.opcoes.length > 0 && (
                            <p className="text-sm">{i.opcoes.map((o) => o.nome).join(", ")}</p>
                          )}
                          {i.observacao && (
                            <p className="text-sm font-semibold text-destructive">
                              ⚠ {i.observacao}
                            </p>
                          )}
                        </div>
                        <div className="text-right text-sm">
                          <p className="font-semibold">{origem(i)}</p>
                          <p
                            className={
                              atrasado ? "font-bold text-destructive" : "text-muted-foreground"
                            }
                          >
                            {espera} min
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {ROTULO_ESTACAO[i.estacao] ?? i.estacao}
                        </span>
                        {prox && (
                          <Button
                            size="sm"
                            onClick={() => andamento.mutate({ id: i.id, para: prox.para })}
                            disabled={andamento.isPending}
                          >
                            {prox.rotulo}
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
